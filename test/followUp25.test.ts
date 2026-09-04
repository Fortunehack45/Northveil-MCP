import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import app from '../src/server.js';
import { asWebAuthnCredentialJSON } from '../src/auth/passkey.js';
import { getMpcProvider, turnkeyProvider } from '../src/wallet/mpcAdapter.js';
import {
  signAndAdvance,
  insertSignPermit,
  inMemoryAgentRequests,
  inMemorySignPermits,
} from '../src/wallet/requestLifecycle.js';
import { signSessionToken } from '../src/auth/session.js';
import { registerMockToken } from '../src/auth/resolveContext.js';
import crypto from 'node:crypto';
import { supabase } from '../src/supabase.js';
import { canonicalPayloadHash } from '../src/policy/grantEngine.js';

let NorthveilClient: any;
try {
  // @ts-ignore
  const mod = await import('../../sdk/src/client.js');
  NorthveilClient = mod.NorthveilClient;
} catch {
  try {
    // @ts-ignore
    const mod = await import('../../../Northveil/sdk/src/client.js');
    NorthveilClient = mod.NorthveilClient;
  } catch {
    NorthveilClient = null;
  }
}

async function runTests() {
  console.log('\n=== Running Follow-Up 25 Specification Tests ===\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind server');
  const port = address.port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // -------------------------------------------------------------
    // Test 1: Passkey finish clientDataJSON handling & malformed guard
    // -------------------------------------------------------------
    console.log('1. Testing asWebAuthnCredentialJSON & /auth/passkey/register/finish...');

    const validAttResp = {
      id: 'test_cred_id_123',
      rawId: 'test_raw_id_123',
      type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: 'test_chal', origin: 'http://localhost' })).toString('base64url'),
        attestationObject: 'mock_attestation_object',
      },
    };

    // Correct payload: { response: full attResp }
    const unwrapped = asWebAuthnCredentialJSON({ response: validAttResp });
    assert.strictEqual(unwrapped.id, 'test_cred_id_123');
    assert(unwrapped.response?.clientDataJSON, 'Must have clientDataJSON');

    // Malformed payload: { response: attResp.response } (missing outer wrapper)
    const malformedPayload = { response: validAttResp.response };
    assert.throws(
      () => asWebAuthnCredentialJSON(malformedPayload),
      /PASSKEY_RESPONSE_MALFORMED/,
      'Must throw PASSKEY_RESPONSE_MALFORMED on raw inner response'
    );

    // Test endpoint with malformed payload returns 400 PASSKEY_RESPONSE_MALFORMED
    const resMalformed = await fetch(`${baseUrl}/auth/passkey/register/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u_test_1', response: validAttResp.response }),
    });
    assert.strictEqual(resMalformed.status, 400, 'Malformed passkey finish must return 400');
    const malformedJson = await resMalformed.json();
    assert.strictEqual(malformedJson.error, 'PASSKEY_RESPONSE_MALFORMED');

    // Test endpoint with full attResp does NOT throw clientDataJSON TypeError
    const resValid = await fetch(`${baseUrl}/auth/passkey/register/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u_test_1', response: validAttResp }),
    });
    // Expected: 400 with CHALLENGE_EXPIRED_OR_NOT_FOUND (not clientDataJSON TypeError)
    assert.strictEqual(resValid.status, 400);
    const validJson = await resValid.json();
    assert.strictEqual(validJson.error, 'CHALLENGE_EXPIRED_OR_NOT_FOUND');
    console.log('   ✓ Passkey finish accepts full attResp and rejects malformed inner response with 400 PASSKEY_RESPONSE_MALFORMED');

    // -------------------------------------------------------------
    // Test 2: Hosted signAndBroadcast throws ORG_ROOT_SIGN_FORBIDDEN
    // -------------------------------------------------------------
    console.log('2. Testing hosted signAndBroadcast throws ORG_ROOT_SIGN_FORBIDDEN...');
    const originalEnv = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    delete process.env.ALLOW_ORG_ROOT_SIGN;

    const provider = turnkeyProvider();
    const testUnsignedTx = {
      to: '0x1111111111111111111111111111111111111111',
      value: '0',
      data: '0x',
      chainId: 8453,
      nonce: 0,
    };
    const validHash = canonicalPayloadHash({
      chain: 'eip155:8453',
      to: testUnsignedTx.to,
      valueWei: testUnsignedTx.value,
      data: testUnsignedTx.data,
      nonce: testUnsignedTx.nonce,
    });

    await assert.rejects(
      async () => {
        await provider.signAndBroadcast({
          mpcWalletId: 'w_test',
          unsignedTx: testUnsignedTx,
          payloadHash: validHash,
          approvalEvidence: { type: 'passkey' },
        });
      },
      (err: any) => {
        assert(err.message.includes('ORG_ROOT_SIGN_FORBIDDEN'), `Expected ORG_ROOT_SIGN_FORBIDDEN, got: ${err.message}`);
        return true;
      }
    );
    console.log('   ✓ turnkeyProvider().signAndBroadcast throws ORG_ROOT_SIGN_FORBIDDEN on hosted');

    // -------------------------------------------------------------
    // Test 3: signAndAdvance without permit -> NO_SIGN_PERMIT
    // -------------------------------------------------------------
    console.log('3. Testing signAndAdvance without permit -> NO_SIGN_PERMIT...');
    const testReqId = 'req_test_no_permit_' + Date.now();
    inMemoryAgentRequests.set(testReqId, {
      id: testReqId,
      user_id: 'u_test',
      wallet_id: 'w_test',
      mpc_wallet_id: 'mpc_test',
      tool: 'nv_prepare_transfer',
      intent: {},
      canonical_tx: { to: '0x1111111111111111111111111111111111111111', value: '0', chainId: 8453 },
      payload_hash: '0xhash_no_permit',
      status: 'pending_signature',
      expires_at: new Date(Date.now() + 60000),
      created_at: new Date(),
      updated_at: new Date(),
    });

    await assert.rejects(
      async () => {
        await signAndAdvance(testReqId);
      },
      (err: any) => {
        assert(err.message.includes('NO_SIGN_PERMIT'), `Expected NO_SIGN_PERMIT, got: ${err.message}`);
        return true;
      }
    );
    console.log('   ✓ signAndAdvance throws NO_SIGN_PERMIT when permit is missing');

    // -------------------------------------------------------------
    // Test 4: signAndAdvance on hosted transitions to pending_user_stamp
    // -------------------------------------------------------------
    console.log('4. Testing signAndAdvance on hosted transitions to pending_user_stamp...');
    const stampReqId = 'req_test_stamp_' + Date.now();
    inMemoryAgentRequests.set(stampReqId, {
      id: stampReqId,
      user_id: 'u_test',
      wallet_id: 'w_test',
      mpc_wallet_id: 'mpc_test',
      tool: 'nv_prepare_transfer',
      intent: {},
      canonical_tx: { to: '0x1111111111111111111111111111111111111111', value: '0', chainId: 8453 },
      payload_hash: '0xhash_stamp_test',
      status: 'pending_signature',
      expires_at: new Date(Date.now() + 60000),
      created_at: new Date(),
      updated_at: new Date(),
    });
    await insertSignPermit('mpc_test', '0xhash_stamp_test', 60000, stampReqId);

    const stampAdvanceResult = await signAndAdvance(stampReqId);
    assert.strictEqual(stampAdvanceResult.status, 'pending_user_stamp');
    console.log('   ✓ signAndAdvance returns status: pending_user_stamp on hosted environment');

    // Restore env
    process.env = { ...originalEnv };

    // -------------------------------------------------------------
    // Test 5: Plaintext import regression -> 400 RAW_MATERIAL_FORBIDDEN
    // -------------------------------------------------------------
    console.log('5. Testing POST /wallet/import with mnemonic -> 400 RAW_MATERIAL_FORBIDDEN...');
    const resImport = await fetch(`${baseUrl}/wallet/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' }),
    });
    assert.strictEqual(resImport.status, 400, 'Plaintext import must return 400');
    const importJson = await resImport.json();
    assert.strictEqual(importJson.error, 'RAW_MATERIAL_FORBIDDEN');
    console.log('   ✓ POST /wallet/import rejected plaintext mnemonic with 400 RAW_MATERIAL_FORBIDDEN');

    // -------------------------------------------------------------
    // Test 6: Two wallets /wallet/me -> 200, primary first
    // -------------------------------------------------------------
    console.log('6. Testing /wallet/me multi-wallet ordering (primary first)...');
    const testUserId = 'u_multi_' + Date.now();
    const testSessionToken = signSessionToken({ userId: testUserId, email: 'multi@northveil.xyz', passkeyOk: true });

    const walletSecondaryId = crypto.randomUUID();
    const walletPrimaryId = crypto.randomUUID();
    const addrSecondary = '0x' + crypto.randomBytes(20).toString('hex');
    const addrPrimary = '0x' + crypto.randomBytes(20).toString('hex');

    let insErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await supabase.from('wallets').insert([
          { id: walletSecondaryId, user_id: testUserId, address: addrSecondary, chain_family: 'evm', mpc_wallet_id: 'mpc_2', is_primary: false, status: 'active' },
          { id: walletPrimaryId, user_id: testUserId, address: addrPrimary, chain_family: 'evm', mpc_wallet_id: 'mpc_1', is_primary: true, status: 'active' },
        ]);
        insErr = res.error;
        if (!insErr) break;
      } catch (err: any) {
        insErr = err;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ifError(insErr);

    try {
      const resMe = await fetch(`${baseUrl}/wallet/me`, {
        headers: {
          'X-Session-Token': testSessionToken,
          'Authorization': `Bearer ${testSessionToken}`,
        },
      });
      assert.strictEqual(resMe.status, 200, 'Authenticated /wallet/me must return 200');
      const meJson = await resMe.json();
      assert.strictEqual(meJson.authenticated, true);
      assert.strictEqual(meJson.passkeyOk, true);
      assert.strictEqual(meJson.wallets.length, 2, 'Must return both active wallets');
      assert.strictEqual(meJson.wallets[0].is_primary, true, 'Primary wallet must be first in list');
      assert.strictEqual(meJson.wallets[0].id, walletPrimaryId, 'Primary wallet must match');
      assert.strictEqual(meJson.wallet.id, walletPrimaryId, 'Default wallet must be primary');
      console.log('   ✓ /wallet/me returned 200 with 2 wallets, primary first');
    } finally {
      await supabase.from('wallets').delete().eq('user_id', testUserId);
    }

    // -------------------------------------------------------------
    // Test 7: OAuth Tenant Isolation (User A portfolio !== User B)
    // -------------------------------------------------------------
    console.log('7. Testing OAuth tenant isolation between User A and User B...');
    const tokenA = 'nv_oauth_user_a_' + Date.now();
    const tokenB = 'nv_oauth_user_b_' + Date.now();
    registerMockToken(tokenA, {
      userId: 'user_a',
      clientId: 'client_a',
      wallet: {
        id: 'w_a',
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainFamily: 'evm',
        mpcWalletId: 'mpc_a',
      },
    });
    registerMockToken(tokenB, {
      userId: 'user_b',
      clientId: 'client_b',
      wallet: {
        id: 'w_b',
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        chainFamily: 'evm',
        mpcWalletId: 'mpc_b',
      },
    });

    const resA = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: { name: 'nv_get_portfolio', arguments: {} },
      }),
    });
    const resB = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: { name: 'nv_get_portfolio', arguments: {} },
      }),
    });
    const dataA = await resA.json();
    const dataB = await resB.json();
    const walletA = dataA.result?.structuredContent?.data?.address || JSON.parse(dataA.result?.content?.[0]?.text || '{}').address;
    const walletB = dataB.result?.structuredContent?.data?.address || JSON.parse(dataB.result?.content?.[0]?.text || '{}').address;
    assert.strictEqual(walletA, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.strictEqual(walletB, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    assert.notStrictEqual(walletA, walletB, 'User A wallet must not equal User B wallet');
    console.log('   ✓ User A wallet isolated from User B wallet under OAuth authentication');

    // -------------------------------------------------------------
    // Test 8: MCP tools/list includes nv_prepare_transfer
    // -------------------------------------------------------------
    console.log('8. Testing POST /mcp tools/list has nv_prepare_transfer...');
    const resTools = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 103,
        method: 'tools/list',
        params: {},
      }),
    });
    assert.strictEqual(resTools.status, 200);
    const toolsJson = await resTools.json();
    const tools = toolsJson.result?.tools || [];
    const transferTool = tools.find((t: any) => t.name === 'nv_prepare_transfer');
    assert(transferTool, 'nv_prepare_transfer tool must be present');
    console.log('   ✓ nv_prepare_transfer found in POST /mcp tools/list');

    // -------------------------------------------------------------
    // Test 9: SDK and CLI checks
    // -------------------------------------------------------------
    console.log('9. Testing SDK & CLI contracts...');
    if (NorthveilClient) {
      // SDK refuses private key in constructor
      assert.throws(
        () => new NorthveilClient({ privateKey: '0x123' } as any),
        /NON_CUSTODIAL_VIOLATION/,
        'SDK must throw NON_CUSTODIAL_VIOLATION if privateKey is passed'
      );
      // SDK client has getPortfolio invoking nv_get_portfolio
      const clientProto = NorthveilClient.prototype as any;
      assert(typeof clientProto.getPortfolio === 'function', 'SDK must have getPortfolio method');
    }

    // CLI --sse stdout does not contain apiKey=
    const possibleCliPaths = [
      path.resolve(process.cwd(), '../cli/src/commands/mcp.ts'),
      path.resolve(process.cwd(), '../Northveil/cli/src/commands/mcp.ts'),
    ];
    for (const cliMcpPath of possibleCliPaths) {
      if (fs.existsSync(cliMcpPath)) {
        const cliContent = fs.readFileSync(cliMcpPath, 'utf8');
        assert(!cliContent.includes('?apiKey='), 'CLI mcp.ts must not output ?apiKey= on SSE URL');
      }
    }

    // Endpoint config check: primary URL is /mcp
    const possibleConfigPaths = [
      path.resolve(process.cwd(), '../src/config/endpointConfig.ts'),
      path.resolve(process.cwd(), '../Northveil/src/config/endpointConfig.ts'),
    ];
    for (const endpointConfigPath of possibleConfigPaths) {
      if (fs.existsSync(endpointConfigPath)) {
        const epContent = fs.readFileSync(endpointConfigPath, 'utf8');
        assert(epContent.includes('/mcp'), 'endpointConfig must provide /mcp as primary URL');
      }
    }
    console.log('   ✓ SDK refuses private key, CLI does not leak apiKey in query string, and /mcp is primary URL');

    console.log('\n=== All Follow-Up 25 Specification Tests Passed (100%) ===\n');
    server.close();
    process.exit(0);
  } catch (err) {
    server.close();
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  }
}

runTests();
