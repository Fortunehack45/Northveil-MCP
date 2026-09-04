import assert from 'node:assert';
import { prepareTransfer } from '../src/tools/prepareTransfer.js';

console.log('--- Running MCP Tools Tests ---');

async function runTests() {
  const ctx = {
    userId: 'usr_mock_1',
    clientId: 'client_mock_1',
    grant: {
      clientId: 'client_mock_1',
      walletAddresses: ['0x1111111111111111111111111111111111111111'],
      chains: ['eip155:8453'],
      allowedAssets: ['ETH', 'USDC'],
      allowedRecipients: ['0x2222222222222222222222222222222222222222'],
      maxWeiPerTx: 100000000000000000n, // 0.1 ETH
      maxWeiPerDay: 500000000000000000n, // 0.5 ETH
      mode: 'always_ask',
      expiresAt: new Date(Date.now() + 86400000),
      revoked: false,
    },
    wallet: {
      id: 'wal_mock_1',
      address: '0x1111111111111111111111111111111111111111',
      chainFamily: 'evm',
      mpcWalletId: 'turnkey_wallet_123',
    },
  };

  // 1. prepare_transfer never returns a private key field
  {
    const result = await prepareTransfer(ctx as any, {
      to: '0x2222222222222222222222222222222222222222',
      amount: '0.05',
      chain: 'eip155:8453',
    });

    assert.strictEqual(result.status, 'pending_approval');
    assert.ok(result.approvalId);
    assert.ok(result.payloadHash);
    assert.ok(result.approveUrl);

    // Non-negotiable security invariant verification
    const jsonStr = JSON.stringify(result);
    assert.ok(!jsonStr.includes('privateKey'), 'Response MUST NOT contain privateKey');
    assert.ok(!jsonStr.includes('private_key'), 'Response MUST NOT contain private_key');
    assert.ok(!jsonStr.includes('seedPhrase'), 'Response MUST NOT contain seedPhrase');
    assert.ok(!jsonStr.includes('mnemonic'), 'Response MUST NOT contain mnemonic');
    assert.ok(!jsonStr.includes('secret'), 'Response MUST NOT contain secret');

    console.log('✓ prepare_transfer never returns a private key or seed field');
  }

  // 2. Denies invalid recipient
  {
    const badRecipientResult = await prepareTransfer(ctx as any, {
      to: 'invalid-address',
      amount: '0.05',
    });
    assert.strictEqual(badRecipientResult.status, 'denied');
    console.log('✓ rejects invalid recipient address format');
  }

  // 3. Denies over daily limit
  {
    const overLimitCtx = {
      ...ctx,
      grant: {
        ...ctx.grant,
        maxWeiPerDay: 10000000000000000n, // 0.01 ETH
      },
    };
    const deniedResult = await prepareTransfer(overLimitCtx as any, {
      to: '0x2222222222222222222222222222222222222222',
      amount: '0.05', // 0.05 > 0.01 ETH
    });
    assert.strictEqual(deniedResult.status, 'denied');
    assert.strictEqual(deniedResult.reason, 'over_daily_limit');
    console.log('✓ denies intent exceeding daily limit');
  }

  console.log('All MCP tools tests passed!\n');
}

runTests();
