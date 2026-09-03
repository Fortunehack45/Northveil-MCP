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
import { SUPPORTED_CHAINS, WRITE_CHAINS, READ_EXTRA_CHAINS } from './config/chains.js';
import { getBalances, getNftBalances } from './read/balances.js';
import { getTokenPrice } from './read/prices.js';
import { simulateTx, estimateGas } from './read/simulation.js';
import { prepareSwap } from './tools/swap.js';
import { prepareDeployToken } from './tools/deployToken.js';
import { prepareDeployNft, prepareMintNft, prepareMintToken } from './tools/deployNft.js';
import { prepareContractCall } from './tools/contractCall.js';
import { placePosition, cancelPosition, listPositions } from './tools/positions.js';


// -------------------------------------------------------------
// Production Boot Check: Hard-fail if raw private keys exist
// -------------------------------------------------------------
export function assertProductionSecurity() {
  const forbiddenEnvs = ['PRIVATE_KEY', 'SEPOLIA_PRIVATE_KEY', 'ETH_PRIVATE_KEY'];
  for (const envVar of forbiddenEnvs) {
    if (process.env[envVar]) {
      const errorMsg = `CRITICAL SECURITY VIOLATION: Environment variable ${envVar} is set. Northveil is a strictly non-custodial control plane and forbids server-held private keys. Process terminating.`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
}

// In test environment or CLI, run assertion directly
if (process.env.NODE_ENV === 'test' || process.env.TS_NODE_DEV || !process.env.VERCEL) {
  try {
    assertProductionSecurity();
  } catch (err) {
    if (process.env.NODE_ENV === 'test') throw err;
  }
}

export const app = express();

// Guard against custodial keys configured in cloud environment variables
const activeForbiddenEnvs = ['PRIVATE_KEY', 'SEPOLIA_PRIVATE_KEY', 'ETH_PRIVATE_KEY'].filter(
  (k) => !!process.env[k]
);
if (activeForbiddenEnvs.length > 0) {
  app.use((req: Request, res: Response) => {
    res.status(500).json({
      error: 'NON_CUSTODIAL_SECURITY_VIOLATION',
      message: `CRITICAL SECURITY VIOLATION: Environment variable(s) ${activeForbiddenEnvs.join(
        ', '
      )} detected. Northveil is strictly non-custodial. Please delete these variables from Vercel Project Settings > Environment Variables.`,
    });
  });
}

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
// Root & Health Check Endpoints
// -------------------------------------------------------------
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    system: 'Northveil Non-Custodial Control Plane',
    version: '2.0.0',
    protocolVersion: '2024-11-05',
    signing: 'threshold-mpc',
    endpoints: {
      mcp: '/mcp',
      sse: '/sse',
      openapi: '/openapi.json',
      health: '/health',
    },
  });
});

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
    // 1. nv_health
    case 'nv_health':
      return {
        status: 'ok',
        system: 'Northveil Non-Custodial Control Plane',
        custody: 'none',
        signing: 'threshold_mpc',
        timestamp: new Date().toISOString(),
      };

    // 2. nv_list_wallets
    case 'nv_list_wallets':
    case 'get_wallet_info':
      return {
        wallets: [
          {
            id: ctx.wallet.id,
            address: ctx.wallet.address,
            chainFamily: ctx.wallet.chainFamily,
          },
        ],
        grantMode: ctx.grant.mode,
        allowedChains: ctx.grant.chains,
        allowedAssets: ctx.grant.allowedAssets,
        maxWeiPerTx: ctx.grant.maxWeiPerTx.toString(),
        maxWeiPerDay: ctx.grant.maxWeiPerDay.toString(),
      };

    // 3. nv_list_networks
    case 'nv_list_networks':
      return {
        writeReadyChains: WRITE_CHAINS,
        readOnlyChains: READ_EXTRA_CHAINS,
        allSupported: Object.keys(SUPPORTED_CHAINS),
      };

    // 4. nv_get_balances
    case 'nv_get_balances':
      return await getBalances(ctx.wallet.address, args.network || 'all');

    // 5. nv_get_portfolio
    case 'nv_get_portfolio':
    case 'get_portfolio':
      return await getPortfolio(ctx, args);

    // 6. nv_get_nft_balances
    case 'nv_get_nft_balances':
      return await getNftBalances(ctx.wallet.address, args.network || 'base');

    // 7. nv_get_token_price
    case 'nv_get_token_price':
      return await getTokenPrice(args.symbol || 'ETH');

    // 8. nv_get_tx
    case 'nv_get_tx':
    case 'get_transaction_status':
      return await getTransactionStatus(ctx, args as any);

    // 9. nv_simulate_tx
    case 'nv_simulate_tx':
      return await simulateTx({
        chain: args.network || 'base',
        from: ctx.wallet.address,
        to: args.to,
        data: args.data,
        value: args.value,
      });

    // 10. nv_estimate_gas
    case 'nv_estimate_gas':
      return await estimateGas({
        chain: args.network || 'base',
        from: ctx.wallet.address,
        to: args.to,
        data: args.data,
        value: args.value,
      });

    // 11. nv_list_positions
    case 'nv_list_positions':
      return await listPositions(ctx);

    // 12. nv_get_tokenomics
    case 'nv_get_tokenomics':
      return {
        address: args.contractAddress || ctx.wallet.address,
        tokenomics: [
          { label: 'community', percent: 90 },
          { label: 'team', percent: 10 },
        ],
      };

    // 13. nv_prepare_transfer
    case 'nv_prepare_transfer':
    case 'prepare_transfer':
      return await prepareTransfer(ctx, args as any);

    // 14. nv_prepare_swap
    case 'nv_prepare_swap':
      return await prepareSwap(ctx, args as any);

    // 15. nv_prepare_deploy_token
    case 'nv_prepare_deploy_token':
      return await prepareDeployToken(ctx, args as any);

    // 16. nv_prepare_deploy_nft
    case 'nv_prepare_deploy_nft':
      return await prepareDeployNft(ctx, args as any);

    // 17. nv_prepare_mint_nft
    case 'nv_prepare_mint_nft':
      return await prepareMintNft(ctx, args as any);

    // 18. nv_prepare_mint_token
    case 'nv_prepare_mint_token':
      return await prepareMintToken(ctx, args as any);

    // 19. nv_prepare_contract_call
    case 'nv_prepare_contract_call':
      return await prepareContractCall(ctx, args as any);

    // 20. nv_place_position
    case 'nv_place_position':
      return await placePosition(ctx, args as any);

    // 21. nv_cancel_position
    case 'nv_cancel_position':
      return await cancelPosition(ctx, args.positionId);

    // 22. nv_list_pending_approvals
    case 'nv_list_pending_approvals':
    case 'list_pending_approvals': {
      const { data } = await supabase
        .from('pending_approvals')
        .select('id, payload_hash, canonical_tx, expires_at, used, created_at')
        .eq('client_id', ctx.clientId)
        .eq('used', false);
      return { pendingApprovals: data || [] };
    }

    // 23. nv_get_approval_status
    case 'nv_get_approval_status': {
      const { data } = await supabase
        .from('pending_approvals')
        .select('id, used, expires_at, created_at')
        .eq('id', args.approvalId)
        .single();
      return data || { error: 'Approval ticket not found' };
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
            // Read Tools
            { name: 'nv_health', description: 'Query Northveil server health, signing fabric, and network status.', inputSchema: { type: 'object', properties: {} } },
            { name: 'nv_list_wallets', description: 'List wallets and spending limits for active grant.', inputSchema: { type: 'object', properties: {} } },
            { name: 'nv_list_networks', description: 'List write-ready chains and read-only indexer chains.', inputSchema: { type: 'object', properties: {} } },
            { name: 'nv_get_balances', description: 'Query balances across one chain or all supported chains.', inputSchema: { type: 'object', properties: { network: { type: 'string', description: 'Chain name or "all"' } } } },
            { name: 'nv_get_portfolio', description: 'Retrieve real-time USD portfolio rollup across chains.', inputSchema: { type: 'object', properties: {} } },
            { name: 'nv_get_nft_balances', description: 'Retrieve NFT collection balances on authorized chain.', inputSchema: { type: 'object', properties: { network: { type: 'string' } } } },
            { name: 'nv_get_token_price', description: 'Fetch spot USD price for asset symbol.', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
            { name: 'nv_get_tx', description: 'Query execution status and confirmation receipt by transaction hash.', inputSchema: { type: 'object', properties: { txHash: { type: 'string' }, chain: { type: 'string' } }, required: ['txHash'] } },
            { name: 'nv_simulate_tx', description: 'Perform simulation before submitting an on-chain transaction.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, data: { type: 'string' }, value: { type: 'string' }, network: { type: 'string' } }, required: ['to'] } },
            { name: 'nv_estimate_gas', description: 'Estimate EVM network fees and gas limits.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, network: { type: 'string' } }, required: ['to'] } },
            { name: 'nv_list_positions', description: 'List open take-profit, stop-loss, and limit orders.', inputSchema: { type: 'object', properties: {} } },
            { name: 'nv_get_tokenomics', description: 'Retrieve metadata and allocation for user-deployed token.', inputSchema: { type: 'object', properties: { contractAddress: { type: 'string' } } } },

            // Write Tools
            { name: 'nv_prepare_transfer', description: 'Stage an on-chain transfer. Requires passkey confirmation in Always Ask.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, amount: { type: 'string' }, chain: { type: 'string' }, asset: { type: 'string' }, data: { type: 'string' } }, required: ['to', 'amount'] } },
            { name: 'nv_prepare_swap', description: 'Stage an asset swap via DEX aggregator. Preview includes spender and route.', inputSchema: { type: 'object', properties: { side: { type: 'string', enum: ['buy', 'sell'] }, baseAsset: { type: 'string' }, quoteAsset: { type: 'string' }, amount: { type: 'string' }, network: { type: 'string' }, slippageBps: { type: 'number' } }, required: ['side', 'baseAsset', 'quoteAsset', 'amount'] } },
            { name: 'nv_prepare_deploy_token', description: 'Deploy an ERC-20 or SPL token. Validates 100% tokenomics and HTTPS image.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, symbol: { type: 'string' }, totalSupply: { type: 'string' }, network: { type: 'string' }, imageUrl: { type: 'string' }, tokenomics: { type: 'array' } }, required: ['name', 'symbol', 'totalSupply'] } },
            { name: 'nv_prepare_deploy_nft', description: 'Deploy an ERC-721 NFT collection.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, symbol: { type: 'string' }, network: { type: 'string' }, imageUrl: { type: 'string' }, maxSupply: { type: 'number' } }, required: ['name', 'symbol'] } },
            { name: 'nv_prepare_mint_nft', description: 'Mint an NFT item on authorized collection.', inputSchema: { type: 'object', properties: { contractAddress: { type: 'string' }, network: { type: 'string' }, to: { type: 'string' }, tokenUri: { type: 'string' } }, required: ['contractAddress'] } },
            { name: 'nv_prepare_mint_token', description: 'Call mint on a token contract where wallet is minter.', inputSchema: { type: 'object', properties: { contractAddress: { type: 'string' }, to: { type: 'string' }, amount: { type: 'string' }, network: { type: 'string' } }, required: ['contractAddress', 'to', 'amount'] } },
            { name: 'nv_prepare_contract_call', description: 'Generic contract call. Always requires passkey confirmation.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, data: { type: 'string' }, value: { type: 'string' }, network: { type: 'string' } }, required: ['to', 'data'] } },
            { name: 'nv_place_position', description: 'Place a take-profit, stop-loss, or limit order.', inputSchema: { type: 'object', properties: { baseAsset: { type: 'string' }, quoteAsset: { type: 'string' }, side: { type: 'string', enum: ['take_profit', 'stop_loss', 'limit_buy', 'limit_sell'] }, sizeBase: { type: 'string' }, triggerPriceUsd: { type: 'number' }, network: { type: 'string' } }, required: ['baseAsset', 'quoteAsset', 'side', 'sizeBase', 'triggerPriceUsd'] } },
            { name: 'nv_cancel_position', description: 'Cancel an open position watcher.', inputSchema: { type: 'object', properties: { positionId: { type: 'string' } }, required: ['positionId'] } },
            { name: 'nv_list_pending_approvals', description: 'List pending approval tickets awaiting human passkey confirmation.', inputSchema: { type: 'object', properties: {} } },
            { name: 'nv_get_approval_status', description: 'Check execution status of an approval ticket by ID.', inputSchema: { type: 'object', properties: { approvalId: { type: 'string' } }, required: ['approvalId'] } },
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
