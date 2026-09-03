import express, { Request, Response } from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { resolveContext, HttpError } from './auth/resolveContext.js';
import { prepareTransfer } from './tools/prepareTransfer.js';
import { getPortfolio } from './tools/getPortfolio.js';
import { getTransactionStatus } from './tools/getTransactionStatus.js';
import { consumeApproval, getApproval } from './wallet/approvals.js';
import { verifyPasskeyForPayload } from './auth/passkey.js';
import { getMpcProvider } from './wallet/mpcAdapter.js';
import { setAutonomousMode } from './tools/setAutonomousMode.js';
import { issueClientKey } from './auth/agentClient.js';
import { supabase } from './supabase.js';
import { logAudit } from './audit/log.js';

// -------------------------------------------------------------
// Production Boot Check: Hard-fail if raw private keys exist
// -------------------------------------------------------------
export function assertProductionSecurity() {
  const forbiddenEnvs = ['PRIVATE_KEY', 'SEPOLIA_PRIVATE_KEY', 'ETH_PRIVATE_KEY'];
  for (const envVar of forbiddenEnvs) {
    if (process.env[envVar]) {
      const errorMsg = `CRITICAL SECURITY VIOLATION: Environment variable ${envVar} is set. Northveil is a strictly non-custodial control plane and forbids server-held private keys. Process terminating.`;
      console.error(errorMsg);
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
      throw new Error(errorMsg);
    }
  }
}

assertProductionSecurity();

export const app = express();

app.use(cors({
  origin: (origin, callback) => {
    // Allow wallet web app and local developer tools
    const allowed = [
      'https://wallet.northveil.xyz',
      'http://localhost:3000',
      'http://localhost:5173',
    ];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));

app.use(express.json());

// Rate limit: 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/mcp', apiLimiter);

// -------------------------------------------------------------
// Health Check Endpoint
// -------------------------------------------------------------
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    system: 'Northveil Non-Custodial Control Plane',
    custody: 'none',
    signing: 'threshold_mpc',
    timestamp: new Date().toISOString(),
  });
});

// -------------------------------------------------------------
// Tool Dispatcher
// -------------------------------------------------------------
async function executeTool(name: string, args: Record<string, any>, req: Request) {
  const ctx = await resolveContext(req, args);

  switch (name) {
    case 'get_portfolio':
      return await getPortfolio(ctx, args);

    case 'prepare_transfer':
      return await prepareTransfer(ctx, args as any);

    case 'get_transaction_status':
      return await getTransactionStatus(ctx, args as any);

    case 'get_wallet_info':
      return {
        address: ctx.wallet.address,
        chainFamily: ctx.wallet.chainFamily,
        grantMode: ctx.grant.mode,
        allowedChains: ctx.grant.chains,
        allowedAssets: ctx.grant.allowedAssets,
        maxWeiPerTx: ctx.grant.maxWeiPerTx.toString(),
        maxWeiPerDay: ctx.grant.maxWeiPerDay.toString(),
      };

    case 'list_pending_approvals': {
      const { data } = await supabase
        .from('pending_approvals')
        .select('id, payload_hash, canonical_tx, expires_at, used, created_at')
        .eq('client_id', ctx.clientId)
        .eq('used', false);
      return { pendingApprovals: data || [] };
    }

    default:
      throw new HttpError(404, `Tool "${name}" not found or out of scope.`);
  }
}

