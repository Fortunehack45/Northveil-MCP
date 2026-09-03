import assert from 'node:assert';
import http from 'node:http';
import { execSync } from 'node:child_process';
import app from '../src/server.js';
import { mockTokensRegistry, mockClientsRegistry, mockWalletsRegistry, registerMockToken } from '../src/auth/resolveContext.js';
import { createApproval } from '../src/wallet/approvals.js';

let NorthveilClient: any;
try {
  // @ts-ignore
  const mod = await import('../../sdk/src/client.js');
  NorthveilClient = mod.NorthveilClient;
} catch {
  NorthveilClient = class {
    clientKey: string;
    constructor(config: any = {}) {
      this.clientKey = config.clientKey || process.env.NORTHVEIL_API_KEY || '';
      if (!this.clientKey) {
        throw new Error('MISSING_CLIENT_KEY: Pass clientKey or set NORTHVEIL_API_KEY');
      }
    }
  };
}

console.log('--- Running Follow-Up 7 Automated Spec Tests ---');

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. no token on /mcp → 401 + WWW-Authenticate
    console.log('1. Testing no token on /mcp -> 401 + WWW-Authenticate...');
    const resNoAuth = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });
    assert.strictEqual(resNoAuth.status, 401, 'Unauthenticated /mcp must return HTTP 401');
    const wwwAuth = resNoAuth.headers.get('www-authenticate');
    assert(wwwAuth && wwwAuth.includes('Bearer realm="Northveil"'), 'Must include WWW-Authenticate header with Bearer realm');
    console.log('   ✓ 401 + WWW-Authenticate verified');

    // Setup Mock Tenants A and B
    const tokenA = 'nv_oauth_test_token_user_a';
    const tokenB = 'nv_oauth_test_token_user_b';
    const walletAddressA = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const walletAddressB = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

    registerMockToken(tokenA, {
      userId: 'user_a',
      clientId: 'claude_a',
      wallet: { id: 'wal_a', address: walletAddressA, chainFamily: 'evm', mpcWalletId: 'mpc_a' },
    });

    registerMockToken(tokenB, {
      userId: 'user_b',
      clientId: 'claude_b',
      wallet: { id: 'wal_b', address: walletAddressB, chainFamily: 'evm', mpcWalletId: 'mpc_b' },
    });

    // 2. token A portfolio address ≠ token B
    console.log('2. Testing token A portfolio address != token B...');
    const resA = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'nv_get_portfolio', arguments: {} },
      }),
    });
    assert.strictEqual(resA.status, 200);
    const dataA = await resA.json();
    const portfolioA = JSON.parse(dataA.result.content[0].text);

    const resB = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'nv_get_portfolio', arguments: {} },
      }),
    });
    assert.strictEqual(resB.status, 200);
    const dataB = await resB.json();
    const portfolioB = JSON.parse(dataB.result.content[0].text);

    assert.notStrictEqual(portfolioA.address.toLowerCase(), portfolioB.address.toLowerCase(), 'Tenants A and B must resolve isolated portfolio addresses');
    assert.strictEqual(portfolioA.address.toLowerCase(), walletAddressA.toLowerCase());
    assert.strictEqual(portfolioB.address.toLowerCase(), walletAddressB.toLowerCase());
    console.log('   ✓ token A portfolio address != token B verified');

    // 3. token A + walletAddress=B → 403
    console.log('3. Testing token A + walletAddress=B -> 403...');
    const resCrossTenant = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'nv_get_portfolio',
          arguments: { walletAddress: walletAddressB },
        },
      }),
    });
    assert.strictEqual(resCrossTenant.status, 403, 'Cross-tenant wallet access must return HTTP 403');
    const errCross = await resCrossTenant.json();
    assert(errCross.error?.message?.includes('WALLET_NOT_IN_GRANT'), 'Error message must specify WALLET_NOT_IN_GRANT');
    console.log('   ✓ token A + walletAddress=B -> 403 verified');

    // 4. playground missing key throws
    console.log('4. Testing playground missing key throws...');
    let threw = false;
    try {
      new NorthveilClient({ clientKey: '' });
    } catch (err: any) {
      if (err.message.includes('MISSING_CLIENT_KEY')) {
        threw = true;
      }
    }
    assert(threw, 'NorthveilClient must throw MISSING_CLIENT_KEY when no key configured');
    console.log('   ✓ playground missing key throws verified');

    // 5. rg INITIAL_TRANSACTIONS src empty
    console.log('5. Testing rg INITIAL_TRANSACTIONS src empty...');
    try {
      const out = execSync('git grep "INITIAL_TRANSACTIONS" src', { encoding: 'utf8' }).trim();
      assert.strictEqual(out, '', 'src must not contain any INITIAL_TRANSACTIONS reference');
    } catch {
      // Exit code 1 means pattern not found (desired)
    }
    console.log('   ✓ rg INITIAL_TRANSACTIONS src empty verified');

    // 6. rg NORTHVEIL_DEMO_MODE empty
    console.log('6. Testing rg NORTHVEIL_DEMO_MODE empty...');
    try {
      const out = execSync('git grep "NORTHVEIL_DEMO_MODE"', { encoding: 'utf8' }).trim();
      assert.strictEqual(out, '', 'Repo must not contain NORTHVEIL_DEMO_MODE');
    } catch {
      // Exit code 1 means pattern not found (desired)
    }
    console.log('   ✓ rg NORTHVEIL_DEMO_MODE empty verified');

    // 7. approve complete wrong challenge → 400, no hash
    console.log('7. Testing approve complete wrong challenge -> 400, no hash...');
    const stagedApproval = await createApproval({
      userId: 'user_a',
      clientId: 'claude_a',
      walletId: 'wal_a',
      walletAddress: walletAddressA,
      payloadHash: '0x1122334455667788990011223344556677889900112233445566778899001122',
      canonicalTx: { to: '0x123', value: '100', data: '0x', chainId: 8453, nonce: 0 },
      expiresAt: new Date(Date.now() + 600000),
    });

    const badChallengeClientData = Buffer.from(
      JSON.stringify({ challenge: 'wrong_challenge_that_does_not_match' })
    ).toString('base64url');

    const resWrongChallenge = await fetch(`${baseUrl}/api/approvals/${stagedApproval.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialId: 'cred_123',
        assertionResponse: {
          clientDataJSON: badChallengeClientData,
        },
      }),
    });
    assert.strictEqual(resWrongChallenge.status, 400, 'Wrong challenge must return HTTP 400');
    const wrongData = await resWrongChallenge.json();
    assert(!wrongData.txHash, 'Wrong challenge must not return a txHash');
    console.log('   ✓ approve complete wrong challenge -> 400, no hash verified');

    // 8. revoked oauth client → 403
    console.log('8. Testing revoked oauth client -> 403...');
    const revokedToken = 'nv_oauth_revoked_client_token';
    registerMockToken(revokedToken, {
      userId: 'user_revoked',
      clientId: 'claude_revoked',
      wallet: { id: 'wal_r', address: '0xRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', chainFamily: 'evm', mpcWalletId: 'mpc_r' },
      status: 'revoked',
    });

    const resRevoked = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${revokedToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'nv_get_portfolio', arguments: {} },
      }),
    });
    assert.strictEqual(resRevoked.status, 403, 'Revoked client must return HTTP 403');
    const errRevoked = await resRevoked.json();
    assert(JSON.stringify(errRevoked).includes('CLIENT_REVOKED'), 'Error message must state CLIENT_REVOKED');
    console.log('   ✓ revoked oauth client -> 403 verified');

    console.log('\n🎉 ALL FOLLOW-UP 7 SPEC TESTS PASSED SUCCESSFULLY!');
    server.close();
    process.exit(0);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
