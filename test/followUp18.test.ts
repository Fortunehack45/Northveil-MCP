import assert from 'node:assert';
import http from 'node:http';
import app from '../src/server.js';
import { turnkeyProvider } from '../src/wallet/mpcAdapter.js';
import { registerMockToken } from '../src/auth/resolveContext.js';

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind server');
  const port = address.port;
  const baseUrl = `http://localhost:${port}`;

  console.log(`\n=== Running Follow-Up 18 Specification Tests on port ${port} ===\n`);

  try {
    // 1. POST /mcp initialize
    console.log('1. Testing POST /mcp initialize...');
    const resInit = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'Claude', version: '1.0' },
        },
      }),
    });
    assert.strictEqual(resInit.status, 200, 'POST /mcp initialize must return 200');
    const initData = await resInit.json();
    assert.strictEqual(initData.result?.protocolVersion, '2025-03-26');
    assert.strictEqual(initData.result?.serverInfo?.name, 'northveil');
    assert.deepStrictEqual(initData.result?.capabilities?.extensions?.['io.modelcontextprotocol/ui'], {});
    console.log('   ✓ POST /mcp initialize returned 200 with serverInfo.name=northveil & mcp-app extension');

    // 2. POST /mcp tools/list & _meta.ui
    console.log('2. Testing POST /mcp tools/list without auth and verifying _meta.ui metadata...');
    const resTools = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    assert.strictEqual(resTools.status, 200, 'POST /mcp tools/list must return 200');
    const toolsData = await resTools.json();
    const tools = toolsData.result?.tools || [];
    assert(tools.length >= 17, `Expected at least 17 tools, got ${tools.length}`);

    const transferTool = tools.find((t: any) => t.name === 'nv_prepare_transfer');
    assert(transferTool, 'nv_prepare_transfer tool must be present');
    assert.strictEqual(transferTool._meta?.ui?.resourceUri, 'ui://northveil/send');

    const swapTool = tools.find((t: any) => t.name === 'nv_prepare_swap');
    assert(swapTool, 'nv_prepare_swap tool must be present');
    assert.strictEqual(swapTool._meta?.ui?.resourceUri, 'ui://northveil/swap');

    const deployTool = tools.find((t: any) => t.name === 'nv_prepare_deploy_token');
    assert(deployTool, 'nv_prepare_deploy_token tool must be present');
    assert.strictEqual(deployTool._meta?.ui?.resourceUri, 'ui://northveil/deploy');

    const statusTool = tools.find((t: any) => t.name === 'nv_get_request');
    assert(statusTool, 'nv_get_request tool must be present');
    assert.strictEqual(statusTool._meta?.ui?.resourceUri, 'ui://northveil/status');

    const readTool = tools.find((t: any) => t.name === 'nv_get_portfolio');
    assert(readTool, 'nv_get_portfolio tool must be present');
    assert.strictEqual(readTool._meta?.ui?.resourceUri, 'ui://northveil/read');
    console.log(`   ✓ tools/list verified: ${tools.length} tools registered, _meta.ui cards present`);

    // 3. POST /sse tools/list compatibility alias
    console.log('3. Testing POST /sse tools/list compatibility alias...');
    const resSseTools = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {},
      }),
    });
    assert.strictEqual(resSseTools.status, 200);
    const sseToolsData = await resSseTools.json();
    assert.strictEqual(sseToolsData.result?.tools?.length, tools.length);
    console.log('   ✓ POST /sse returns identical tool catalog to POST /mcp');

    // 4. POST /mcp resources/list
    console.log('4. Testing POST /mcp resources/list for MCP Apps...');
    const resResources = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/list',
        params: {},
      }),
    });
    assert.strictEqual(resResources.status, 200);
    const resourcesData = await resResources.json();
    const resources = resourcesData.result?.resources || [];
    assert(resources.length >= 5, `Expected 5 resources, got ${resources.length}`);
    const sendRes = resources.find((r: any) => r.uri === 'ui://northveil/send');
    assert(sendRes, 'ui://northveil/send resource must be registered');
    assert.strictEqual(sendRes.mimeType, 'text/html;profile=mcp-app');
    console.log('   ✓ resources/list verified with text/html;profile=mcp-app');

    // 5. POST /mcp resources/read
    console.log('5. Testing POST /mcp resources/read for ui://northveil/send...');
    const resRead = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/read',
        params: { uri: 'ui://northveil/send' },
      }),
    });
    assert.strictEqual(resRead.status, 200);
    const readData = await resRead.json();
    const content = readData.result?.contents?.[0];
    assert(content, 'Must return resource content');
    assert.strictEqual(content.mimeType, 'text/html;profile=mcp-app');
    assert(content.text.includes('Northveil Transfer'), 'HTML must contain Transfer card markup');
    console.log('   ✓ resources/read returned valid HTML card for ui://northveil/send');

    // 6. POST /mcp tools/call unauthenticated -> 401 + WWW-Authenticate
    console.log('6. Testing unauthenticated POST /mcp tools/call -> 401 challenge...');
    const resUnauth = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'nv_get_balances', arguments: {} },
      }),
    });
    assert.strictEqual(resUnauth.status, 401, 'Unauthenticated call must return 401');
    const wwwAuth = resUnauth.headers.get('www-authenticate') || '';
    assert(wwwAuth.includes('Bearer realm="mcp"'), `WWW-Authenticate header must contain Bearer realm="mcp", got: ${wwwAuth}`);
    assert(wwwAuth.includes('resource_metadata="https://mcp.northveil.xyz/.well-known/oauth-protected-resource"'));
    console.log('   ✓ 401 challenge with proper RFC 9470 WWW-Authenticate header verified');

    // 7. Plaintext key import rejection
    console.log('7. Testing POST /wallet/import strictly rejects raw mnemonic/privateKey...');
    const resMnemonic = await fetch(`${baseUrl}/wallet/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mnemonic: 'twelve secret test words here' }),
    });
    assert.strictEqual(resMnemonic.status, 400);
    const mnemJson = await resMnemonic.json();
    assert.strictEqual(mnemJson.error, 'RAW_MATERIAL_FORBIDDEN');

    const resPriv = await fetch(`${baseUrl}/wallet/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234' }),
    });
    assert.strictEqual(resPriv.status, 400);
    const privJson = await resPriv.json();
    assert.strictEqual(privJson.error, 'RAW_MATERIAL_FORBIDDEN');
    console.log('   ✓ Raw material imports strictly blocked with RAW_MATERIAL_FORBIDDEN');

    // 8. Turnkey provider importWallet throws RAW_MATERIAL_FORBIDDEN
    console.log('8. Testing turnkeyProvider.importWallet throws RAW_MATERIAL_FORBIDDEN...');
    await assert.rejects(
      async () => {
        await turnkeyProvider().importWallet!('test_user', { mnemonic: 'any_secret' });
      },
      (err: any) => err.message === 'RAW_MATERIAL_FORBIDDEN'
    );
    console.log('   ✓ turnkeyProvider.importWallet throws RAW_MATERIAL_FORBIDDEN');

    // 9. Host resilient tools on missing vault -> 200 with isError: true and structuredContent.kind = 'no_wallet'
    console.log('9. Testing resilient non-500 response when user has not created a vault yet...');
    const noVaultToken = 'nv_oauth_no_vault_user_token';
    registerMockToken(noVaultToken, {
      userId: 'user_without_vault',
      clientId: 'claude_client',
      wallet: null as any,
    });

    const resNoVault = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${noVaultToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'nv_get_balances', arguments: {} },
      }),
    });
    assert.strictEqual(resNoVault.status, 200, 'Host must receive 200 (not 500) to keep session alive');
    const noVaultJson = await resNoVault.json();
    assert.strictEqual(noVaultJson.result?.isError, true, 'isError must be true');
    assert.strictEqual(noVaultJson.result?.structuredContent?.kind, 'no_wallet');
    assert(noVaultJson.result?.content?.[0]?.text?.includes('wallet.northveil.xyz'), 'Must guide user to wallet.northveil.xyz');
    console.log('   ✓ Resilient host tool response verified: 200 OK + isError: true + structuredContent.kind: "no_wallet"');

    // 10. Multi-tenant primary vault isolation across OAuth Bearer tokens
    console.log('10. Testing multi-tenant primary vault selection across distinct tokens...');
    const tokenA = 'nv_oauth_follow18_user_a';
    const tokenB = 'nv_oauth_follow18_user_b';
    const addressA = '0x1111111111111111111111111111111111111111';
    const addressB = '0x2222222222222222222222222222222222222222';

    registerMockToken(tokenA, {
      userId: 'user_18_a',
      clientId: 'claude_a',
      wallet: { id: 'w_18_a', address: addressA, chainFamily: 'evm', mpcWalletId: 'mpc_18_a' },
    });

    registerMockToken(tokenB, {
      userId: 'user_18_b',
      clientId: 'claude_b',
      wallet: { id: 'w_18_b', address: addressB, chainFamily: 'evm', mpcWalletId: 'mpc_18_b' },
    });

    const resA = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'nv_get_portfolio', arguments: {} },
      }),
    });
    assert.strictEqual(resA.status, 200);
    const dataA = await resA.json();
    const portfolioA = JSON.parse(dataA.result?.content?.[0]?.text || '{}');
    assert.strictEqual(portfolioA.address?.toLowerCase(), addressA.toLowerCase());

    const resB = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'nv_get_portfolio', arguments: {} },
      }),
    });
    assert.strictEqual(resB.status, 200);
    const dataB = await resB.json();
    const portfolioB = JSON.parse(dataB.result?.content?.[0]?.text || '{}');
    assert.strictEqual(portfolioB.address?.toLowerCase(), addressB.toLowerCase());

    assert.notStrictEqual(portfolioA.address, portfolioB.address, 'Vault addresses must be strictly isolated between users');
    console.log('   ✓ Multi-tenant vault isolation verified: Bearer token selects correct user vault');

    console.log('\n🎉 ALL FOLLOW-UP 18 SPECIFICATION TESTS PASSED SUCCESSFULLY!\n');
    server.close();
    process.exit(0);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Follow-Up 18 Test Suite Failed:', err);
  process.exit(1);
});
