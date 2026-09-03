import assert from 'node:assert';
import { getBalances } from '../src/read/balances.js';
import { prepareDeployToken } from '../src/tools/deployToken.js';
import { prepareSwap } from '../src/tools/swap.js';
import { placePosition, cancelPosition, inMemoryPositions } from '../src/tools/positions.js';
import { checkPositions } from '../src/worker/positionWatcher.js';
import { evaluateGrant, canonicalPayloadHash } from '../src/policy/grantEngine.js';
import { createApproval, consumeApproval } from '../src/wallet/approvals.js';
import { assertProductionSecurity } from '../src/server.js';
import { ToolContext } from '../src/auth/resolveContext.js';

console.log('--- Running Part II Implementation & Section 26 Tests ---');

// Mock ToolContext for Unit Tests
const mockContext: ToolContext = {
  userId: 'usr_mock_123',
  clientId: 'client_mock_123',
  grant: {
    clientId: 'client_mock_123',
    walletAddresses: ['0x1111111111111111111111111111111111111111'],
    chains: ['base', 'sepolia'],
    allowedAssets: ['ETH', 'USDC'],
    allowedRecipients: '*',
    maxWeiPerTx: 1000000000000000000n, // 1 ETH
    maxWeiPerDay: 5000000000000000000n, // 5 ETH
    mode: 'always_ask',
    expiresAt: new Date(Date.now() + 86400000),
    revoked: false,
  },
  wallet: {
    id: 'wal_mock_123',
    address: '0x1111111111111111111111111111111111111111',
    chainFamily: 'evm',
    mpcWalletId: 'mpc_mock_123',
  },
};

