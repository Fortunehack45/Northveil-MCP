import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/server.js';
import { signSessionToken } from '../src/auth/session.js';

let NorthveilClient: any;
try {
  // @ts-ignore
  const mod = await import('../../sdk/src/client.js');
  NorthveilClient = mod.NorthveilClient;
} catch {
  NorthveilClient = null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== Running Follow-Up 15 Non-Custodial & Code Invariant Tests ===');

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_MOCK_SIGNER = '1';

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const dummyUserId = 'test_' + Date.now();
    const token = signSessionToken({
      userId: dummyUserId,
      email: 'f15@northveil.xyz',
      passkeyOk: true,
    });

    // -------------------------------------------------------------
    // Test 1: POST /wallet/import/finish with raw mnemonic -> 400 RAW_MATERIAL_FORBIDDEN
    // -------------------------------------------------------------
    console.log('1. Testing POST /wallet/import/finish rejects raw mnemonic with 400 RAW_MATERIAL_FORBIDDEN...');
    const resMnemonicFinish = await fetch(`${baseUrl}/wallet/import/finish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mnemonic: 'test test test test test test test test test test test junk',
      }),
    });
    assert.strictEqual(resMnemonicFinish.status, 400, 'Must return 400 for raw mnemonic');
    const jsonMnemonic = await resMnemonicFinish.json();
    assert.strictEqual(jsonMnemonic.error, 'RAW_MATERIAL_FORBIDDEN');
    console.log('   ✓ /wallet/import/finish successfully rejected raw mnemonic with 400 RAW_MATERIAL_FORBIDDEN');

    // -------------------------------------------------------------
    // Test 2: POST /wallet/import/finish with raw privateKey -> 400 RAW_MATERIAL_FORBIDDEN
    // -------------------------------------------------------------
    console.log('2. Testing POST /wallet/import/finish rejects raw privateKey with 400 RAW_MATERIAL_FORBIDDEN...');
    const resKeyFinish = await fetch(`${baseUrl}/wallet/import/finish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      }),
    });
    assert.strictEqual(resKeyFinish.status, 400, 'Must return 400 for raw privateKey');
    const jsonKey = await resKeyFinish.json();
    assert.strictEqual(jsonKey.error, 'RAW_MATERIAL_FORBIDDEN');
    console.log('   ✓ /wallet/import/finish successfully rejected raw privateKey with 400 RAW_MATERIAL_FORBIDDEN');

    // -------------------------------------------------------------
    // Test 3: POST /wallet/import direct call -> 400 RAW_MATERIAL_FORBIDDEN
    // -------------------------------------------------------------
    console.log('3. Testing POST /wallet/import rejects direct plaintext import with 400 RAW_MATERIAL_FORBIDDEN...');
    const resDirectImport = await fetch(`${baseUrl}/wallet/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      }),
    });
    assert.strictEqual(resDirectImport.status, 400);
    const jsonDirect = await resDirectImport.json();
    assert.strictEqual(jsonDirect.error, 'RAW_MATERIAL_FORBIDDEN');
    console.log('   ✓ Direct /wallet/import rejected with 400 RAW_MATERIAL_FORBIDDEN');

    // -------------------------------------------------------------
    // Test 4: Verify zero occurrences of `fromPhrase` in hosted server code
    // -------------------------------------------------------------
    console.log('4. Verifying no `fromPhrase` exists in mcp-server/src directory...');
    const srcDir = path.resolve(__dirname, '../src');
    function scanDirForFromPhrase(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDirForFromPhrase(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          assert.ok(
            !content.includes('fromPhrase'),
            `SECURITY VIOLATION: Found 'fromPhrase' in hosted code: ${fullPath}`
          );
        }
      }
    }
    scanDirForFromPhrase(srcDir);
    console.log('   ✓ Verified: 0 occurrences of `fromPhrase` in mcp-server/src');

    // -------------------------------------------------------------
    // Test 5: Verify CLI source has no `--private-key` flag
    // -------------------------------------------------------------
    console.log('5. Verifying CLI source has no `--private-key` option or flag...');
    const cliSrcDir = path.resolve(__dirname, '../../cli/src');
    if (fs.existsSync(cliSrcDir)) {
      function scanCliForPrivateKeyFlag(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanCliForPrivateKeyFlag(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            assert.ok(
              !content.includes('--private-key') && !content.includes('--privateKey'),
              `SECURITY VIOLATION: Found '--private-key' in CLI source: ${fullPath}`
            );
          }
        }
      }
      scanCliForPrivateKeyFlag(cliSrcDir);
      console.log('   ✓ Verified: CLI source contains no `--private-key` option');
    } else {
      console.log('   ✓ Standalone repository: CLI directory not present, skipped');
    }

    // -------------------------------------------------------------
    // Test 6: Verify SDK rejects privateKey and mnemonic in constructor
    // -------------------------------------------------------------
    console.log('6. Verifying SDK rejects privateKey or mnemonic in constructor...');
    if (NorthveilClient) {
      assert.throws(
        () => {
          new (NorthveilClient as any)({
            clientKey: 'nv_live_dummy',
            privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
          });
        },
        /NON_CUSTODIAL_VIOLATION/,
        'SDK must throw NON_CUSTODIAL_VIOLATION when privateKey is passed'
      );

      assert.throws(
        () => {
          new (NorthveilClient as any)({
            clientKey: 'nv_live_dummy',
            mnemonic: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12',
          });
        },
        /NON_CUSTODIAL_VIOLATION/,
        'SDK must throw NON_CUSTODIAL_VIOLATION when mnemonic is passed'
      );
      console.log('   ✓ Verified: NorthveilClient constructor strictly rejects raw key material');
    } else {
      console.log('   ✓ Standalone repository: SDK module not present, skipped');
    }

    // -------------------------------------------------------------
    // Test 7: Verify resources/list returns { resources: [] }
    // -------------------------------------------------------------
    console.log('7. Verifying resources/list endpoint on MCP JSON-RPC...');
    const resMcpResources = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 101,
        method: 'resources/list',
        params: {},
      }),
    });
    assert.strictEqual(resMcpResources.status, 200);
    const mcpJson = await resMcpResources.json();
    assert.deepStrictEqual(mcpJson.result, { resources: [] });
    console.log('   ✓ Verified: resources/list returns { resources: [] }');

    console.log('\n✅ ALL FOLLOW-UP 15 NON-CUSTODIAL INVARIANT TESTS PASSED!\n');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
