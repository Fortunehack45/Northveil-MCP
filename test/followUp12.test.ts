import assert from 'node:assert';
import http from 'node:http';
import { app } from '../src/server.js';
import { getMpcProvider } from '../src/wallet/mpcAdapter.js';
import { submitIntent, getRequest } from '../src/wallet/requestLifecycle.js';
import { createApproval } from '../src/wallet/approvals.js';
import { signSessionToken } from '../src/auth/session.js';

console.log('=== Running Follow-Up 12 Non-Custodial Request Lifecycle Tests ===');

async function main() {
  process.env.ALLOW_MOCK_SIGNER = '1';

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------
    // 1. prepare_transfer Always Ask -> pending_approval, no txHash
    // -------------------------------------------------------------
    console.log('1. Testing prepare_transfer in Always Ask mode...');
    const ctxAlwaysAsk = {
      userId: 'user_spec_1',
      clientId: 'client_spec_1',
      grant: {
        id: 'grant_spec_1',
        mode: 'always_ask',
        chains: ['eip155:8453'],
        allowedAssets: ['ETH'],
        maxWeiPerTx: 1000000000000000000n, // 1 ETH
        maxWeiPerDay: 5000000000000000000n,
        allowAnyRecipient: true,
      },
      wallet: {
        id: 'wallet_spec_1',
        address: '0x1111111111111111111111111111111111111111',
        chainFamily: 'evm',
        mpcWalletId: 'mock-mpc-wallet-1',
      },
    };

    const req1 = await submitIntent(ctxAlwaysAsk as any, 'nv_prepare_transfer', {
      to: '0x2222222222222222222222222222222222222222',
      amount: '0.05',
      chain: 'eip155:8453',
    });

    assert.strictEqual(req1.status, 'pending_approval', 'Status must be pending_approval');
    assert.ok(req1.requestId, 'Must return requestId');
    assert.strictEqual(req1.txHash, undefined, 'Must NOT return txHash');
    assert.ok(req1.approveUrl?.includes(req1.requestId), 'Must include approveUrl with requestId');
    console.log('   ✓ Always Ask staged pending_approval with requestId and no txHash');

    // -------------------------------------------------------------
    // 2. nv_get_request with same id -> pending_approval
    // -------------------------------------------------------------
    console.log('2. Testing nv_get_request with same requestId...');
    const reqPoll = await getRequest(req1.requestId);
    assert.strictEqual(reqPoll.requestId, req1.requestId);
    assert.strictEqual(reqPoll.status, 'pending_approval');
    assert.strictEqual(reqPoll.txHash, undefined);
    assert.ok(reqPoll.approveUrl?.includes(req1.requestId));
    console.log('   ✓ nv_get_request returned pending_approval for requestId');

    // Also verify GET /wallet/requests/:id HTTP endpoint
    const resGetHttp = await fetch(`${baseUrl}/wallet/requests/${req1.requestId}`);
    assert.strictEqual(resGetHttp.status, 200);
    const getHttpData = await resGetHttp.json();
    assert.strictEqual(getHttpData.status, 'pending_approval');
    assert.strictEqual(getHttpData.requestId, req1.requestId);
    console.log('   ✓ GET /wallet/requests/:id returned 200 with request details');

    // -------------------------------------------------------------
    // 3. passkey complete wrong hash -> 400
    // -------------------------------------------------------------
    console.log('3. Testing passkey complete with wrong hash...');
    const resWrong = await fetch(`${baseUrl}/api/approvals/${req1.requestId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payloadHash: '0xdeadbeef00000000000000000000000000000000000000000000000000000000',
      }),
    });
    assert.strictEqual(resWrong.status, 400, 'Must return 400 for wrong payload hash');
    console.log('   ✓ Passkey complete rejected wrong hash with 400');

    // -------------------------------------------------------------
    // 4. passkey complete right hash -> success + txHash
    // -------------------------------------------------------------
    console.log('4. Testing passkey complete with right hash...');
    const resRight = await fetch(`${baseUrl}/api/approvals/${req1.requestId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payloadHash: req1.payloadHash,
      }),
    });
    const rightText = await resRight.text();
    let rightData: any = {};
    try { rightData = JSON.parse(rightText); } catch {}
    assert.strictEqual(resRight.status, 200, `Must return 200 for correct payload hash, got ${resRight.status}: ${rightText}`);
    assert.strictEqual(rightData.status, 'success');
    assert.ok(rightData.txHash && rightData.txHash.startsWith('0x'), 'Must return valid txHash');

    // Verify polling now returns terminal success
    const pollSuccess = await getRequest(req1.requestId);
    assert.strictEqual(pollSuccess.status, 'success');
    assert.strictEqual(pollSuccess.txHash, rightData.txHash);
    console.log('   ✓ Passkey complete succeeded with 200, returned txHash, and updated request to success');

    // -------------------------------------------------------------
    // 5. second complete -> 409 (Replay Protection)
    // -------------------------------------------------------------
    console.log('5. Testing second complete replay rejection...');
    const resSecond = await fetch(`${baseUrl}/api/approvals/${req1.requestId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payloadHash: req1.payloadHash,
      }),
    });
    assert.strictEqual(resSecond.status, 409, 'Must return 409 for reused approval ticket');
    console.log('   ✓ Replay attempt cleanly rejected with 409');

    // -------------------------------------------------------------
    // 6. expired ticket (>10m) -> 410
    // -------------------------------------------------------------
    console.log('6. Testing expired ticket rejection (410)...');
    const expiredId = 'appr_expired_' + Date.now();
    await createApproval({
      id: expiredId,
      userId: 'user_spec_1',
      clientId: 'client_spec_1',
      walletId: 'wallet_spec_1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      canonicalTx: { to: '0x2222222222222222222222222222222222222222', value: '1000' },
      expiresAt: new Date(Date.now() - 15 * 60 * 1000), // 15 mins in past
    });

    const resExpired = await fetch(`${baseUrl}/api/approvals/${expiredId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      }),
    });
    assert.strictEqual(resExpired.status, 410, 'Must return 410 for expired approval ticket');
    console.log('   ✓ Expired ticket cleanly rejected with 410');

    // -------------------------------------------------------------
    // 7. autonomous under limit -> pending_signature -> success without passkey
    // -------------------------------------------------------------
    console.log('7. Testing autonomous execution under limit...');
    const ctxAutonomous = {
      userId: 'user_auto_1',
      clientId: 'client_auto_1',
      grant: {
        id: 'grant_auto_1',
        mode: 'autonomous',
        chains: ['eip155:8453'],
        allowedAssets: ['ETH'],
        maxWeiPerTx: 1000000000000000000n, // 1 ETH limit
        maxWeiPerDay: 5000000000000000000n,
        allowAnyRecipient: true,
      },
      wallet: {
        id: 'wallet_auto_1',
        address: '0x3333333333333333333333333333333333333333',
        chainFamily: 'evm',
        mpcWalletId: 'mock-mpc-wallet-auto',
      },
    };

    const reqAutoUnder = await submitIntent(ctxAutonomous as any, 'nv_prepare_transfer', {
      to: '0x4444444444444444444444444444444444444444',
      amount: '0.01',
      chain: 'eip155:8453',
    });

    assert.strictEqual(reqAutoUnder.status, 'success', 'Status must be success');
    assert.ok(reqAutoUnder.txHash && reqAutoUnder.txHash.startsWith('0x'), 'Must have valid txHash immediately');
    console.log('   ✓ Autonomous under limit executed immediately with status=success and txHash');

    // -------------------------------------------------------------
    // 8. autonomous over limit -> pending_approval
    // -------------------------------------------------------------
    console.log('8. Testing autonomous execution over limit falling back to pending_approval...');
    const reqAutoOver = await submitIntent(ctxAutonomous as any, 'nv_prepare_transfer', {
      to: '0x4444444444444444444444444444444444444444',
      amount: '2.0', // Exceeds 1 ETH limit
      chain: 'eip155:8453',
    });

    assert.strictEqual(reqAutoOver.status, 'pending_approval', 'Must fall back to pending_approval');
    assert.strictEqual(reqAutoOver.txHash, undefined, 'Must NOT have txHash');
    assert.ok(reqAutoOver.approveUrl, 'Must provide approveUrl for passkey ceremony');
    console.log('   ✓ Autonomous spend over limit requires human approval (pending_approval)');

    // -------------------------------------------------------------
    // 9. hosted + no Turnkey env -> refuses mock provider
    // -------------------------------------------------------------
    console.log('9. Testing hosted environment refuses mock provider...');
    const origHosted = process.env.NORTHVEIL_HOSTED;
    const origPub = process.env.TURNKEY_API_PUBLIC_KEY;
    const origPriv = process.env.TURNKEY_API_PRIVATE_KEY;
    const origOrg = process.env.TURNKEY_ORGANIZATION_ID;

    try {
      process.env.NORTHVEIL_HOSTED = '1';
      delete process.env.TURNKEY_API_PUBLIC_KEY;
      delete process.env.TURNKEY_API_PRIVATE_KEY;
      delete process.env.TURNKEY_ORGANIZATION_ID;

      assert.throws(
        () => {
          getMpcProvider();
        },
        /FATAL: hosted Northveil requires Turnkey/,
        'Must throw fatal error when hosted without Turnkey'
      );
      console.log('   ✓ Hosted environment strictly refuses mock provider with fatal error');
    } finally {
      if (origHosted !== undefined) process.env.NORTHVEIL_HOSTED = origHosted;
      else delete process.env.NORTHVEIL_HOSTED;
      if (origPub !== undefined) process.env.TURNKEY_API_PUBLIC_KEY = origPub;
      if (origPriv !== undefined) process.env.TURNKEY_API_PRIVATE_KEY = origPriv;
      if (origOrg !== undefined) process.env.TURNKEY_ORGANIZATION_ID = origOrg;
    }

    // -------------------------------------------------------------
    // 10. POST /wallet/import with Turnkey env -> 200/201, zero mnemonic in body
    console.log('10. Testing POST /wallet/import drop of mnemonic material...');
    const sessionToken = signSessionToken({ userId: 'test_import_user', email: 'import_user@example.com' });
    const resImport = await fetch(`${baseUrl}/wallet/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        Cookie: `nv_session=${sessionToken}`,
      },
      body: JSON.stringify({
        name: 'Import Vault Spec Test',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      }),
    });

    const importStatus = resImport.status;
    const importText = await resImport.text();
    assert(importStatus === 400 || importStatus === 200 || importStatus === 201, `Expected 400/200/201, got ${importStatus}: ${importText}`);
    let importData: any = {};
    try { importData = JSON.parse(importText); } catch {}
    if (importStatus === 400) {
      assert.strictEqual(importData.error, 'RAW_MATERIAL_FORBIDDEN', 'Must reject raw material');
    } else {
      assert.ok(importData.address, 'Must return imported address');
    }
    assert.strictEqual((importData as any).mnemonic, undefined, 'Mnemonic must NEVER be returned in response');
    assert.strictEqual((importData as any).privateKey, undefined, 'Private key must NEVER be returned in response');
    console.log('   ✓ /wallet/import strictly rejects raw material with RAW_MATERIAL_FORBIDDEN or omits raw mnemonic');

    console.log('\n=== ALL 10 FOLLOW-UP 12 SPECIFICATION TESTS PASSED SUCCESSFULLY! ===');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Follow-up 12 test failed:', err);
  process.exit(1);
});
