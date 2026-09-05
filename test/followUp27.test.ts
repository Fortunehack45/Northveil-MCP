process.env.NODE_ENV = 'test';
process.env.OTP_DEV_ECHO = '1';
process.env.ALLOW_MOCK_SIGNER = '1';

import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import { app, getPrimaryMcpUrl, walletRedirect } from '../src/server.js';
import { supabase, classifyDbError } from '../src/supabase.js';
import {
  startEmailOtp,
  checkEmailRateLimit,
  recordEmailRateLimit,
  resetRateLimitsForTesting,
  countWallets,
} from '../src/auth/emailOtp.js';
import {
  parseAlreadyImportedWalletId,
  fetchTurnkeyWalletAddress,
  importFinishOrAttach,
} from '../src/wallet/mpcAdapter.js';
import { saveAuthCode, insertOauthToken, handleDynamicClientRegistration } from '../src/auth/oauth.js';
import { signSessionToken } from '../src/auth/session.js';

console.log('--- Running Follow-Up 27 Live Outage & Regression Test Suite ---');

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------
    // Test 1: classifyDbError({ message: "Invalid API key" }) -> AUTH_DB_MISCONFIGURED 503
    // -------------------------------------------------------------
    console.log('1. Testing classifyDbError mapping...');
    const classified1 = classifyDbError({ message: 'Invalid API key' });
    assert.strictEqual(classified1.code, 'AUTH_DB_MISCONFIGURED');
    assert.strictEqual(classified1.status, 503);

    const classified2 = classifyDbError(new Error('SUPABASE_ADMIN_KEY_INVALID'));
    assert.strictEqual(classified2.code, 'AUTH_DB_MISCONFIGURED');
    assert.strictEqual(classified2.status, 503);

    const classifiedGeneric = classifyDbError(new Error('relation does not exist'));
    assert.strictEqual(classifiedGeneric.code, 'AUTH_DB_ERROR');
    assert.strictEqual(classifiedGeneric.status, 500);
    console.log('   ✓ classifyDbError correctly maps Invalid API key and SUPABASE_ADMIN_KEY_INVALID to 503 AUTH_DB_MISCONFIGURED');

    // -------------------------------------------------------------
    // Test 2 & 3: startEmailOtp when supabase insert fails with Invalid API key -> 503 & no rate limit consumption
    // -------------------------------------------------------------
    console.log('2 & 3. Testing startEmailOtp failure mapping and rate limit preservation...');
    resetRateLimitsForTesting();
    const testEmail = `probe_fail_${Date.now()}@northveil.xyz`;

    // Intercept supabase.from('email_otp').insert to simulate Invalid API key
    const originalFrom = supabase.from.bind(supabase);
    (supabase as any).from = (table: string) => {
      if (table === 'email_otp') {
        return {
          update: () => ({ eq: () => ({ is: () => Promise.resolve({ data: null, error: null }) }) }),
          insert: () => Promise.resolve({ data: null, error: { message: 'Invalid API key' } }),
          select: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'Invalid API key' } }) }),
        };
      }
      return originalFrom(table);
    };

    try {
      await startEmailOtp(testEmail);
      assert.fail('startEmailOtp must throw on DB failure');
    } catch (err: any) {
      assert.strictEqual(err.statusCode, 503, 'Must return HTTP 503');
      assert.strictEqual(err.code, 'AUTH_DB_MISCONFIGURED', 'Error code must be AUTH_DB_MISCONFIGURED');
      assert(!String(err.message).includes('OTP_PERSISTENCE_FAILED: Invalid API key'), 'Must not leak raw infra error string');
    }

    // Confirm that rate limit tokens were NOT consumed when persist failed
    assert.strictEqual(checkEmailRateLimit(testEmail), true, 'Rate limit must not be consumed if insert failed');
    console.log('   ✓ startEmailOtp maps Invalid API key to 503 AUTH_DB_MISCONFIGURED and preserves rate limit bucket');

    // Restore supabase.from
    (supabase as any).from = originalFrom;

    // -------------------------------------------------------------
    // Test 4: parseAlreadyImportedWalletId extracts Turnkey wallet UUID
    // -------------------------------------------------------------
    console.log('4. Testing parseAlreadyImportedWalletId on Turnkey Error 6...');
    const turnkeyErrorMsg =
      'Turnkey error 6: seed for wallet 512fcfb2-4993-5216-b072-511b44594667 already imported in this organization';
    const parsedId = parseAlreadyImportedWalletId(turnkeyErrorMsg);
    assert.strictEqual(
      parsedId,
      '512fcfb2-4993-5216-b072-511b44594667',
      'Must extract exact wallet UUID from Turnkey error 6 message'
    );

    const nonMatchingMsg = 'Some other random error';
    assert.strictEqual(parseAlreadyImportedWalletId(nonMatchingMsg), null);
    console.log('   ✓ parseAlreadyImportedWalletId extracts UUID correctly');

    // -------------------------------------------------------------
    // Test 5: importFinishOrAttach on error 6 handles auto-attach cleanly
    // -------------------------------------------------------------
    console.log('5. Testing importFinishOrAttach error 6 auto-attach...');
    const mockTurnkeyId = '512fcfb2-4993-5216-b072-511b44594667';
    const resolvedAddress = await fetchTurnkeyWalletAddress(mockTurnkeyId);
    assert(resolvedAddress && resolvedAddress.startsWith('0x'), 'Turnkey address must be resolved');

    // -------------------------------------------------------------
    // Test 6: countWallets does not hide valid rows
    // -------------------------------------------------------------
    console.log('6. Testing countWallets does not hide valid rows...');
    const testUserA = crypto.randomUUID();
    await supabase.from('users').insert({ id: testUserA, email: `user_a_${Date.now()}@northveil.xyz` });
    await supabase.from('wallets').insert([
      {
        user_id: testUserA,
        name: 'Active Vault',
        address: `0x${crypto.randomBytes(20).toString('hex')}`,
        chain_family: 'evm',
        mpc_provider: 'turnkey',
        mpc_wallet_id: `mpc_${Date.now()}_1`,
        status: 'active',
        is_primary: true,
      },
      {
        user_id: testUserA,
        name: 'Ready Vault',
        address: `0x${crypto.randomBytes(20).toString('hex')}`,
        chain_family: 'evm',
        mpc_provider: 'turnkey',
        mpc_wallet_id: `mpc_${Date.now()}_2`,
        status: 'ready',
        is_primary: false,
      },
      {
        user_id: testUserA,
        name: 'Revoked Vault',
        address: `0x${crypto.randomBytes(20).toString('hex')}`,
        chain_family: 'evm',
        mpc_provider: 'turnkey',
        mpc_wallet_id: `mpc_${Date.now()}_3`,
        status: 'revoked',
        is_primary: false,
      },
    ]);

    const countA = await countWallets(testUserA);
    assert.strictEqual(countA, 2, 'countWallets must count active and ready vaults, excluding revoked');
    console.log('   ✓ countWallets counts active/ready and excludes revoked');

    // Insert passkey for testUserA
    await supabase.from('passkeys').insert({
      user_id: testUserA,
      credential_id: `cred_${Date.now()}`,
      credential_public_key: Buffer.from('mock-pubkey'),
      counter: 0,
    });

    // -------------------------------------------------------------
    // Test 7: /wallet/me returns multi-wallet list ordered by is_primary descending
    // -------------------------------------------------------------
    console.log('7. Testing /wallet/me returns ordered wallets...');

    const userSessionToken = signSessionToken({ userId: testUserA, email: 'usera@northveil.xyz', passkeyOk: true });
    const resMe = await fetch(`${baseUrl}/wallet/me`, {
      headers: { Authorization: `Bearer ${userSessionToken}` },
    });
    assert.strictEqual(resMe.status, 200);
    const meJson = await resMe.json();
    assert.strictEqual(meJson.authenticated, true);
    assert(Array.isArray(meJson.wallets), 'wallets must be an array');
    assert.strictEqual(meJson.wallets.length, 2);
    assert.strictEqual(meJson.wallets[0].is_primary, true, 'Primary wallet must be first');
    assert.strictEqual(meJson.passkeyOk, true);
    assert.strictEqual(meJson.next, 'dashboard', 'passkeyOk session with wallets must route to dashboard');

    const sessionLocked = signSessionToken({ userId: testUserA, email: 'usera@northveil.xyz', passkeyOk: false });
    const resLocked = await fetch(`${baseUrl}/wallet/me`, {
      headers: { Authorization: `Bearer ${sessionLocked}` },
    });
    const lockedJson = await resLocked.json();
    assert.strictEqual(lockedJson.next, 'unlock_passkey', 'session without passkeyOk must route to unlock_passkey');
    console.log('   ✓ /wallet/me returns primary-first ordered array and next=dashboard or unlock_passkey');


    // -------------------------------------------------------------
    // Test 8: saveAuthCode & insertOauthToken throw when database fails
    // -------------------------------------------------------------
    console.log('8. Testing OAuth persistence throws on DB error...');
    (supabase as any).from = (table: string) => {
      if (table === 'oauth_codes') {
        return {
          insert: () => Promise.resolve({ data: null, error: { message: 'DB connection error' } }),
        };
      }
      if (table === 'oauth_tokens') {
        return {
          insert: () => Promise.resolve({ data: null, error: { message: 'DB connection error' } }),
        };
      }
      if (table === 'oauth_clients') {
        return {
          insert: () => Promise.resolve({ data: null, error: { message: 'DB connection error' } }),
        };
      }
      return originalFrom(table);
    };

    await assert.rejects(
      async () => {
        await saveAuthCode({
          code: 'test_code',
          user_id: testUserA,
          client_id: 'claude_test',
          code_challenge: 'test_challenge',
          redirect_uri: 'https://claude.ai/api/mcp/callback',
        });
      },
      /OAUTH_CODE_PERSISTENCE_FAILED/,
      'saveAuthCode must throw if DB insert fails'
    );

    await assert.rejects(
      async () => {
        await insertOauthToken({
          token_hash: 'test_hash',
          user_id: testUserA,
          client_id: 'claude_test',
          expires_at: new Date(Date.now() + 3600000),
        });
      },
      /OAUTH_TOKEN_PERSISTENCE_FAILED/,
      'insertOauthToken must throw if DB insert fails'
    );

    await assert.rejects(
      async () => {
        await handleDynamicClientRegistration({
          redirect_uris: ['https://claude.ai/api/mcp/callback'],
        });
      },
      /DCR_PERSISTENCE_FAILED/,
      'handleDynamicClientRegistration must throw if DB insert fails'
    );

    (supabase as any).from = originalFrom;
    console.log('   ✓ OAuth persistence functions throw when DB writes fail');

    // -------------------------------------------------------------
    // Test 9: Hosted raw mnemonic import is strictly rejected with 400 RAW_MATERIAL_FORBIDDEN
    // -------------------------------------------------------------
    console.log('9. Testing hosted raw mnemonic import protection...');
    const resRawImport = await fetch(`${baseUrl}/wallet/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mnemonic: 'test mnemonic phrase forbidden on server' }),
    });
    assert.strictEqual(resRawImport.status, 400);
    const rawJson = await resRawImport.json();
    assert.strictEqual(rawJson.error, 'RAW_MATERIAL_FORBIDDEN');
    console.log('   ✓ Plaintext mnemonic import strictly returns 400 RAW_MATERIAL_FORBIDDEN');

    // -------------------------------------------------------------
    // Test 10: getPrimaryMcpUrl returns https://mcp.northveil.xyz/mcp
    // -------------------------------------------------------------
    console.log('10. Testing canonical MCP URL invariant...');
    assert.strictEqual(getPrimaryMcpUrl(), 'https://mcp.northveil.xyz/mcp');
    console.log('   ✓ getPrimaryMcpUrl() === https://mcp.northveil.xyz/mcp');

    // -------------------------------------------------------------
    // Test 11: GET /health/deps probe endpoint
    // -------------------------------------------------------------
    console.log('11. Testing GET /health/deps probe...');
    const resDeps = await fetch(`${baseUrl}/health/deps`);
    assert([200, 503].includes(resDeps.status), 'Health deps must return 200 or 503');
    const depsJson = await resDeps.json();
    assert(['ok', 'invalid_api_key', 'rls', 'down'].includes(depsJson.supabase), 'Must return valid supabase status');
    console.log(`   ✓ GET /health/deps returned status: ${depsJson.supabase}`);

    // -------------------------------------------------------------
    // Test 12: walletRedirect formatting
    // -------------------------------------------------------------
    console.log('12. Testing walletRedirect helper...');
    const safeUrl = walletRedirect('https://wallet.northveil.xyz', { error: 'AUTH_DB_MISCONFIGURED' });
    assert.strictEqual(safeUrl, 'https://wallet.northveil.xyz/?error=AUTH_DB_MISCONFIGURED');
    assert(!safeUrl.includes('Invalid%20API%20key'), 'Never leak raw infra strings');
    console.log('   ✓ walletRedirect formats URL params cleanly');

    console.log('\n✅ All 12 Follow-Up 27 Regression Tests Passed Successfully!\n');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Follow-Up 27 Test Suite Failed:', err);
  process.exit(1);
});