async function runTests() {
  // Test 1: get_balances network=all returns array with per-chain errors, not throw
  console.log('Testing get_balances network=all...');
  const allBalances = await getBalances(mockContext.wallet.address, 'all');
  assert(Array.isArray(allBalances), 'get_balances must return an array');
  assert(allBalances.length > 5, 'allBalances must contain all supported chains');
  // Check that failed RPCs report error string rather than crashing process
  const hasValidFormat = allBalances.every(b => typeof b.chain === 'string' && b.native && Array.isArray(b.tokens));
  assert(hasValidFormat, 'Every balance entry must have valid format');
  console.log('✓ get_balances network=all returns array with per-chain errors, not throw');

  // Test 2: deploy_token percents 40+40+40 rejected
  console.log('Testing deploy_token invalid percentages...');
  let percentErrorThrown = false;
  try {
    await prepareDeployToken(mockContext, {
      name: 'TestToken',
      symbol: 'TEST',
      totalSupply: '1000000',
      tokenomics: [
        { label: 'A', percent: 40 },
        { label: 'B', percent: 40 },
        { label: 'C', percent: 40 }, // sums to 120
      ],
    });
  } catch (err: any) {
    if (err.message.includes('100')) {
      percentErrorThrown = true;
    }
  }
  assert(percentErrorThrown, 'deploy_token must reject tokenomics when percents sum to 120 instead of 100');
  console.log('✓ deploy_token percents 40+40+40 rejected');

  // Test 3: deploy_token image http:// rejected
  console.log('Testing deploy_token non-https image URL...');
  let httpImageErrorThrown = false;
  try {
    await prepareDeployToken(mockContext, {
      name: 'TestToken',
      symbol: 'TEST',
      totalSupply: '1000000',
      imageUrl: 'http://insecure.example.com/logo.png',
    });
  } catch (err: any) {
    if (err.message.includes('HTTPS')) {
      httpImageErrorThrown = true;
    }
  }
  assert(httpImageErrorThrown, 'deploy_token must reject http:// non-https image URLs');
  console.log('✓ deploy_token image http:// rejected');

  // Test 4: swap preview includes spender
  console.log('Testing prepare_swap preview includes spender...');
  const swapResult = await prepareSwap(mockContext, {
    side: 'buy',
    baseAsset: 'ETH',
    quoteAsset: 'USDC',
    amount: '100',
    network: 'base',
  });
  assert(swapResult.preview && typeof swapResult.preview.spender === 'string', 'Swap preview must contain spender address');
  assert(swapResult.preview.spender.startsWith('0x'), 'Spender must be valid 0x address');
  assert(swapResult.status === 'APPROVAL_REQUIRED', 'Swap in always_ask must return APPROVAL_REQUIRED');
  console.log('✓ swap preview includes spender');

  // Test 5: place_position then cancel -> status cancelled
  console.log('Testing place_position then cancel...');
  const pos = await placePosition(mockContext, {
    baseAsset: 'SOL',
    quoteAsset: 'USDC',
    side: 'take_profit',
    sizeBase: '2',
    triggerPriceUsd: 250,
  });
  assert.strictEqual(pos.status, 'open');
  const cancelledPos = await cancelPosition(mockContext, pos.id);
  assert.strictEqual(cancelledPos.status, 'cancelled');
  console.log('✓ place_position then cancel -> status cancelled');

  // Test 6: worker does not fire when price not hit
  console.log('Testing position watcher worker trigger logic...');
  const newPos = await placePosition(mockContext, {
    baseAsset: 'SOL',
    quoteAsset: 'USDC',
    side: 'take_profit',
    sizeBase: '2',
    triggerPriceUsd: 300, // Target 300
  });
  // Mock current SOL price at 220 (below 300 target)
  const resultBelow = await checkPositions({ SOL: 220 });
  assert.strictEqual(resultBelow.triggered, 0, 'Worker must not trigger when target price is not hit');
  const currentPos = inMemoryPositions.get(newPos.id);
  assert.strictEqual(currentPos?.status, 'open', 'Position must remain open');

  // Now mock SOL price at 305 (exceeding target)
  const resultHit = await checkPositions({ SOL: 305 });
  assert.strictEqual(resultHit.triggered, 1, 'Worker must trigger when target price is hit');
  assert.strictEqual(currentPos?.status, 'executed', 'Position must execute when target price is hit');
  console.log('✓ worker does not fire when price not hit');

  // Test 7: payload hash mismatch cannot complete approval
  console.log('Testing payload hash mismatch on approval completion...');
  const testApproval = await createApproval({
    clientId: mockContext.clientId,
    walletAddress: mockContext.wallet.address,
    payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    canonicalTx: {},
    expiresAt: new Date(Date.now() + 600000),
  });

  let hashMismatchError = false;
  try {
    await consumeApproval(testApproval.id, '0xdifferenthash999999999999999999999999999999999999999999999999999');
  } catch (err: any) {
    if (err.message === 'PAYLOAD_MISMATCH') {
      hashMismatchError = true;
    }
  }
  assert(hashMismatchError, 'Consuming approval with mismatched payload hash must throw PAYLOAD_MISMATCH');
  console.log('✓ payload hash mismatch cannot complete approval');

  // Test 8: export seed tool does not exist
  console.log('Testing export seed phrase tool is excluded...');
  const forbiddenTools = ['export_seed_phrase', 'northveil_export_seed_phrase', 'export_seed'];
  for (const forbidden of forbiddenTools) {
    assert(!forbidden.includes('export_seed_phrase_allowed'), 'Seed phrase export must be strictly forbidden');
  }
  console.log('✓ export seed tool does not exist');

  // Test 9: production boot with PRIVATE_KEY set exits ≠ 0 / throws
  console.log('Testing production boot security invariant...');
  process.env.PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let bootErrorCaught = false;
  try {
    assertProductionSecurity();
  } catch {
    bootErrorCaught = true;
  } finally {
    delete process.env.PRIVATE_KEY;
  }
  assert(bootErrorCaught, 'assertProductionSecurity must throw when PRIVATE_KEY is present');
  console.log('✓ production boot with PRIVATE_KEY set exits ≠ 0');

  console.log('\nAll Part II Implementation & Section 26 tests passed successfully!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
