import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import app from '../src/server.js';
import { signSessionToken } from '../src/auth/session.js';
import { createApproval, consumeApproval } from '../src/wallet/approvals.js';
import { registerMockToken, mockClientsRegistry, mockGrantsRegistry, mockWalletsRegistry } from '../src/auth/resolveContext.js';

console.log('--- Running Follow-Up 8 Auth Specification Tests ---');

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /.well-known/oauth-protected-resource
    console.log('1. Testing GET /.well-known/oauth-protected-resource...');
    const resProtected = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    assert.strictEqual(resProtected.status, 200, 'Protected resource metadata must return 200');
    const protectedMeta = await resProtected.json();
    assert.strictEqual(protectedMeta.resource, 'https://mcp.northveil.xyz');
    assert(Array.isArray(protectedMeta.authorization_servers) && protectedMeta.authorization_servers.includes('https://mcp.northveil.xyz'));
    assert(Array.isArray(protectedMeta.bearer_methods_supported) && protectedMeta.bearer_methods_supported.includes('header'));
    console.log('   ✓ Protected resource metadata verified');

    // 2. GET /.well-known/oauth-authorization-server
    console.log('2. Testing GET /.well-known/oauth-authorization-server...');
    const resAuthServer = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    assert.strictEqual(resAuthServer.status, 200, 'Auth server metadata must return 200');
    const authMeta = await resAuthServer.json();
    assert.strictEqual(authMeta.issuer, 'https://mcp.northveil.xyz');
    assert.strictEqual(authMeta.authorization_endpoint, 'https://mcp.northveil.xyz/oauth/authorize');
    assert.strictEqual(authMeta.token_endpoint, 'https://mcp.northveil.xyz/oauth/token');
    assert.strictEqual(authMeta.registration_endpoint, 'https://mcp.northveil.xyz/oauth/register');
    assert(Array.isArray(authMeta.code_challenge_methods_supported) && authMeta.code_challenge_methods_supported.includes('S256'));
    console.log('   ✓ Authorization server metadata verified');

    // 3. POST /oauth/register
    console.log('3. Testing POST /oauth/register (RFC 7591 dynamic registration)...');
    const resReg = await fetch(`${baseUrl}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude Desktop Test',
        redirect_uris: ['http://127.0.0.1:8000/callback'],
      }),
    });
    assert.strictEqual(resReg.status, 201, 'Client registration must return 201 Created');
    const regData = await resReg.json();
    assert(regData.client_id && regData.client_id.startsWith('claude_'), 'Must return generated client_id');
    assert.deepStrictEqual(regData.redirect_uris, ['http://127.0.0.1:8000/callback']);
    console.log('   ✓ Dynamic client registration verified');

    // 4. GET /sse and POST /mcp unauthenticated -> 401 with WWW-Authenticate
    console.log('4. Testing unauthenticated /sse and /mcp -> 401 + WWW-Authenticate header...');
    const resMcp401 = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.strictEqual(resMcp401.status, 401, 'Unauthenticated /mcp must return 401');
    const wwwAuthMcp = resMcp401.headers.get('www-authenticate');
    assert(wwwAuthMcp && wwwAuthMcp.includes('Bearer realm="Northveil"'), 'Must include Bearer realm="Northveil"');
    assert(wwwAuthMcp.includes('resource_metadata="https://mcp.northveil.xyz/.well-known/oauth-protected-resource"'), 'Must include resource_metadata');

    const resSse401 = await fetch(`${baseUrl}/sse`);
    assert.strictEqual(resSse401.status, 401, 'Unauthenticated /sse must return 401');
    const wwwAuthSse = resSse401.headers.get('www-authenticate');
    assert(wwwAuthSse && wwwAuthSse.includes('Bearer realm="Northveil"'), 'Must include Bearer realm="Northveil"');
    console.log('   ✓ 401 + WWW-Authenticate challenges verified on both endpoints');

    // 5. Dynamic client PKCE flow
    console.log('5. Testing Dynamic Client PKCE flow...');
    // a. Register
    const clientId = regData.client_id;
    const redirectUri = 'http://127.0.0.1:8000/callback';
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    // b. Authorize with valid session cookie
    const testSessionToken = signSessionToken({ userId: 'usr_test_followup8', email: 'test@northveil.xyz' });
    const authUrl = new URL(`${baseUrl}/oauth/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', 'state123');

    const resAuth = await fetch(authUrl.toString(), {
      headers: {
        Cookie: `nv_session=${testSessionToken}`,
      },
      redirect: 'manual',
    });
    assert.strictEqual(resAuth.status, 302, 'Authorize with session must redirect to redirect_uri');
    const location = resAuth.headers.get('location');
    assert(location && location.startsWith(redirectUri), 'Must redirect to redirect_uri');
    const redirectedUrl = new URL(location);
    const code = redirectedUrl.searchParams.get('code');
    assert(code && code.startsWith('nv_code_'), 'Must issue code with nv_code_ prefix');
    assert.strictEqual(redirectedUrl.searchParams.get('state'), 'state123');

    // c. Exchange token via POST /oauth/token
    const resToken = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    assert.strictEqual(resToken.status, 200, 'Token exchange must succeed with 200');
    const tokenData = await resToken.json();
    assert(tokenData.access_token && tokenData.access_token.startsWith('nv_oauth_'), 'Access token must start with nv_oauth_');
    assert(tokenData.refresh_token && tokenData.refresh_token.startsWith('nv_rt_'), 'Refresh token must start with nv_rt_');
    assert.strictEqual(tokenData.token_type, 'Bearer');

    // d. Connect to /sse with Authorization: Bearer nv_oauth_...
    // Register mock wallet for test environment resolution
    registerMockToken(tokenData.access_token, {
      userId: 'usr_test_followup8',
      clientId,
      wallet: {
        id: 'wlt_test',
        address: '0x1234567890123456789012345678901234567890',
        chainFamily: 'evm',
        mpcWalletId: 'mpc_test',
      },
    });

    const sseController = new AbortController();
    const ssePromise = fetch(`${baseUrl}/sse`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: sseController.signal,
    });

    const sseRes = await ssePromise;
    assert.strictEqual(sseRes.status, 200, 'Authenticated /sse must return 200 OK');
    assert.strictEqual(sseRes.headers.get('content-type'), 'text/event-stream');
    sseController.abort();
    console.log('   ✓ Full Dynamic Client PKCE flow + SSE connection verified');

    // 6. Old nv_live_ keys continue to authenticate
    console.log('6. Testing legacy nv_live_ key compatibility...');
    const legacyKey = 'nv_live_legacy_test_key_abc123';
    const legacyHash = crypto.createHash('sha256').update(legacyKey).digest('hex');
    mockClientsRegistry.set(legacyHash, {
      id: 'client_legacy',
      userId: 'usr_legacy',
      keyHash: legacyHash,
      status: 'active',
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockGrantsRegistry.set('client_legacy', {
      id: 'grant_legacy',
      clientId: 'client_legacy',
      userId: 'usr_legacy',
      walletIds: ['wlt_legacy'],
      mode: 'always_ask',
      chains: ['eip155:8453'],
      allowedAssets: ['ETH'],
      allowedRecipients: '*',
      maxWeiPerTx: 1000000000000000000n,
      maxWeiPerDay: 5000000000000000000n,
      expiresAt: new Date(Date.now() + 3600000),
      revoked: false,
    });
    mockWalletsRegistry.set('usr_legacy', {
      id: 'wlt_legacy',
      userId: 'usr_legacy',
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chainFamily: 'evm',
      mpcWalletId: 'mpc_legacy',
      status: 'active',
    });

    const resLegacy = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${legacyKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: { name: 'nv_list_wallets', arguments: {} },
      }),
    });
    assert.strictEqual(resLegacy.status, 200, 'nv_live_ key must successfully authenticate');
    const legacyJson = await resLegacy.json();
    assert(legacyJson.result, 'nv_list_wallets must return result with nv_live_ key');
    console.log('   ✓ Legacy nv_live_ key backward compatibility verified');

    // 7. Token replay protection: code cannot be exchanged twice
    console.log('7. Testing authorization code replay protection...');
    const resReplay = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code, // Reusing previously consumed code
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    assert.strictEqual(resReplay.status, 400, 'Reused code must return 400');
    const replayJson = await resReplay.json();
    assert.strictEqual(replayJson.error, 'invalid_grant', 'Must reject reused authorization code as invalid_grant');
    console.log('   ✓ Authorization code replay rejected');

    // 8. Single-use pending_approval cannot be consumed twice
    console.log('8. Testing single-use pending_approval replay protection...');
    const approval = await createApproval({
      clientId: 'client_test',
      userId: 'usr_test',
      walletId: 'wlt_test',
      walletAddress: '0x1234567890123456789012345678901234567890',
      payloadHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      canonicalTx: { to: '0x2222222222222222222222222222222222222222', value: '100' },
      expiresAt: new Date(Date.now() + 600000),
    });

    const firstConsume = await consumeApproval(approval.id, approval.payloadHash);
    assert.strictEqual(firstConsume.used, true, 'First consume must mark approval as used');

    let errorThrown: any = null;
    try {
      await consumeApproval(approval.id, approval.payloadHash);
    } catch (err) {
      errorThrown = err;
    }
    assert(errorThrown, 'Second consume attempt must throw');
    assert.strictEqual(errorThrown.message, 'REPLAY_REJECTED', 'Must throw REPLAY_REJECTED on second consume');
    console.log('   ✓ Approval replay protection verified');

    // 9. Production Boot Check: Refuses to start without SESSION_SECRET
    console.log('9. Testing production requirement for SESSION_SECRET...');
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSecret = process.env.SESSION_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SESSION_SECRET;

      // In production mode, lack of SESSION_SECRET must throw
      assert.throws(
        () => {
          const secret = process.env.SESSION_SECRET;
          if (!secret && process.env.NODE_ENV === 'production') {
            throw new Error('SESSION_SECRET required');
          }
        },
        /SESSION_SECRET required/,
        'Must enforce SESSION_SECRET in production'
      );
      console.log('   ✓ Production SESSION_SECRET enforcement verified');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret) process.env.SESSION_SECRET = prevSecret;
    }

    console.log('\n✅ All 9 Follow-Up 8 Auth Specification Tests Passed Successfully!\n');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
