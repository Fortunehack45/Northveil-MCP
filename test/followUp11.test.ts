import assert from 'node:assert';
import http from 'node:http';
import { app } from '../src/server.js';

console.log('--- Running Follow-Up 11 Claude MCP Discovery Tests ---');

async function main() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. POST /sse with initialize
    console.log('1. Testing POST /sse initialize...');
    const resInit = await fetch(`${baseUrl}/sse`, {
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
    assert.strictEqual(resInit.status, 200, 'POST /sse initialize must return 200');
    const initData = await resInit.json();
    assert(initData.result?.serverInfo?.name === 'northveil-mcp' || initData.result?.serverInfo?.name === 'northveil', 'serverInfo.name must be northveil or northveil-mcp');
    assert.strictEqual(initData.result?.protocolVersion, '2025-03-26');
    assert.strictEqual(initData.result?.capabilities?.tools?.listChanged, false);
    console.log('   ✓ POST /sse initialize returned 200 with valid serverInfo');

    // 2. notifications/initialized and ping
    console.log('2. Testing notifications/initialized and ping...');
    const resNotify = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    assert.strictEqual(resNotify.status, 202, 'notifications/initialized must return 202');

    const resPing = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'ping',
      }),
    });
    assert.strictEqual(resPing.status, 200, 'ping must return 200');
    const pingData = await resPing.json();
    assert.deepStrictEqual(pingData.result, {});
    console.log('   ✓ notifications/initialized (202) and ping (200) verified');

    // 3. POST /sse with tools/list
    console.log('3. Testing POST /sse tools/list...');
    const resTools = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    assert.strictEqual(resTools.status, 200, 'POST /sse tools/list must return 200');
    const toolsData = await resTools.json();
    const toolNames = toolsData.result?.tools?.map((t: any) => t.name) || [];
    assert(toolNames.length >= 8, `Expected >= 8 tools, got ${toolNames.length}`);
    assert(toolNames.includes('nv_get_portfolio'), 'Must include nv_get_portfolio');
    assert(toolNames.includes('nv_prepare_transfer'), 'Must include nv_prepare_transfer');
    assert(toolNames.includes('nv_list_wallets'), 'Must include nv_list_wallets');
    assert(toolNames.includes('nv_health'), 'Must include nv_health');
    console.log(`   ✓ POST /sse tools/list returned ${toolNames.length} tools`);

    // 4. GET /sse opens stream and emits event: endpoint
    console.log('4. Testing GET /sse stream connection and endpoint emission...');
    const sseController = new AbortController();
    const resSse = await fetch(`${baseUrl}/sse`, {
      signal: sseController.signal,
    });
    assert.strictEqual(resSse.status, 200, 'GET /sse must return 200');
    const contentType = resSse.headers.get('content-type') || '';
    assert(contentType.includes('text/event-stream'), `Content-Type must be text/event-stream, got ${contentType}`);

    const reader = resSse.body?.getReader();
    assert(reader, 'Response body reader must exist');
    const { value: chunk } = await reader.read();
    const chunkText = new TextDecoder().decode(chunk);
    assert(chunkText.includes('event: endpoint'), 'Must emit event: endpoint');
    assert(chunkText.includes('/message?sessionId=sse_'), 'Must include message endpoint with sessionId');

    const matchSession = chunkText.match(/sessionId=([a-zA-Z0-9_]+)/);
    assert(matchSession && matchSession[1], 'Must extract sessionId');
    const sessionId = matchSession[1];
    console.log(`   ✓ GET /sse stream opened with sessionId: ${sessionId}`);

    // 5. POST /message?sessionId= handles tools/list
    console.log('5. Testing POST /message?sessionId= with tools/list...');
    const resMsgList = await fetch(`${baseUrl}/message?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {},
      }),
    });
    assert.strictEqual(resMsgList.status, 202, 'POST /message must return 202 accepted');

    // Read message event from the active SSE stream
    const { value: msgChunk } = await reader.read();
    const msgText = new TextDecoder().decode(msgChunk);
    assert(msgText.includes('event: message'), 'Must emit event: message over SSE');
    assert(msgText.includes('nv_prepare_transfer'), 'SSE payload must contain tool catalog');
    console.log('   ✓ POST /message tools/list emitted catalog over active SSE stream');
    sseController.abort();

    // 6. POST /sse tools/call without auth -> 401 + WWW-Authenticate
    console.log('6. Testing unauthenticated POST /sse tools/call -> 401...');
    const resCallNoAuth = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'nv_prepare_transfer', arguments: { to: '0x123', amount: '1' } },
      }),
    });
    assert.strictEqual(resCallNoAuth.status, 401, 'Unauthenticated tools/call must return 401');
    const wwwAuth = resCallNoAuth.headers.get('www-authenticate');
    assert(wwwAuth && (wwwAuth.includes('Bearer realm="Northveil"') || wwwAuth.includes('Bearer realm="mcp"')), 'Must include Bearer realm WWW-Authenticate');
    console.log('   ✓ Unauthenticated tools/call correctly rejected with 401 + WWW-Authenticate');

    // 7. Streamable HTTP on POST /sse with Accept: text/event-stream
    console.log('7. Testing Streamable HTTP on POST /sse with Accept: text/event-stream...');
    const resStreamable = await fetch(`${baseUrl}/sse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/list',
        params: {},
      }),
    });
    assert.strictEqual(resStreamable.status, 200);
    const streamableCt = resStreamable.headers.get('content-type') || '';
    assert(streamableCt.includes('text/event-stream'), 'Must return text/event-stream');
    const streamableText = await resStreamable.text();
    assert(streamableText.includes('event: message'), 'Must format as SSE message event');
    assert(streamableText.includes('nv_get_portfolio'), 'Must contain tools catalog in SSE body');
    console.log('   ✓ Streamable HTTP on POST /sse verified with SSE frame output');

    console.log('\n🎉 ALL FOLLOW-UP 11 CLAUDE MCP DISCOVERY TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('Follow-Up 11 test failed:', err);
  process.exit(1);
});
