import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { app, assertProductionSecurity } from './src/server.js';
import { resolveContext, extractClientKey } from './src/auth/resolveContext.js';
import { prepareTransfer } from './src/tools/prepareTransfer.js';
import { getPortfolio } from './src/tools/getPortfolio.js';
import { getTransactionStatus } from './src/tools/getTransactionStatus.js';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });
if (!process.env.SUPABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
}

// Ensure non-custodial security invariant
assertProductionSecurity();

export const isStdioMode = process.argv.includes('--stdio') || process.env.MCP_TRANSPORT === 'stdio';

// Redirect logging in stdio mode so process.stdout remains strictly valid JSON-RPC
if (isStdioMode) {
  console.log = (...args: any[]) => process.stderr.write(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
  console.info = (...args: any[]) => process.stderr.write(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
  console.warn = (...args: any[]) => process.stderr.write(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      const { jsonrpc, id, method, params } = msg;

      if (method === 'initialize') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'northveil-mcp', version: '2.0.0' },
          },
        }) + '\n');
        return;
      }

      if (method === 'tools/list') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'get_portfolio',
                description: 'Retrieve real-time asset balances and USD valuations for the authorized Northveil wallet.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    walletAddress: { type: 'string', description: 'Optional wallet address filter' },
                  },
                },
              },
              {
                name: 'prepare_transfer',
                description: 'Stage an on-chain transfer. Under Always Ask, generates an approval ticket for passkey signing. Under Autonomous, signs and broadcasts directly if within grant policy.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    to: { type: 'string', description: 'Destination 0x EVM recipient address' },
                    amount: { type: 'string', description: 'Amount in ETH or token units' },
                    chain: { type: 'string', description: 'Chain identifier' },
                    asset: { type: 'string', description: 'Asset symbol' },
                    data: { type: 'string', description: 'Optional calldata hex string' },
                  },
                  required: ['to', 'amount'],
                },
              },
              {
                name: 'get_transaction_status',
                description: 'Query on-chain confirmation status and execution receipt for a transaction hash.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    txHash: { type: 'string', description: '32-byte 0x-prefixed transaction hash' },
                  },
                  required: ['txHash'],
                },
              },
            ],
          },
        }) + '\n');
        return;
      }

      if (method === 'tools/call') {
        const apiKey = process.env.NORTHVEIL_API_KEY || '';
        const mockReq: any = {
          headers: {
            'x-api-key': apiKey,
          },
        };

        const ctx = await resolveContext(mockReq, params?.arguments || {});
        let toolResult: any;

        if (params?.name === 'get_portfolio') {
          toolResult = await getPortfolio(ctx, params?.arguments || {});
        } else if (params?.name === 'prepare_transfer') {
          toolResult = await prepareTransfer(ctx, params?.arguments || {});
        } else if (params?.name === 'get_transaction_status') {
          toolResult = await getTransactionStatus(ctx, params?.arguments || {});
        } else {
          throw new Error(`Tool "${params?.name}" not recognized.`);
        }

        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
          },
        }) + '\n');
        return;
      }

      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method "${method}" not found` },
      }) + '\n');
    } catch (err: any) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message || 'Error processing request' },
      }) + '\n');
    }
  });
} else {
  // HTTP server mode (only bind port in standalone daemon mode, not in Vercel/Serverless)
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.NETLIFY;
  if (!isServerless) {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`[Northveil-MCP] Server listening on port ${PORT} (Non-custodial control plane)`);
    });
  }
}

export default app;
export * from './src/server.js';
