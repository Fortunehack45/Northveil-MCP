import assert from 'node:assert';
import { createApproval, consumeApproval } from '../src/wallet/approvals.js';

console.log('--- Running Approvals Tests ---');

const payloadHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

async function runTests() {
  // 1. Replay of used approval fails
  {
    const approval = await createApproval({
      clientId: 'client_1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      payloadHash,
      canonicalTx: { to: '0x2222' },
      expiresAt: new Date(Date.now() + 600000),
    });

    const consumed = await consumeApproval(approval.id, payloadHash);
    assert.strictEqual(consumed.used, true);

    await assert.rejects(
      async () => {
        await consumeApproval(approval.id, payloadHash);
      },
      /REPLAY_REJECTED/,
      'Should reject replay of used approval id'
    );
    console.log('✓ rejects replay of used id');
  }

  // 2. Expired approval fails
  {
    const expiredApproval = await createApproval({
      clientId: 'client_1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      payloadHash,
      canonicalTx: { to: '0x2222' },
      expiresAt: new Date(Date.now() - 1000), // in the past
    });

    await assert.rejects(
      async () => {
        await consumeApproval(expiredApproval.id, payloadHash);
      },
      /APPROVAL_EXPIRED/,
      'Should reject expired approval'
    );
    console.log('✓ rejects expired id');
  }

  // 3. Payload hash mismatch fails
  {
    const approval = await createApproval({
      clientId: 'client_1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      payloadHash,
      canonicalTx: { to: '0x2222' },
      expiresAt: new Date(Date.now() + 600000),
    });

    const tamperedHash = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    await assert.rejects(
      async () => {
        await consumeApproval(approval.id, tamperedHash);
      },
      /PAYLOAD_MISMATCH/,
      'Should reject payload hash mismatch'
    );
    console.log('✓ rejects payload hash mismatch');
  }

  console.log('All approvals tests passed!\n');
}

runTests();
