import assert from 'node:assert';
import { evaluateGrant, canonicalPayloadHash, Grant, Intent } from '../src/policy/grantEngine.js';

console.log('--- Running Grant Engine Tests ---');

const baseGrant: Grant = {
  clientId: 'client_claude_123',
  walletAddresses: ['0x1111111111111111111111111111111111111111'],
  chains: ['eip155:8453'],
  allowedAssets: ['ETH', 'USDC'],
  allowedRecipients: ['0x2222222222222222222222222222222222222222'],
  maxWeiPerTx: 100000000000000000n, // 0.1 ETH
  maxWeiPerDay: 500000000000000000n, // 0.5 ETH
  mode: 'always_ask',
  expiresAt: new Date(Date.now() + 86400000),
  revoked: false,
};

const validIntent: Intent = {
  walletAddress: '0x1111111111111111111111111111111111111111',
  chain: 'eip155:8453',
  to: '0x2222222222222222222222222222222222222222',
  valueWei: 50000000000000000n, // 0.05 ETH
  asset: 'ETH',
  data: '0x',
  spentWeiToday: 0n,
};

// 1. always_ask never returns allow_autonomous
{
  const decision = evaluateGrant(baseGrant, validIntent);
  assert.strictEqual(decision.type, 'ask');
  assert.strictEqual(decision.reason, 'mode_always_ask');
  console.log('✓ always_ask never returns allow_autonomous');
}

// 2. autonomous inside limits returns allow_autonomous
{
  const autonomousGrant: Grant = { ...baseGrant, mode: 'autonomous' };
  const decision = evaluateGrant(autonomousGrant, validIntent);
  assert.strictEqual(decision.type, 'allow_autonomous');
  assert.strictEqual(decision.reason, 'within_grant');
  console.log('✓ autonomous within limits allows execution');
}

// 3. autonomous over maxWeiPerTx becomes ask
{
  const autonomousGrant: Grant = { ...baseGrant, mode: 'autonomous' };
  const overTxIntent: Intent = {
    ...validIntent,
    valueWei: 200000000000000000n, // 0.2 ETH (limit 0.1 ETH)
  };
  const decision = evaluateGrant(autonomousGrant, overTxIntent);
  assert.strictEqual(decision.type, 'ask');
  assert.strictEqual(decision.reason, 'over_per_tx_limit');
  console.log('✓ autonomous over maxWeiPerTx becomes ask');
}

// 4. unknown recipient becomes ask, not allow
{
  const autonomousGrant: Grant = { ...baseGrant, mode: 'autonomous' };
  const unknownRecipientIntent: Intent = {
    ...validIntent,
    to: '0x3333333333333333333333333333333333333333',
  };
  const decision = evaluateGrant(autonomousGrant, unknownRecipientIntent);
  assert.strictEqual(decision.type, 'ask');
  assert.strictEqual(decision.reason, 'recipient_not_preauthorized');
  console.log('✓ unknown recipient becomes ask, not allow');
}

// 5. calldata in autonomous becomes ask
{
  const autonomousGrant: Grant = { ...baseGrant, mode: 'autonomous' };
  const calldataIntent: Intent = {
    ...validIntent,
    data: '0xa9059cbb000000000000000000000000',
  };
  const decision = evaluateGrant(autonomousGrant, calldataIntent);
  assert.strictEqual(decision.type, 'ask');
  assert.strictEqual(decision.reason, 'calldata_requires_human_review');
  console.log('✓ calldata in autonomous becomes ask');
}

// 6. over daily limit denies
{
  const autonomousGrant: Grant = { ...baseGrant, mode: 'autonomous' };
  const overDailyIntent: Intent = {
    ...validIntent,
    spentWeiToday: 480000000000000000n,
    valueWei: 50000000000000000n, // total 0.53 ETH > 0.5 ETH
  };
  const decision = evaluateGrant(autonomousGrant, overDailyIntent);
  assert.strictEqual(decision.type, 'deny');
  assert.strictEqual(decision.reason, 'over_daily_limit');
  console.log('✓ over daily limit denies operation');
}

// 7. canonical payload hash is deterministic
{
  const hash1 = canonicalPayloadHash({
    chain: 'eip155:8453',
    to: '0x2222222222222222222222222222222222222222',
    valueWei: '50000000000000000',
    data: '0x',
    nonce: 1,
  });
  const hash2 = canonicalPayloadHash({
    chain: 'eip155:8453',
    to: '0x2222222222222222222222222222222222222222',
    valueWei: '50000000000000000',
    data: '0x',
    nonce: 1,
  });
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(typeof hash1, 'string');
  assert.ok(hash1.startsWith('0x'));
  console.log('✓ canonical payload hash is deterministic');
}

console.log('All grant engine tests passed!\n');