// -------------------------------------------------------------
// JSON-RPC 2.0 MCP Endpoint (POST /mcp)
// -------------------------------------------------------------
app.post('/mcp', async (req: Request, res: Response) => {
  const { jsonrpc, id, method, params } = req.body || {};

  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' } });
  }

  try {
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'northveil-mcp', version: '2.0.0' },
        },
      });
    }

    if (method === 'tools/list') {
      return res.json({
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
              name: 'get_wallet_info',
              description: 'Retrieve metadata, active grant policies, and spending limits for the authorized wallet.',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'prepare_transfer',
              description: 'Stage an on-chain transfer. Under Always Ask, generates an approval ticket for passkey signing. Under Autonomous, signs and broadcasts directly if within grant policy.',
              inputSchema: {
                type: 'object',
                properties: {
                  to: { type: 'string', description: 'Destination 0x EVM recipient address' },
                  amount: { type: 'string', description: 'Amount in ETH or token units (e.g. "0.05")' },
                  chain: { type: 'string', description: 'Chain identifier (e.g. "eip155:8453" for Base)' },
                  asset: { type: 'string', description: 'Asset symbol (e.g. "ETH", "USDC")' },
                  data: { type: 'string', description: 'Optional calldata hex string (0x)' },
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
                  chain: { type: 'string', description: 'Network name (e.g. "base", "sepolia")' },
                },
                required: ['txHash'],
              },
            },
            {
              name: 'list_pending_approvals',
              description: 'List active pending approval tickets awaiting human passkey confirmation.',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      });
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const result = await executeTool(toolName, toolArgs, req);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      });
    }

    return res.status(404).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method "${method}" not found` },
    });
  } catch (err: any) {
    const statusCode = err instanceof HttpError ? err.statusCode : 500;
    return res.status(statusCode).json({
      jsonrpc: '2.0',
      id,
      error: {
        code: statusCode === 401 ? -32001 : statusCode === 403 ? -32003 : -32603,
        message: err.message || 'Internal error',
      },
    });
  }
});

// -------------------------------------------------------------
// Server-Sent Events (SSE) Transport (GET /sse & POST /message)
// -------------------------------------------------------------
const sseClients = new Map<string, Response>();

app.get('/sse', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = 'sse_' + Math.random().toString(36).slice(2, 12);
  sseClients.set(sessionId, res);

  res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

  req.on('close', () => {
    sseClients.delete(sessionId);
  });
});

app.post('/message', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const sseClient = sseClients.get(sessionId);

  const { id, method, params } = req.body || {};
  try {
    if (method === 'tools/call') {
      const result = await executeTool(params?.name, params?.arguments || {}, req);
      const payload = {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      };
      if (sseClient) {
        sseClient.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      }
      return res.status(202).json({ status: 'accepted' });
    }
  } catch (err: any) {
    const errorPayload = {
      jsonrpc: '2.0',
      id,
      error: { message: err.message || 'Error executing tool' },
    };
    if (sseClient) {
      sseClient.write(`event: message\ndata: ${JSON.stringify(errorPayload)}\n\n`);
    }
    return res.status(err.statusCode || 500).json(errorPayload);
  }

  res.status(200).json({ status: 'received' });
});

// -------------------------------------------------------------
// Passkey Approval Completion (POST /api/approvals/:id/complete)
// -------------------------------------------------------------
app.post('/api/approvals/:id/complete', async (req: Request, res: Response) => {
  const approvalId = req.params.id;
  const { assertionResponse, credentialId } = req.body;

  try {
    // 1. Fetch ticket
    const ticket = getApproval(approvalId);
    if (!ticket) {
      return res.status(404).json({ error: 'UNKNOWN_APPROVAL' });
    }

    // 2. Consume ticket (enforces single use, expiry, payload hash)
    await consumeApproval(approvalId, ticket.payloadHash);

    // 3. In production, verify passkey WebAuthn challenge commits to payloadHash
    if (process.env.NODE_ENV === 'production' && assertionResponse) {
      const { data: passkeyRecord } = await supabase
        .from('passkeys')
        .select('*')
        .eq('credential_id', credentialId)
        .eq('user_id', ticket.userId)
        .single();

      if (!passkeyRecord) {
        return res.status(403).json({ error: 'UNAUTHORIZED_PASSKEY_CREDENTIAL' });
      }

      await verifyPasskeyForPayload({
        response: assertionResponse,
        expectedChallenge: Buffer.from(ticket.payloadHash.replace(/^0x/, ''), 'hex').toString('base64url'),
        storedAuthenticator: {
          credentialID: Buffer.from(passkeyRecord.credential_id, 'base64url'),
          credentialPublicKey: Buffer.from(passkeyRecord.credential_public_key),
          counter: Number(passkeyRecord.counter),
        },
      });
    }

    // 4. Threshold sign exact canonical bytes with Turnkey MPC provider
    const mpc = getMpcProvider();
    const signResult = await mpc.signAndBroadcast({
      mpcWalletId: ticket.walletId || 'turnkey-wallet',
      unsignedTx: ticket.canonicalTx as any,
      payloadHash: ticket.payloadHash,
      approvalEvidence: { type: 'passkey', approvalId: ticket.id },
    });

    await logAudit({
      userId: ticket.userId,
      walletAddress: ticket.walletAddress,
      clientId: ticket.clientId,
      action: 'APPROVAL_EXECUTED_PASSKEY',
      details: { approvalId, txHash: signResult.txHash },
    });

    return res.json({
      status: 'EXECUTED',
      txHash: signResult.txHash,
      approvalId,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Approval execution failed' });
  }
});

// -------------------------------------------------------------
// OpenAPI 3.0.3 Specification (GET /openapi.json)
// -------------------------------------------------------------
app.get('/openapi.json', (req: Request, res: Response) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'Northveil MCP API',
      version: '2.0.0',
      description: 'Northveil Non-Custodial Agent Wallet & Control Plane API',
    },
    servers: [{ url: 'https://mcp.northveil.xyz' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/mcp': {
        post: {
          summary: 'JSON-RPC 2.0 MCP Gateway',
          requestBody: { required: true, content: { 'application/json': {} } },
          responses: { '200': { description: 'JSON-RPC Result' } },
        },
      },
    },
  });
});

export default app;
