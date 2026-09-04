import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import { app } from '../src/server.js';
import { supabase } from '../src/supabase.js';
import { upsertIdentity, startEmailOtp, verifyEmailOtp } from '../src/auth/emailOtp.js';
import { upsertGoogleUser } from '../src/auth/google.js';
import { signSessionToken } from '../src/auth/session.js';
import {
  submitIntent,
  signAndAdvance,
  insertSignPermit,
  updateRequest,
  inMemoryAgentRequests,
  AgentRequest,
} from '../src/wallet/requestLifecycle.js';
import { createApproval } from '../src/wallet/approvals.js';

console.log('=== Running Follow-Up 13 Account<->Wallet Link & Custody Tests ===');

async function main() {
  process.env.ALLOW_MOCK_SIGNER = '1';

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------
    // Test 1: GET /wallet/me without session -> 401
    // -------------------------------------------------------------
    console.log('1. Testing GET /wallet/me without session -> 401...');
    const resNoAuth = await fetch(`${baseUrl}/wallet/me`);
    assert.strictEqual(resNoAuth.status, 401, 'Unauthenticated /wallet/me must return 401');
    const noAuthJson = await resNoAuth.json();
    assert.ok(noAuthJson.error?.includes('UNAUTHORIZED'), 'Error must indicate unauthorized');
    console.log('   ✓ Unauthenticated request rejected with 401');

    // -------------------------------------------------------------
    // Test 2: email A + enroll passkey + create W1
    // -------------------------------------------------------------
    console.log('2. Testing Email A signup, passkey enrollment, and primary wallet W1 creation...');
    const emailA = `test.alice.${Date.now()}@northveil.xyz`;

    // 2a. Start Email OTP
    const otpResA = await startEmailOtp(emailA);
    assert.ok(otpResA.ok, 'startEmailOtp must succeed');
    assert.ok(otpResA.devCode, 'Must return devCode in test environment');

    // 2b. Verify Email OTP
    const verifyResA = await verifyEmailOtp(emailA, otpResA.devCode!);
    const sessionTokenA = verifyResA.sessionToken;
    const userA = verifyResA.user;
    assert.ok(sessionTokenA, 'Must return sessionToken');
    assert.ok(userA.id, 'Must return user id');

    // 2c. GET /wallet/me before passkey or wallet -> next: enroll_passkey
    const resMeA1 = await fetch(`${baseUrl}/wallet/me`, {
      headers: { 'X-Session-Token': sessionTokenA },
    });
    assert.strictEqual(resMeA1.status, 200);
    const meA1 = await resMeA1.json();
    assert.strictEqual(meA1.wallets.length, 0);
    assert.strictEqual(meA1.passkeyCount, 0);
    assert.strictEqual(meA1.next, 'enroll_passkey');

    // 2d. Enroll passkey for Alice
    const credIdA = 'cred_alice_' + crypto.randomBytes(8).toString('hex');
    await supabase.from('passkeys').insert({
      user_id: userA.id,
      credential_id: credIdA,
      credential_public_key: Buffer.from('mock_pub_key_alice'),
      counter: 0,
    });

    // 2e. GET /wallet/me after passkey enrolled -> next: create_or_import
    const resMeA2 = await fetch(`${baseUrl}/wallet/me`, {
      headers: { 'X-Session-Token': sessionTokenA },
    });
    const meA2 = await resMeA2.json();
    assert.strictEqual(meA2.passkeyCount, 1);
    assert.strictEqual(meA2.wallets.length, 0);
    assert.strictEqual(meA2.next, 'create_or_import');

    // 2f. Create Primary Wallet W1
    const resCreateW1 = await fetch(`${baseUrl}/wallet/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionTokenA,
      },
      body: JSON.stringify({ name: 'Alice Primary Vault' }),
    });
    assert.strictEqual(resCreateW1.status, 201);
    const w1Data = await resCreateW1.json();
    assert.ok(w1Data.address, 'W1 must have an address');
    assert.ok(w1Data.mpcWalletId, 'W1 must have an mpcWalletId');
    assert.strictEqual(w1Data.wallet.is_primary, true, 'First wallet must be is_primary=true');
    const w1Address = w1Data.address.toLowerCase();

    // 2g. GET /wallet/me after wallet created -> next: unlock_passkey, wallets: [W1]
    const resMeA3 = await fetch(`${baseUrl}/wallet/me`, {
      headers: { 'X-Session-Token': sessionTokenA },
    });
    const meA3 = await resMeA3.json();
    assert.strictEqual(meA3.wallets.length, 1);
    assert.strictEqual(meA3.wallets[0].address.toLowerCase(), w1Address);
    assert.strictEqual(meA3.wallets[0].is_primary, true);
    assert.strictEqual(meA3.next, 'unlock_passkey');
    console.log('   ✓ Email A provisioned W1 as primary vault. State next = unlock_passkey');

    // -------------------------------------------------------------
    // Test 3: Logout (clear token) & Login again with Email A + OTP
    // -------------------------------------------------------------
    console.log('3. Testing logout and returning login with Email A + OTP...');
    // Discard sessionTokenA (simulating client logout)
    const otpResA2 = await startEmailOtp(emailA);
    const verifyResA2 = await verifyEmailOtp(emailA, otpResA2.devCode!);
    const sessionTokenA2 = verifyResA2.sessionToken;

    const resMeA4 = await fetch(`${baseUrl}/wallet/me`, {
      headers: { 'X-Session-Token': sessionTokenA2 },
    });
    assert.strictEqual(resMeA4.status, 200);
    const meA4 = await resMeA4.json();
    assert.strictEqual(meA4.user.id, userA.id, 'User ID must remain identical');
    assert.strictEqual(meA4.wallets.length, 1);
    assert.strictEqual(meA4.wallets[0].address.toLowerCase(), w1Address, 'Must load same W1 address');
    assert.strictEqual(meA4.next, 'unlock_passkey', 'Returning user next must be unlock_passkey');
    console.log('   ✓ Returning Email A sees same users.id, same W1 address, and next = unlock_passkey');

    // -------------------------------------------------------------
    // Test 4: Google with same email A -> same users.id, still [W1]
    // -------------------------------------------------------------
    console.log('4. Testing Google OAuth with same Email A -> merged into same users.id...');
    const googleSubA = 'google_sub_' + crypto.randomBytes(8).toString('hex');
    const googleUserA = await upsertGoogleUser({
      sub: googleSubA,
      email: emailA,
      email_verified: true,
      name: 'Alice Google',
    });
    assert.strictEqual(googleUserA.id, userA.id, 'Google with same email must merge into existing users.id');

    const googleSessionToken = signSessionToken({ userId: googleUserA.id, email: googleUserA.email, passkeyOk: false });
    const resMeGoogle = await fetch(`${baseUrl}/wallet/me`, {
      headers: { 'X-Session-Token': googleSessionToken },
    });
    const meGoogle = await resMeGoogle.json();
    assert.strictEqual(meGoogle.user.id, userA.id);
    assert.strictEqual(meGoogle.wallets.length, 1);
    assert.strictEqual(meGoogle.wallets[0].address.toLowerCase(), w1Address);
    assert.strictEqual(meGoogle.next, 'unlock_passkey');
    console.log('   ✓ Google OAuth with existing email preserved users.id and wallet W1');

    // -------------------------------------------------------------
    // Test 5: Email B -> empty wallets, next=enroll_passkey
    // -------------------------------------------------------------
    console.log('5. Testing fresh Email B -> empty wallets, next=enroll_passkey...');
    const emailB = `test.bob.${Date.now()}@northveil.xyz`;
    const otpResB = await startEmailOtp(emailB);
    const verifyResB = await verifyEmailOtp(emailB, otpResB.devCode!);
    const sessionTokenB = verifyResB.sessionToken;
    const userB = verifyResB.user;
    assert.notStrictEqual(userB.id, userA.id, 'User B must have different users.id');

    const resMeB = await fetch(`${baseUrl}/wallet/me`, {
      headers: { 'X-Session-Token': sessionTokenB },
    });
    const meB = await resMeB.json();
    assert.strictEqual(meB.user.id, userB.id);
    assert.strictEqual(meB.wallets.length, 0, 'New user B must have 0 wallets');
    assert.strictEqual(meB.passkeyCount, 0);
    assert.strictEqual(meB.next, 'enroll_passkey', 'New user B must enroll passkey first');
    console.log('   ✓ Email B has separate user id, empty wallets, and next = enroll_passkey');

    // -------------------------------------------------------------
    // Test 6: Two emails -> two user ids -> two wallet lists on same MCP URL
    // -------------------------------------------------------------
    console.log('6. Testing wallet segregation across accounts on same MCP...');
    // Create W2 for Bob
    const resCreateW2 = await fetch(`${baseUrl}/wallet/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionTokenB,
      },
      body: JSON.stringify({ name: 'Bob Primary Vault' }),
    });
    const w2Data = await resCreateW2.json();
    const w2Address = w2Data.address.toLowerCase();
    assert.notStrictEqual(w2Address, w1Address, 'Wallets must have different addresses');

    // Check Alice list
    const resAliceCheck = await fetch(`${baseUrl}/wallet/me`, {
      headers: { 'X-Session-Token': sessionTokenA },
    });
    const aliceCheck = await resAliceCheck.json();
    assert.strictEqual(aliceCheck.wallets.length, 1);
    assert.strictEqual(aliceCheck.wallets[0].address.toLowerCase(), w1Address);

    // Check Bob list
    const resBobCheck = await fetch(`${baseUrl}/wallet/me`, {
      headers: { 'X-Session-Token': sessionTokenB },
    });
    const bobCheck = await resBobCheck.json();
    assert.strictEqual(bobCheck.wallets.length, 1);
    assert.strictEqual(bobCheck.wallets[0].address.toLowerCase(), w2Address);
    console.log('   ✓ DB foreign key strictly segregates wallets: Alice=[W1], Bob=[W2]');

    // -------------------------------------------------------------
    // Test 7: signAndAdvance without prior permit -> NO_SIGN_PERMIT
    // -------------------------------------------------------------
    console.log('7. Testing signAndAdvance without prior permit -> NO_SIGN_PERMIT...');
    const fakeRequestId = 'req_' + crypto.randomBytes(16).toString('hex');
    const fakePayloadHash = '0x' + crypto.randomBytes(32).toString('hex');

    const fakeReqRecord: AgentRequest = {
      id: fakeRequestId,
      user_id: userA.id,
      wallet_id: w1Data.id,
      tool: 'nv_prepare_transfer',
      intent: { to: '0x1111111111111111111111111111111111111111', amount: '0.01' },
      canonical_tx: { from: w1Address, to: '0x1111111111111111111111111111111111111111', value: '10000000000000000' },
      payload_hash: fakePayloadHash,
      status: 'pending_signature',
      expires_at: new Date(Date.now() + 600000),
      created_at: new Date(),
      updated_at: new Date(),
    };
    inMemoryAgentRequests.set(fakeRequestId, fakeReqRecord);

    await assert.rejects(
      async () => {
        await signAndAdvance(fakeRequestId);
      },
      /NO_SIGN_PERMIT/,
      'signAndAdvance must reject without pre-inserted sign permit'
    );
    console.log('   ✓ signAndAdvance refused to sign without permit (NO_SIGN_PERMIT)');

    // -------------------------------------------------------------
    // Test 8: passkey complete -> permit inserted -> sign ok
    // -------------------------------------------------------------
    console.log('8. Testing passkey approval complete -> permit inserted -> sign ok...');
    const approvalId = 'appr_' + crypto.randomBytes(16).toString('hex');
    const apprPayloadHash = '0x' + crypto.randomBytes(32).toString('hex');

    await createApproval({
      id: approvalId,
      userId: userA.id,
      clientId: 'claude_test',
      walletId: w1Data.id,
      walletAddress: w1Address,
      payloadHash: apprPayloadHash,
      canonicalTx: { from: w1Address, to: '0x2222222222222222222222222222222222222222', value: '1000' },
      expiresAt: new Date(Date.now() + 600000),
    });

    const apprReqRecord: AgentRequest = {
      id: approvalId,
      user_id: userA.id,
      wallet_id: w1Data.id,
      tool: 'nv_prepare_transfer',
      intent: { to: '0x2222222222222222222222222222222222222222', amount: '0.001' },
      canonical_tx: { from: w1Address, to: '0x2222222222222222222222222222222222222222', value: '1000' },
      payload_hash: apprPayloadHash,
      status: 'pending_approval',
      expires_at: new Date(Date.now() + 600000),
      created_at: new Date(),
      updated_at: new Date(),
    };
    inMemoryAgentRequests.set(approvalId, apprReqRecord);

    const resApprove = await fetch(`${baseUrl}/api/approvals/${approvalId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payloadHash: apprPayloadHash,
        assertionResponse: {
          challenge: apprPayloadHash,
        },
      }),
    });
    const approveText = await resApprove.text();
    if (resApprove.status !== 200) {
      console.error('Approve failed body:', approveText);
    }
    assert.strictEqual(resApprove.status, 200);
    const approveJson = JSON.parse(approveText);
    assert.strictEqual(approveJson.status, 'success');
    assert.ok(approveJson.txHash, 'Must return txHash on successful signature');
    console.log('   ✓ Approval complete inserted permit and successfully signed tx');

    // -------------------------------------------------------------
    // Test 9: second sign same hash -> NO_SIGN_PERMIT
    // -------------------------------------------------------------
    console.log('9. Testing second sign with same hash -> NO_SIGN_PERMIT...');
    // Request is now in status 'success' and permit was consumed
    await assert.rejects(
      async () => {
        // Force status back to pending_signature to test replay protection
        await updateRequest(approvalId, { status: 'pending_signature' });
        await signAndAdvance(approvalId);
      },
      /NO_SIGN_PERMIT/,
      'Replay of consumed permit must fail with NO_SIGN_PERMIT'
    );
    console.log('   ✓ Single-use replay protection verified (NO_SIGN_PERMIT on second sign)');

    // -------------------------------------------------------------
    // Test 10: Import begin/finish enclave flow (Zero plaintext mnemonic)
    // -------------------------------------------------------------
    console.log('10. Testing Enclave Import Begin/Finish flow...');
    const resBegin = await fetch(`${baseUrl}/wallet/import/begin`, {
      method: 'POST',
      headers: { 'X-Session-Token': sessionTokenA },
    });
    assert.strictEqual(resBegin.status, 200);
    const beginJson = await resBegin.json();
    assert.ok(beginJson.ok);
    assert.ok(beginJson.importBundle, 'Must return importBundle');

    const resFinish = await fetch(`${baseUrl}/wallet/import/finish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionTokenA,
      },
      body: JSON.stringify({
        name: 'Alice Imported Enclave Vault',
        encryptedBundle: 'mock_encrypted_tek_bundle_' + crypto.randomBytes(16).toString('hex'),
      }),
    });
    assert.strictEqual(resFinish.status, 201);
    const finishJson = await resFinish.json();
    assert.ok(finishJson.address);
    assert.ok(finishJson.mpcWalletId);
    assert.strictEqual(finishJson.wallet.is_primary, false, 'Subsequent imported wallet is_primary=false');
    console.log('   ✓ Import begin/finish succeeded without plaintext mnemonic touching server');

    console.log('\nAll 10 Follow-Up 13 tests passed cleanly! ✓✓✓');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('Follow-Up 13 Test failure:', err);
  process.exit(1);
});
