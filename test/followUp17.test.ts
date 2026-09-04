import assert from 'node:assert';
import http from 'node:http';
import { app } from '../src/server.js';

console.log('--- Running Follow-Up 17 CORS & Network Preflight Tests ---');

async function runTests() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // Test 1: Preflight OPTIONS on /auth/email/verify from https://wallet.northveil.xyz
    console.log('1. Testing OPTIONS preflight on /auth/email/verify from https://wallet.northveil.xyz...');
    const preflightRes = await fetch(`${baseUrl}/auth/email/verify`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://wallet.northveil.xyz',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-session-token,authorization',
      },
    });

    assert.strictEqual(preflightRes.status, 204, 'Preflight must return 204');
    assert.strictEqual(preflightRes.headers.get('access-control-allow-origin'), 'https://wallet.northveil.xyz');
    assert.strictEqual(preflightRes.headers.get('access-control-allow-credentials'), 'true');
    const allowHeaders = preflightRes.headers.get('access-control-allow-headers') || '';
    assert.ok(
      allowHeaders.toLowerCase().includes('x-session-token'),
      'Access-Control-Allow-Headers must include X-Session-Token'
    );
    assert.ok(
      allowHeaders.toLowerCase().includes('x-user-id'),
      'Access-Control-Allow-Headers must include X-User-Id'
    );
    assert.ok(
      allowHeaders.toLowerCase().includes('authorization'),
      'Access-Control-Allow-Headers must include Authorization'
    );
    console.log('   ✓ Preflight succeeded with 204 and X-Session-Token in allow-headers');

    // Test 2: Preflight OPTIONS on /wallet/me
    console.log('2. Testing OPTIONS preflight on /wallet/me...');
    const preflightMeRes = await fetch(`${baseUrl}/wallet/me`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://wallet.northveil.xyz',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-session-token,authorization',
      },
    });
    assert.strictEqual(preflightMeRes.status, 204);
    assert.strictEqual(preflightMeRes.headers.get('access-control-allow-origin'), 'https://wallet.northveil.xyz');
    console.log('   ✓ Preflight on /wallet/me succeeded');

    // Test 3: Vercel preview origin allows CORS
    console.log('3. Testing Vercel preview origin...');
    const vercelPreflight = await fetch(`${baseUrl}/auth/email/start`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://northveil-wallet-git-main-northveil.vercel.app',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.strictEqual(vercelPreflight.status, 204);
    assert.strictEqual(
      vercelPreflight.headers.get('access-control-allow-origin'),
      'https://northveil-wallet-git-main-northveil.vercel.app'
    );
    console.log('   ✓ Vercel preview origin allowed');

    // Test 4: Localhost origin allows CORS
    console.log('4. Testing localhost:5173 origin...');
    const localPreflight = await fetch(`${baseUrl}/auth/email/start`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.strictEqual(localPreflight.status, 204);
    assert.strictEqual(localPreflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    console.log('   ✓ Localhost origin allowed');

    // Test 5: Claude.ai origin allows CORS
    console.log('5. Testing claude.ai origin...');
    const claudePreflight = await fetch(`${baseUrl}/mcp`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://claude.ai',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.strictEqual(claudePreflight.status, 204);
    assert.strictEqual(claudePreflight.headers.get('access-control-allow-origin'), 'https://claude.ai');
    console.log('   ✓ Claude.ai origin allowed');

    // Test 6: Untrusted origin is NOT echoed
    console.log('6. Testing untrusted origin...');
    const untrustedRes = await fetch(`${baseUrl}/auth/email/start`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://malicious-attacker-site.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.strictEqual(untrustedRes.headers.get('access-control-allow-origin'), null);
    console.log('   ✓ Untrusted origin rejected by CORS');

    console.log('\n✅ All Follow-Up 17 CORS & Network Preflight Tests Passed Successfully!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Follow-Up 17 Test Failure:', err);
  process.exit(1);
});
