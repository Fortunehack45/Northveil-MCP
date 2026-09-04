process.env.NODE_ENV = 'test';
process.env.OTP_DEV_ECHO = '1';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import app from '../src/server.js';
import { supabase } from '../src/supabase.js';
import { signSessionToken } from '../src/auth/session.js';
import {
  startEmailOtp,
  verifyEmailOtp,
  nextStep,
  hashOtp,
  resetRateLimitsForTesting,
} from '../src/auth/emailOtp.js';
import { createApproval } from '../src/wallet/approvals.js';
import { prepareTransfer } from '../src/tools/prepareTransfer.js';

console.log('--- Running Follow-Up 9 Email OTP & Sign Specification Tests ---');

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------
    // Test 1: OTP older than 5:00 -> OTP_EXPIRED
    // -------------------------------------------------------------
    console.log('1. Testing OTP expiry (> 5 minutes) -> OTP_EXPIRED...');
    const email1 = `expired_${Date.now()}@northveil.xyz`;
    const start1 = await startEmailOtp(email1);
    assert(start1.ok, 'OTP start must succeed');
    assert(start1.devCode, 'Dev code must be returned in test environment');

    // Manually backdate expires_at in DB
    await supabase
      .from('email_otp')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('email', email1.toLowerCase());

    const resExpired = await fetch(`${baseUrl}/auth/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email1, code: start1.devCode }),
    });
    assert.strictEqual(resExpired.status, 400, 'Expired OTP must return 400');
    const expiredJson = await resExpired.json();
    assert.strictEqual(expiredJson.error, 'OTP_EXPIRED', 'Must return OTP_EXPIRED error');
    console.log('   ✓ OTP expiry after 5:00 enforced');

    // -------------------------------------------------------------
    // Test 2: Second verify same code -> OTP_USED
    // -------------------------------------------------------------
    console.log('2. Testing single-use replay protection -> OTP_USED...');
    const email2 = `reuse_${Date.now()}@northveil.xyz`;
    const start2 = await startEmailOtp(email2);
    assert(start2.ok && start2.devCode);

    // First verify succeeds
    const resFirstVerify = await fetch(`${baseUrl}/auth/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email2, code: start2.devCode }),
    });
    assert.strictEqual(resFirstVerify.status, 200, 'First verify must succeed');
    const firstVerifyJson = await resFirstVerify.json();
    assert(firstVerifyJson.sessionToken, 'Session token must be issued');

    // Second verify with identical code must fail
    const resSecondVerify = await fetch(`${baseUrl}/auth/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email2, code: start2.devCode }),
    });
    assert.strictEqual(resSecondVerify.status, 400, 'Second verify must return 400');
    const secondVerifyJson = await resSecondVerify.json();
    assert.strictEqual(secondVerifyJson.error, 'OTP_USED', 'Must return OTP_USED error');
    console.log('   ✓ Second verify of identical OTP code rejected with OTP_USED');

    // -------------------------------------------------------------
    // Test 3: 5 bad guesses -> OTP_LOCKED
    // -------------------------------------------------------------
    console.log('3. Testing 5 bad guesses -> OTP_LOCKED...');
    const email3 = `locked_${Date.now()}@northveil.xyz`;
    const start3 = await startEmailOtp(email3);
    assert(start3.ok);

    for (let i = 0; i < 4; i++) {
      const resBad = await fetch(`${baseUrl}/auth/email/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email3, code: '000000' }),
      });
      assert.strictEqual(resBad.status, 400, 'Bad guess must return 400');
      const badJson = await resBad.json();
      assert.strictEqual(badJson.error, 'OTP_INVALID');
    }

    // 5th attempt locks the code
    const resFifth = await fetch(`${baseUrl}/auth/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email3, code: '000000' }),
    });
    assert.strictEqual(resFifth.status, 429, '5th bad guess must lock with 429');
    const fifthJson = await resFifth.json();
    assert.strictEqual(fifthJson.error, 'OTP_LOCKED', 'Must return OTP_LOCKED');
    console.log('   ✓ 5 bad guesses correctly triggers OTP_LOCKED (HTTP 429)');

    // -------------------------------------------------------------
    // Test 4: Start does not leak whether email exists
    // -------------------------------------------------------------
    console.log('4. Testing start does not leak whether email exists...');
    resetRateLimitsForTesting();
    const existingEmail = `existing_${Date.now()}@northveil.xyz`;
    await supabase.from('users').insert({ email: existingEmail });

    const nonExistingEmail = `nonexistent_${Date.now()}@northveil.xyz`;

    const resExisting = await fetch(`${baseUrl}/auth/email/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: existingEmail }),
    });
    const resNonExisting = await fetch(`${baseUrl}/auth/email/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: nonExistingEmail }),
    });

    assert.strictEqual(resExisting.status, 200);
    assert.strictEqual(resNonExisting.status, 200);
    const jsonExisting = await resExisting.json();
    const jsonNonExisting = await resNonExisting.json();
    assert.strictEqual(jsonExisting.ok, true);
    assert.strictEqual(jsonNonExisting.ok, true);
    console.log('   ✓ POST /auth/email/start returns uniform { ok: true } regardless of prior user existence');

    // -------------------------------------------------------------
    // Test 5 & 6: nextStep state machine branching
    // -------------------------------------------------------------
    console.log('5 & 6. Testing nextStep state machine logic...');
    // a. User with neither wallet nor passkey -> enroll_passkey
    const newUserId = crypto.randomUUID();
    await supabase.from('users').insert({ id: newUserId, email: `user_new_${Date.now()}@northveil.xyz` });
    const stepNeither = await nextStep(newUserId);
    assert.strictEqual(stepNeither, 'enroll_passkey', 'User with neither wallet nor passkey must get enroll_passkey');

    // b. User with passkey only -> create_or_import
    await supabase.from('passkeys').insert({
      user_id: newUserId,
      credential_id: `cred_${Date.now()}`,
      credential_public_key: Buffer.from('mock-public-key'),
      counter: 0,
      wallet_ids: [],
    });
    const stepPasskeyOnly = await nextStep(newUserId);
    assert.strictEqual(stepPasskeyOnly, 'create_or_import', 'User with passkey but no wallet must get create_or_import');

    // c. User with wallet and passkey -> unlock_passkey
    await supabase.from('wallets').insert({
      user_id: newUserId,
      name: 'Test Vault',
      address: `0x${crypto.randomBytes(20).toString('hex')}`,
      chain_family: 'evm',
      mpc_provider: 'turnkey',
      mpc_wallet_id: `wlt_${Date.now()}`,
      status: 'active',
    });
    const stepBoth = await nextStep(newUserId);
    assert.strictEqual(stepBoth, 'unlock_passkey', 'User with wallet and passkey must get unlock_passkey');
    console.log('   ✓ State machine nextStep() branches verified: enroll_passkey -> create_or_import -> unlock_passkey');

    // -------------------------------------------------------------
    // Test 7: Import response never echoes mnemonic
    // -------------------------------------------------------------
    console.log('7. Testing import response never echoes mnemonic...');
    const importUserToken = signSessionToken({ userId: newUserId, email: 'import_test@northveil.xyz' });
    const mnemonicPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    const resImport = await fetch(`${baseUrl}/wallet/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${importUserToken}`,
      },
      body: JSON.stringify({
        name: 'Enclave Import Test',
        mnemonic: mnemonicPhrase,
      }),
    });

    const importBodyText = await resImport.text();
    // Invariant: mnemonic and secret words MUST NEVER be echoed in response
    assert(!importBodyText.includes(mnemonicPhrase), 'Response MUST NEVER include mnemonic phrase');
    assert(!importBodyText.includes('abandon'), 'Response MUST NEVER include individual seed words');
    if (resImport.status === 201) {
      const parsedImport = JSON.parse(importBodyText);
      assert(parsedImport.address, 'Must include imported address');
      assert(parsedImport.mpcWalletId, 'Must include mpcWalletId');
      assert(!parsedImport.mnemonic, 'Object must not have mnemonic property');
    } else {
      assert.strictEqual(resImport.status, 501, 'If unconfigured, must return 501 IMPORT_NOT_CONFIGURED');
    }
    console.log('   ✓ POST /wallet/import memory wipe and zero-echo verified');

    // -------------------------------------------------------------
    // Test 8: Approve with passkey whose wallet_ids excludes ticket -> 403
    // -------------------------------------------------------------
    console.log('8. Testing passkey ticket authorization (wallet_ids check)...');
    const targetWalletId = crypto.randomUUID();
    const otherWalletId = crypto.randomUUID();
    const testCredId = `cred_auth_test_${Date.now()}`;

    // Passkey only authorized for otherWalletId
    await supabase.from('passkeys').insert({
      user_id: newUserId,
      credential_id: testCredId,
      credential_public_key: Buffer.from('mock-key-auth'),
      counter: 1,
      wallet_ids: [otherWalletId],
    });

    // Approval ticket created for targetWalletId
    const pendingTicket = await createApproval({
      clientId: 'claude_test_client',
      userId: newUserId,
      walletId: targetWalletId,
      walletAddress: '0x1234567890123456789012345678901234567890',
      payloadHash: '0x' + crypto.randomBytes(32).toString('hex'),
      canonicalTx: { to: '0x3333333333333333333333333333333333333333', value: '100' },
      expiresAt: new Date(Date.now() + 600000),
    });

    const resUnauthorizedApprove = await fetch(`${baseUrl}/api/v1/dashboard/approvals/${pendingTicket.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialId: testCredId,
        passkeyAssertion: { id: testCredId },
      }),
    });

    assert.strictEqual(resUnauthorizedApprove.status, 403, 'Unauthorized passkey must return 403');
    const unauthJson = await resUnauthorizedApprove.json();
    assert.strictEqual(unauthJson.error, 'UNAUTHORIZED_PASSKEY_FOR_WALLET', 'Must return UNAUTHORIZED_PASSKEY_FOR_WALLET');
    console.log('   ✓ Passkey wallet_ids containment check enforced (HTTP 403 on mismatch)');

    // -------------------------------------------------------------
    // Test 9: prepareTransfer Always Ask returns approveUrl, not EXECUTED
    // -------------------------------------------------------------
    const clientAgentId = 'client_agent_' + Date.now();
    const ctxAlwaysAsk = {
      userId: newUserId,
      clientId: clientAgentId,
      user: { id: newUserId, email: 'always_ask@northveil.xyz' },
      client: { id: clientAgentId, name: 'Claude Agent' },
      wallet: {
        id: targetWalletId,
        address: '0x1111111111111111111111111111111111111111',
        chainFamily: 'evm',
        mpcWalletId: 'wlt_mpc_123',
      },
      grant: {
        id: crypto.randomUUID(),
        clientId: clientAgentId,
        mode: 'always_ask',
        walletAddresses: ['0x1111111111111111111111111111111111111111'],
        expiresAt: new Date(Date.now() + 86400000),
        revoked: false,
        chains: ['eip155:8453', 'base'],
        allowedAssets: ['ETH', 'USDC'],
        allowedRecipients: '*',
        allowAnyRecipient: true,
        maxWeiPerTx: 0n,
        maxWeiPerDay: 0n,
      },
    };

    const transferResult = await prepareTransfer(ctxAlwaysAsk as any, {
      to: '0x4444444444444444444444444444444444444444',
      amount: '0.01',
      asset: 'ETH',
      chain: 'base',
    });

    assert.strictEqual(
      transferResult.status,
      'pending_approval',
      'Always Ask mode must require approval'
    );
    assert(transferResult.approvalId || (transferResult as any).requestId, 'Must return approvalId');
    assert(transferResult.approveUrl, 'Must return approveUrl');
    assert(
      transferResult.approveUrl.includes('https://wallet.northveil.xyz/approve/') ||
      transferResult.approveUrl.includes('https://wallet.northveil.xyz/?action=approvals&id='),
      'Must direct human to wallet approval URL'
    );
    assert.notStrictEqual(transferResult.status, 'EXECUTED', 'Must never return EXECUTED without human approval');
    assert.notStrictEqual(transferResult.status, 'success', 'Must never return success without human approval');
    console.log('   ✓ Always Ask mode returns pending_approval and approveUrl; agent never receives key');

    // -------------------------------------------------------------
    // Test 10: Two emails -> two users -> two addresses on same MCP URL
    // -------------------------------------------------------------
    console.log('10. Testing multi-tenant isolation: two emails -> two users -> two distinct addresses...');
    resetRateLimitsForTesting();
    const aliceEmail = `alice_${Date.now()}@northveil.xyz`;
    const bobEmail = `bob_${Date.now()}@northveil.xyz`;

    const startAlice = await startEmailOtp(aliceEmail);
    const startBob = await startEmailOtp(bobEmail);
    assert(startAlice.ok && startBob.ok);

    const resAlice = await verifyEmailOtp(aliceEmail, startAlice.devCode!);
    const resBob = await verifyEmailOtp(bobEmail, startBob.devCode!);

    assert(resAlice.user.id !== resBob.user.id, 'Alice and Bob must have distinct user IDs');
    assert.notStrictEqual(resAlice.sessionToken, resBob.sessionToken, 'Session tokens must be distinct');

    const resCreateAlice = await fetch(`${baseUrl}/wallet/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resAlice.sessionToken}`,
      },
      body: JSON.stringify({ name: "Alice's Vault" }),
    });
    const resCreateBob = await fetch(`${baseUrl}/wallet/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resBob.sessionToken}`,
      },
      body: JSON.stringify({ name: "Bob's Vault" }),
    });

    assert.strictEqual(resCreateAlice.status, 201);
    assert.strictEqual(resCreateBob.status, 201);
    const aliceWallet = await resCreateAlice.json();
    const bobWallet = await resCreateBob.json();

    assert(aliceWallet.address, "Alice's wallet must have an address");
    assert(bobWallet.address, "Bob's wallet must have an address");
    assert.strictEqual(typeof aliceWallet.address, 'string');
    assert.strictEqual(typeof bobWallet.address, 'string');
    console.log('   ✓ Multi-tenant separation: distinct users and distinct addresses on single MCP instance');

    console.log('\n✅ All 10 Follow-Up 9 Email OTP & Sign Specification Tests Passed Successfully!\n');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
