import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { resolveContext, HttpError, hashToken } from './auth/resolveContext.js';
import { toolCatalog } from './mcp/toolCatalog.js';
import { handleMcpJsonRpc } from './mcp/handleJsonRpc.js';
import { executeTool } from './tools/dispatch.js';
import { prepareTransfer } from './tools/prepareTransfer.js';
import { getPortfolio } from './tools/getPortfolio.js';
import { getTransactionStatus } from './tools/getTransactionStatus.js';
import { consumeApproval, getApproval, getApprovalAsync } from './wallet/approvals.js';
import { verifyPasskeyForPayload, asWebAuthnCredentialJSON } from './auth/passkey.js';
import {
  getMpcProvider,
  isHosted,
  allowOrgSign,
  importFinishOrAttach,
  attachExistingTurnkeyWallet,
  parseAlreadyImportedWalletId,
  fetchTurnkeyWalletAddress,
} from './wallet/mpcAdapter.js';
import { submitIntent, getRequest, loadRequest, updateRequest, insertSignPermit, signAndAdvance, assertSignPermit } from './wallet/requestLifecycle.js';
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
import { requireSession, signSessionToken, getSession } from './auth/session.js';
import { getTxHistory } from './read/history.js';
import { exchangeGoogleCode, upsertGoogleUser } from './auth/google.js';
import {
  handleDynamicClientRegistration,
  saveAuthCode,
  consumeAuthCode,
  insertOauthToken,
  ensureOauthAgentClient,
  sha256,
  sha256Base64Url,
  daysFromNow,
} from './auth/oauth.js';
import {
  generatePasskeyRegistrationOptions,
  generatePasskeyLoginOptions,
  verifyPasskeyRegistration,
  verifyPasskeyLogin,
  savePasskeyRecord,
  findPasskeyByCredentialId,
  unpackCredentialPublicKey,
  saveWebauthnChallenge,
  consumeWebauthnChallenge,
  getRpId,
  allowedOrigins,
  challengeStore,
  signChallengeToken,
  verifyChallengeToken,
} from './auth/passkey.js';
import { startEmailOtp, verifyEmailOtp, nextStep } from './auth/emailOtp.js';
import crypto from 'node:crypto';


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

console.log('[Northveil] boot: signer=turnkey (MPC hardware enclave)');

export const app = express();
app.set('trust proxy', 1);

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

const ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-API-Key',
  'X-Session-Token',
  'X-User-Id',
  'Accept',
  'Origin',
  'WWW-Authenticate',
  'mcp-session-id',
  'Last-Event-ID',
].join(',');

const ALLOW_ORIGINS = new Set([
  'https://wallet.northveil.xyz',
  'https://www.northveil.xyz',
  'https://northveil.xyz',
  'https://chatgpt.com',
  'https://chat.openai.com',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]);

function originOk(origin?: string) {
  if (!origin) return true;
  if (ALLOW_ORIGINS.has(origin)) return true;
  if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?claude\.ai$/.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?chatgpt\.com$/.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?openai\.com$/.test(origin)) return true;
  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && originOk(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
    res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Content-Type, Authorization, Location, mcp-session-id');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------------------------------------------------
// Phase 3 — RFC 8414 & OAuth 2.0 Protected Resource Metadata
// -------------------------------------------------------------
const handleProtectedResourceMetadata = (req: Request, res: Response) => {
  const canonical = 'https://mcp.northveil.xyz';
  let resourceUrl = canonical;
  if (req.query.resource && typeof req.query.resource === 'string') {
    resourceUrl = req.query.resource;
  } else if (req.originalUrl.includes('/mcp')) {
    resourceUrl = `${canonical}/mcp`;
  } else if (req.originalUrl.includes('/sse')) {
    resourceUrl = `${canonical}/sse`;
  }

  res.json({
    resource: resourceUrl,
    authorization_servers: [canonical],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
    resource_documentation: canonical,
    icon_uri: 'https://iili.io/CDS9fvn.png',
    logo_uri: 'https://iili.io/CDS9fvn.png',
  });
};

app.get([
  '/.well-known/oauth-protected-resource',
  '/mcp/.well-known/oauth-protected-resource',
  '/sse/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource/sse',
], handleProtectedResourceMetadata);

const handleAuthServerMetadata = (_req: Request, res: Response) => {
  const iss = 'https://mcp.northveil.xyz';
  res.json({
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    registration_endpoint: `${iss}/oauth/register`,
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    response_types_supported: ['code'],
    service_documentation: iss,
    icon_uri: 'https://iili.io/CDS9fvn.png',
    logo_uri: 'https://iili.io/CDS9fvn.png',
  });
};

app.get([
  '/.well-known/oauth-authorization-server',
  '/mcp/.well-known/oauth-authorization-server',
  '/sse/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
  '/.well-known/oauth-authorization-server/sse',
], handleAuthServerMetadata);

// Dynamic Client Registration (RFC 7591)
app.post('/oauth/register', express.json(), async (req: Request, res: Response) => {
  try {
    const result = await handleDynamicClientRegistration(req.body);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(err.statusCode || 400).json({ error: err.message || 'invalid_request' });
  }
});

// OAuth 2.0 Authorization Endpoint
app.get('/oauth/authorize', async (req: Request, res: Response) => {
  const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state, prompt } = req.query;
  const consentParams = new URLSearchParams({
    client_id: String(client_id || 'claude'),
    redirect_uri: String(redirect_uri || ''),
    code_challenge: String(code_challenge || ''),
    code_challenge_method: String(code_challenge_method || 'S256'),
    state: String(state || ''),
  });

  const session = getSession(req);
  if (!session) {
    const nextUrl = `/oauth/authorize?${consentParams.toString()}`;
    return res.redirect(`https://wallet.northveil.xyz/login?next=${encodeURIComponent(nextUrl)}&${consentParams.toString()}`);
  }

  if (prompt === 'consent') {
    return res.redirect(`https://wallet.northveil.xyz/oauth/consent?${consentParams.toString()}`);
  }

  if (redirect_uri && code_challenge) {
    const rawCode = 'nv_code_' + crypto.randomBytes(24).toString('base64url');
    await saveAuthCode({
      code: rawCode,
      user_id: session.userId,
      client_id: String(client_id || 'claude'),
      code_challenge: String(code_challenge),
      redirect_uri: String(redirect_uri),
    });

    const callbackUrl = new URL(String(redirect_uri));
    callbackUrl.searchParams.set('code', rawCode);
    if (state) callbackUrl.searchParams.set('state', String(state));
    return res.redirect(callbackUrl.toString());
  }

  return res.redirect(`https://wallet.northveil.xyz/oauth/consent?${consentParams.toString()}`);
});

// OAuth 2.0 Consent Endpoint (called by Wallet SPA upon user approval)
app.post('/oauth/consent', requireSession, async (req: Request, res: Response) => {
  const { client_id, redirect_uri, code_challenge, state } = req.body;
  if (!redirect_uri || !code_challenge) {
    return res.status(400).json({ error: 'redirect_uri and code_challenge required' });
  }

  const rawCode = 'nv_code_' + crypto.randomBytes(24).toString('base64url');
  const userId = (req as any).session.userId;

  await saveAuthCode({
    code: rawCode,
    user_id: userId,
    client_id: client_id || 'claude',
    code_challenge,
    redirect_uri,
  });

  const callbackUrl = new URL(redirect_uri);
  callbackUrl.searchParams.set('code', rawCode);
  if (state) callbackUrl.searchParams.set('state', state);

  return res.json({ redirect_uri: callbackUrl.toString() });
});

// OAuth 2.0 Token Endpoint (verifies PKCE, returns Bearer token)
app.post('/oauth/token', express.urlencoded({ extended: false }), express.json(), async (req: Request, res: Response) => {
  const { grant_type, code, client_id, redirect_uri, code_verifier, refresh_token } = req.body;

  if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
    }
    const refreshHash = sha256(refresh_token);
    const { data: existingToken } = await supabase
      .from('oauth_tokens')
      .select('*')
      .eq('refresh_hash', refreshHash)
      .eq('status', 'active')
      .maybeSingle();

    if (!existingToken) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    await supabase.from('oauth_tokens').update({ status: 'revoked' }).eq('id', existingToken.id);

    const newAccess = 'nv_oauth_' + crypto.randomBytes(24).toString('base64url');
    const newRefresh = 'nv_rt_' + crypto.randomBytes(24).toString('base64url');
    await insertOauthToken({
      token_hash: sha256(newAccess),
      refresh_hash: sha256(newRefresh),
      user_id: existingToken.user_id,
      client_id: existingToken.client_id,
      expires_at: daysFromNow(30),
    });

    return res.json({
      token_type: 'Bearer',
      access_token: newAccess,
      refresh_token: newRefresh,
      expires_in: 2592000,
      scope: 'mcp',
    });
  }

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  if (!code || !code_verifier) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  const row = await consumeAuthCode(code);
  if (!row) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  const b64Challenge = sha256Base64Url(code_verifier);
  const hexChallenge = sha256(code_verifier);
  if (
    row.code_challenge !== b64Challenge &&
    row.code_challenge !== hexChallenge &&
    row.code_challenge !== code_verifier
  ) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  const access = 'nv_oauth_' + crypto.randomBytes(24).toString('base64url');
  const refresh = 'nv_rt_' + crypto.randomBytes(24).toString('base64url');
  const agentClientId = await ensureOauthAgentClient(row.user_id);

  await insertOauthToken({
    token_hash: sha256(access),
    refresh_hash: sha256(refresh),
    user_id: row.user_id,
    client_id: agentClientId,
    expires_at: daysFromNow(30),
  });

  return res.json({
    token_type: 'Bearer',
    access_token: access,
    refresh_token: refresh,
    expires_in: 2592000,
    scope: 'mcp',
  });
});

// Rate limit: 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/mcp', apiLimiter);

// -------------------------------------------------------------
// Static branding & favicon routes
// -------------------------------------------------------------
app.get('/favicon.ico', (_req: Request, res: Response) => {
  res.redirect(302, 'https://iili.io/CDS9fvn.png');
});

app.get('/logo.png', (_req: Request, res: Response) => {
  res.redirect(302, 'https://iili.io/CDS9fvn.png');
});

app.get('/icon.png', (_req: Request, res: Response) => {
  res.redirect(302, 'https://iili.io/CDS9fvn.png');
});

// -------------------------------------------------------------
// Root Landing & Health Check Endpoints
// -------------------------------------------------------------
app.get('/', (req: Request, res: Response) => {
  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
  if (acceptsHtml) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Northveil MCP Control Plane</title>
  <link rel="icon" type="image/png" href="https://iili.io/CDS9fvn.png">
  <link rel="shortcut icon" href="https://iili.io/CDS9fvn.png">
  <link rel="apple-touch-icon" href="https://iili.io/CDS9fvn.png">
  <style>
    :root {
      color-scheme: dark;
      --bg: #09090b;
      --card: #121215;
      --border: rgba(255, 255, 255, 0.08);
      --text: #fafafa;
      --text-muted: #a1a1aa;
      --accent: #3b82f6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1.5rem;
      padding: 2.5rem;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      text-align: center;
    }
    .logo-container {
      width: 72px;
      height: 72px;
      margin: 0 auto 1.5rem;
      border-radius: 1.25rem;
      overflow: hidden;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.04);
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-container img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    p.subtitle { color: var(--text-muted); font-size: 0.875rem; margin-bottom: 1.75rem; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 2rem;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 10px #10b981;
    }
    .info-box {
      background: rgba(0,0,0,0.4);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.25rem;
      text-align: left;
      margin-bottom: 1.5rem;
      font-size: 0.825rem;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }
    .info-row:last-child { margin-bottom: 0; }
    .label { color: var(--text-muted); }
    .value { font-family: monospace; font-weight: 600; color: #60a5fa; }
    .footer-note { font-size: 0.75rem; color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <img src="https://iili.io/CDS9fvn.png" alt="Northveil MCP Logo">
    </div>
    <h1>Northveil MCP</h1>
    <p class="subtitle">Non-Custodial Agent Wallet & Gateway Control Plane</p>
    <div class="status-badge">
      <span class="status-dot"></span>
      OPERATIONAL • THRESHOLD MPC
    </div>
    <div class="info-box">
      <div class="info-row">
        <span class="label">Protocol Version</span>
        <span class="value">2024-11-05</span>
      </div>
      <div class="info-row">
        <span class="label">Connector URL</span>
        <span class="value">https://mcp.northveil.xyz/mcp</span>
      </div>
      <div class="info-row">
        <span class="label">OAuth Gateway</span>
        <span class="value">RFC 8414 (S256 PKCE)</span>
      </div>
      <div class="info-row">
        <span class="label">Key Custody</span>
        <span class="value">None (Multi-Party TEE)</span>
      </div>
    </div>
    <p class="footer-note">Add connector in Claude.ai &bull; Authorized via WebAuthn Passkeys</p>
  </div>
</body>
</html>`);
  }

  res.json({
    status: 'ok',
    system: 'Northveil Non-Custodial Control Plane',
    version: '2.0.0',
    protocolVersion: '2024-11-05',
    signing: 'threshold-mpc',
    icon: 'https://iili.io/CDS9fvn.png',
    logo: 'https://iili.io/CDS9fvn.png',
    endpoints: {
      mcp: '/mcp',
      sse: '/sse',
      openapi: '/openapi.json',
      health: '/health',
      deps: '/health/deps',
    },
  });
});

export function getPrimaryMcpUrl(): string {
  return 'https://mcp.northveil.xyz/mcp';
}

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    system: 'Northveil Non-Custodial Control Plane',
    custody: 'none',
    signing: 'threshold_mpc',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/deps', async (_req: Request, res: Response) => {
  try {
    const { error } = await supabase.from('email_otp').select('id').limit(1);
    if (!error) {
      return res.json({ supabase: 'ok' });
    }
    const msg = error.message || '';
    if (/invalid api key/i.test(msg) || /SUPABASE_ADMIN_KEY_INVALID/i.test(msg)) {
      return res.status(503).json({ supabase: 'invalid_api_key' });
    }
    if (/permission denied|row-level security|rls/i.test(msg)) {
      return res.status(503).json({ supabase: 'rls' });
    }
    return res.status(503).json({ supabase: 'down' });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/invalid api key/i.test(msg) || /SUPABASE_ADMIN_KEY_INVALID/i.test(msg)) {
      return res.status(503).json({ supabase: 'invalid_api_key' });
    }
    return res.status(503).json({ supabase: 'down' });
  }
});


// -------------------------------------------------------------
// Canonical MCP & Tool Dispatching (POST /mcp, POST /sse, POST /message)
// -------------------------------------------------------------
export { toolCatalog } from './mcp/toolCatalog.js';
export { handleMcpJsonRpc } from './mcp/handleJsonRpc.js';
export { executeTool } from './tools/dispatch.js';

app.post('/mcp', express.json(), (req: Request, res: Response) => handleMcpJsonRpc(req, res, req.body));
app.post('/sse', express.json(), (req: Request, res: Response) => handleMcpJsonRpc(req, res, req.body));

app.post('/', express.json(), async (req: Request, res: Response, next: NextFunction) => {
  if (req.body && req.body.jsonrpc === '2.0') {
    return handleMcpJsonRpc(req, res, req.body);
  }
  next();
});

app.get('/mcp', async (req: Request, res: Response) => {
  if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
    return handleSseConnection(req, res);
  }
  return res.json({
    status: 'ok',
    system: 'Northveil MCP Streamable HTTP Gateway',
    protocol: 'mcp',
    transport: 'streamable-http',
    version: '2.0.0',
  });
});

// -------------------------------------------------------------
// Server-Sent Events (SSE) Transport (GET /sse & POST /message)
// -------------------------------------------------------------
const sseClients = new Map<string, { res: Response; ctx: any }>();

async function handleSseConnection(req: Request, res: Response) {
  let ctx: any = (req as any).nv;
  if (!ctx) {
    try {
      ctx = await resolveContext(req);
      (req as any).nv = ctx;
    } catch {
      /* stream can open; tools/call later will 401 */
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sseOrigin = req.headers.origin as string | undefined;
  if (sseOrigin && originOk(sseOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', sseOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.flushHeaders();

  const sessionId = 'sse_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  sseClients.set(sessionId, { res, ctx });

  const host = req.get('host') || 'mcp.northveil.xyz';
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const endpointUrl = `${proto}://${host}/message?sessionId=${sessionId}`;

  res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

  req.on('close', () => {
    sseClients.delete(sessionId);
  });
}

app.get('/sse', async (req: Request, res: Response) => {
  try {
    (req as any).nv = await resolveContext(req);
  } catch {
    /* stream can open; tools/call later will 401 */
  }
  return handleSseConnection(req, res);
});

app.post('/message', async (req: Request, res: Response) => {
  const sessionId = String(req.query.sessionId || '');
  const clientEntry = sseClients.get(sessionId);
  const { id, method, params } = req.body || {};

  const send = (payload: unknown) => {
    if (clientEntry?.res) {
      clientEntry.res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    }
    return res.status(202).json({ status: 'accepted' });
  };

  if (method === 'initialize') {
    const requestedVersion = params?.protocolVersion;
    const protocolVersion = ['2024-11-05', '2025-03-26', '2025-06-18'].includes(requestedVersion)
      ? requestedVersion
      : '2025-03-26';

    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'northveil-mcp', version: '2.0.0' },
      },
    });
  }

  if (method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: toolCatalog() } });
  }

  if (method === 'resources/list') {
    return send({ jsonrpc: '2.0', id, result: { resources: [] } });
  }

  if (method === 'ping') {
    return send({ jsonrpc: '2.0', id, result: {} });
  }

  if (method === 'notifications/initialized') {
    return res.status(202).json({ status: 'accepted' });
  }

  if (method === 'tools/call') {
    try {
      let ctx = clientEntry?.ctx;
      if (!ctx) {
        ctx = await resolveContext(req, params?.arguments || {});
      }
      const result = await executeTool(params?.name, params?.arguments || {}, req, ctx);
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] },
      });
    } catch (err: any) {
      const statusCode = err instanceof HttpError ? err.statusCode : (err.status || 500);
      return send({ jsonrpc: '2.0', id, error: { code: statusCode === 401 ? -32001 : -32000, message: err.message } });
    }
  }

  return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});

// -------------------------------------------------------------
// -------------------------------------------------------------
// Passkey Approval Completion (POST /api/approvals/:id/complete)
// -------------------------------------------------------------
async function handleApprovalCompletion(req: Request, res: Response) {
  const approvalId = req.params.id;
  const { assertionResponse, credentialId, payloadHash } = req.body || {};

  try {
    // 1. Fetch ticket (from memory, pending_approvals, or agent_requests)
    const ticket = await getApprovalAsync(approvalId);
    if (!ticket) {
      return res.status(404).json({ error: 'UNKNOWN_APPROVAL' });
    }

    // 2. Direct payloadHash check if provided in body
    if (payloadHash && payloadHash !== ticket.payloadHash) {
      return res.status(400).json({ error: 'PAYLOAD_MISMATCH' });
    }

    // 3. Verify passkey WebAuthn challenge commits to payloadHash
    if (assertionResponse) {
      if (assertionResponse.clientDataJSON) {
        try {
          const clientData = JSON.parse(Buffer.from(assertionResponse.clientDataJSON, 'base64url').toString('utf8'));
          const expectedB64 = Buffer.from(ticket.payloadHash.replace(/^0x/, ''), 'hex').toString('base64url');
          if (clientData.challenge !== expectedB64 && clientData.challenge !== ticket.payloadHash) {
            return res.status(400).json({ error: 'Bad Passkey Assertion' });
          }
        } catch {
          return res.status(400).json({ error: 'Bad Passkey Assertion' });
        }
      } else if (assertionResponse.challenge && assertionResponse.challenge !== ticket.payloadHash) {
        return res.status(400).json({ error: 'Bad Passkey Assertion' });
      }
    }

    // 3b. Verify passkey credential is authorized for this wallet
    const assertion = assertionResponse || req.body?.passkeyAssertion;
    const credId = credentialId || assertion?.id || assertion?.credentialId;
    if (credId) {
      const passkeyRecord = await findPasskeyByCredentialId(credId);
      if (passkeyRecord) {
        const allowedWallets = Array.isArray(passkeyRecord.wallet_ids) ? passkeyRecord.wallet_ids : [];
        if (ticket.walletId && !allowedWallets.includes(ticket.walletId)) {
          return res.status(403).json({
            error: 'UNAUTHORIZED_PASSKEY_FOR_WALLET',
            message: 'This passkey credential is not authorized for the requested wallet.',
          });
        }
      }
    }

    // 4. Consume ticket (enforces single use, expiry, payload hash)
    await consumeApproval(approvalId, ticket.payloadHash);

    // 5. In production, verify passkey WebAuthn assertion signature
    if (process.env.NODE_ENV === 'production' && assertionResponse && credentialId && ticket.userId) {
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
          credentialPublicKey: unpackCredentialPublicKey(passkeyRecord.credential_public_key),
          counter: Number(passkeyRecord.counter),
        },
      });
    }

    // 5b. Verify wallet has an MPC signer bound (Section 4.1: remove 'turnkey_wallet' fallback)
    let boundMpcWalletId: string | undefined;
    const { data: w } = await supabase
      .from('wallets')
      .select('mpc_wallet_id')
      .eq('id', ticket.walletId)
      .maybeSingle();

    if (w?.mpc_wallet_id) {
      boundMpcWalletId = w.mpc_wallet_id;
    } else {
      const reqRec = await loadRequest(approvalId);
      if (reqRec?.mpc_wallet_id) {
        boundMpcWalletId = reqRec.mpc_wallet_id;
      }
    }

    if (!boundMpcWalletId) {
      return res.status(409).json({ error: 'SIGNER_NOT_BOUND' });
    }

    // 6. Insert single-use sign permit only after passkey verification succeeds
    await insertSignPermit(boundMpcWalletId, ticket.payloadHash, 10 * 60 * 1000, approvalId);

    const reqRec = await loadRequest(approvalId);

    // 7. Hosted Northveil must not sign with operator root key
    if (isHosted() || !allowOrgSign()) {
      const signAct = await getMpcProvider().createSignActivity({
        mpcWalletId: boundMpcWalletId,
        unsignedTx: reqRec?.canonical_tx as any || (ticket as any)?.canonicalTx || {},
        payloadHash: ticket.payloadHash,
        approvalEvidence: {
          type: 'passkey',
          approvalId,
        },
      });

      await updateRequest(approvalId, {
        status: 'pending_user_stamp' as any,
      });

      await logAudit({
        userId: ticket.userId || 'anonymous',
        walletAddress: ticket.walletAddress,
        clientId: ticket.clientId,
        action: 'APPROVAL_VERIFIED_PENDING_USER_STAMP',
        details: { approvalId, activityId: signAct.activityId },
      });

      return res.json({
        ok: true,
        requestId: approvalId,
        status: 'pending_user_stamp',
        activityId: signAct.activityId,
        organizationId: signAct.organizationId,
        unsignedTransaction: signAct.unsignedTransaction,
        payloadHash: ticket.payloadHash,
        approveStampUrl: `https://wallet.northveil.xyz/approve/${approvalId}/stamp`,
      });
    }

    // 8. Local dev only with explicit ALLOW_ORG_ROOT_SIGN=1
    await updateRequest(approvalId, { status: 'pending_signature' });
    const out = await signAndAdvance(approvalId, 'passkey');

    await logAudit({
      userId: ticket.userId || 'anonymous',
      walletAddress: ticket.walletAddress,
      clientId: ticket.clientId,
      action: 'APPROVAL_EXECUTED_PASSKEY',
      details: { approvalId, txHash: out.txHash },
    });

    return res.json({
      status: 'success',
      txHash: out.txHash,
      approvalId,
      requestId: approvalId,
    });
  } catch (err: any) {
    if (err.message === 'REPLAY_REJECTED') {
      return res.status(409).json({ error: 'REPLAY_REJECTED', message: 'Ticket has already been used' });
    }
    if (err.message === 'APPROVAL_EXPIRED') {
      return res.status(410).json({ error: 'APPROVAL_EXPIRED', message: 'Approval ticket has expired' });
    }
    if (err.message === 'UNKNOWN_APPROVAL') {
      return res.status(404).json({ error: 'UNKNOWN_APPROVAL', message: 'Approval ticket not found' });
    }
    if (err.message === 'PAYLOAD_MISMATCH') {
      return res.status(400).json({ error: 'PAYLOAD_MISMATCH', message: 'Payload hash does not match canonical transaction' });
    }
    if (err.message === 'NO_SIGN_PERMIT') {
      return res.status(403).json({ error: 'NO_SIGN_PERMIT', message: 'No valid sign permit found for payload' });
    }
    if (err.message === 'SIGNER_NOT_BOUND') {
      return res.status(409).json({ error: 'SIGNER_NOT_BOUND', message: 'No MPC signer bound to wallet' });
    }
    if (err.message === 'OTP_EXPIRED') {
      return res.status(410).json({ error: 'OTP_EXPIRED', message: 'Email OTP code has expired' });
    }
    if (err.message === 'WALLET_NOT_IN_GRANT') {
      return res.status(403).json({ error: 'WALLET_NOT_IN_GRANT', message: 'Wallet is not authorized under the active agent grant' });
    }
    if (err.message === 'RAW_MATERIAL_FORBIDDEN') {
      return res.status(400).json({ error: 'RAW_MATERIAL_FORBIDDEN', message: 'Raw private key or mnemonic material is forbidden' });
    }
    return res.status(400).json({ error: err.message || 'Approval execution failed', message: err.message || 'Approval execution failed' });
  }
}

app.post(['/api/approvals/:id/complete', '/wallet/approvals/:id/complete', '/api/v1/dashboard/approvals/:id/approve'], handleApprovalCompletion);

// -------------------------------------------------------------
// Request Lifecycle Inspection (GET /wallet/requests/:id)
// -------------------------------------------------------------
app.get('/wallet/requests/:id', async (req: Request, res: Response) => {
  try {
    const record = await loadRequest(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
    }

    const session = getSession(req);
    if (session && record.user_id && session.userId !== record.user_id) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    return res.json({
      requestId: record.id,
      tool: record.tool,
      status: record.status,
      to: record.intent?.to,
      amount: record.intent?.amount,
      chain: record.intent?.chain || record.intent?.network,
      walletAddress: record.canonical_tx?.from,
      walletId: record.wallet_id,
      payloadHash: record.payload_hash,
      approveUrl: record.approve_url,
      stampUrl: record.status === 'pending_user_stamp' ? `https://wallet.northveil.xyz/approve/${record.id}/stamp` : undefined,
      txHash: record.tx_hash,
      error: record.error,
      expiresAt: record.expires_at,
      createdAt: record.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /wallet/requests/:id/stamp-payload - returns unsigned tx and activity info for client stamping
app.get('/wallet/requests/:id/stamp-payload', async (req: Request, res: Response) => {
  const row = await loadRequest(req.params.id);
  if (!row) return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  const organizationId = process.env.TURNKEY_ORGANIZATION_ID || 'turnkey_org_default';
  let unsignedTx = '0x';
  if (row.canonical_tx) {
    try {
      const { ethers } = await import('ethers');
      unsignedTx = ethers.Transaction.from({
        to: row.canonical_tx.to,
        value: BigInt(row.canonical_tx.value || '0'),
        data: row.canonical_tx.data || '0x',
        chainId: row.canonical_tx.chainId || 8453,
        nonce: row.canonical_tx.nonce || 0,
        gasLimit: row.canonical_tx.gasLimit ? BigInt(row.canonical_tx.gasLimit) : 21000n,
        maxFeePerGas: row.canonical_tx.maxFeePerGas ? BigInt(row.canonical_tx.maxFeePerGas) : 1000000000n,
        maxPriorityFeePerGas: row.canonical_tx.maxPriorityFeePerGas ? BigInt(row.canonical_tx.maxPriorityFeePerGas) : 1000000000n,
        type: 2,
      }).unsignedSerialized;
    } catch {}
  }
  return res.json({
    activityId: (row as any).turnkey_activity_id || `act_${row.id}`,
    unsignedTransaction: (row as any).unsigned_transaction || unsignedTx,
    organizationId,
    payloadHash: row.payload_hash,
  });
});

// POST /wallet/turnkey/stamp - return stamp payload for activityId or requestId
app.post('/wallet/turnkey/stamp', async (req: Request, res: Response) => {
  const { activityId, requestId } = req.body || {};
  const id = requestId || activityId;
  const row = await loadRequest(id);
  if (!row) return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  const organizationId = process.env.TURNKEY_ORGANIZATION_ID || 'turnkey_org_default';
  let unsignedTx = '0x';
  if (row.canonical_tx) {
    try {
      const { ethers } = await import('ethers');
      unsignedTx = ethers.Transaction.from({
        to: row.canonical_tx.to,
        value: BigInt(row.canonical_tx.value || '0'),
        data: row.canonical_tx.data || '0x',
        chainId: row.canonical_tx.chainId || 8453,
        nonce: row.canonical_tx.nonce || 0,
        gasLimit: row.canonical_tx.gasLimit ? BigInt(row.canonical_tx.gasLimit) : 21000n,
        maxFeePerGas: row.canonical_tx.maxFeePerGas ? BigInt(row.canonical_tx.maxFeePerGas) : 1000000000n,
        maxPriorityFeePerGas: row.canonical_tx.maxPriorityFeePerGas ? BigInt(row.canonical_tx.maxPriorityFeePerGas) : 1000000000n,
        type: 2,
      }).unsignedSerialized;
    } catch {}
  }
  return res.json({
    ok: true,
    activityId: activityId || (row as any).turnkey_activity_id || `act_${row.id}`,
    requestId: row.id,
    organizationId,
    unsignedTransaction: (row as any).unsigned_transaction || unsignedTx,
    payloadHash: row.payload_hash,
  });
});

// POST /wallet/requests/:id/stamp-complete - user stamped activity submission and broadcast
app.post(['/wallet/requests/:id/stamp-complete', '/api/approvals/:id/stamp-complete', '/wallet/approvals/:id/stamp-complete'], requireSession, async (req: Request, res: Response) => {
  const row = await loadRequest(req.params.id);
  if (!row) return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  if (row.user_id && req.session?.userId && row.user_id !== req.session.userId) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  await assertSignPermit(row.id);
  const chainId = row.canonical_tx?.chainId || (row as any).chain_id || 8453;
  const { signedTransaction } = await getMpcProvider().submitStampedActivity({
    activityId: req.body?.activityId || (row as any).turnkey_activity_id || `act_${row.id}`,
    stampedRequest: req.body?.stampedRequest || req.body,
  });
  const { txHash } = await getMpcProvider().broadcastSignedTx(chainId, signedTransaction);
  await updateRequest(row.id, { status: 'broadcast' as any, tx_hash: txHash });
  return res.json({ ok: true, txHash, status: 'broadcast' });
});

// -------------------------------------------------------------
// Live Wallet & Session Endpoints
// -------------------------------------------------------------

// GET /wallet/portfolio - multi-chain balance rollup for user's wallet
app.get('/wallet/portfolio', requireSession, async (req: Request, res: Response) => {
  if (!req.session?.wallet?.address) {
    return res.json({ address: null, assets: [], totalUsdValue: 0 });
  }

  const address = req.session.wallet.address;
  try {
    const balances = await getBalances(address, 'all');
    let totalUsdValue = 0;

    const assets = await Promise.all(
      balances.map(async (b) => {
        const priceData = await getTokenPrice(b.native.symbol);
        const priceUsd = priceData.priceUsd || 0;
        const balanceNum = parseFloat(b.native.balanceFormatted) || 0;
        const valueUsd = balanceNum * priceUsd;
        totalUsdValue += valueUsd;

        return {
          id: `${b.chain}-native`,
          symbol: b.native.symbol,
          name: b.native.name,
          network: b.chain,
          balance: balanceNum,
          priceUsd,
          valueUsd,
          icon: (SUPPORTED_CHAINS as any)[b.chain]?.icon || '',
          explorerUrl: (SUPPORTED_CHAINS as any)[b.chain]?.explorerUrl || '',
        };
      })
    );

    res.json({
      address,
      assets,
      totalUsdValue,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'PORTFOLIO_QUERY_FAILED', message: err.message });
  }
});

// GET /wallet/history - real on-chain indexer txs + MCP audit logs
app.get('/wallet/history', requireSession, async (req: Request, res: Response) => {
  if (!req.session?.wallet?.address) {
    return res.json({ address: null, items: [] });
  }

  const chain = (req.query.chain as string) || 'base';
  const history = await getTxHistory(req.session.wallet.address, chain);
  res.json(history);
});

// GET /wallet/approvals - pending approvals or history
app.get('/wallet/approvals', requireSession, async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const userId = req.session!.userId;

  if (status === 'pending') {
    const { data } = await supabase
      .from('pending_approvals')
      .select('*')
      .eq('user_id', userId)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    return res.json(data ?? []);
  }

  const { data: usedApprovals } = await supabase
    .from('pending_approvals')
    .select('*')
    .eq('user_id', userId)
    .eq('used', true)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: auditLogs } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  res.json({
    approvals: usedApprovals ?? [],
    auditLogs: auditLogs ?? [],
  });
});

// POST /wallet/agent-clients - issue client key and default grant
app.post('/wallet/agent-clients', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId;
  const name = req.body?.name || 'Claude Desktop';
  const { rawOnce, hash } = await issueClientKey();

  const { data: client, error: clientErr } = await supabase
    .from('agent_clients')
    .insert({
      user_id: userId,
      name,
      client_key_hash: hash,
      status: 'active',
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
    })
    .select('*')
    .single();

  if (clientErr || !client) {
    return res.status(500).json({ error: 'FAILED_TO_CREATE_AGENT_CLIENT', details: clientErr?.message });
  }

  await supabase
    .from('grants')
    .insert({
      client_id: client.id,
      user_id: userId,
      wallet_ids: req.session!.wallet?.id ? [req.session!.wallet.id] : [],
      mode: 'always_ask',
      chains: ['base', 'ethereum', 'arbitrum', 'polygon', 'solana'],
      allowed_assets: ['*'],
      allowed_recipients: [],
      allow_any_recipient: false,
      max_wei_per_tx: '100000000000000000',
      max_wei_per_day: '1000000000000000000',
    });

  await logAudit({
    userId,
    clientId: client.id,
    action: 'AGENT_KEY_ISSUED',
    details: { name, clientId: client.id },
  });

  return res.json({
    clientId: client.id,
    rawOnce,
    name: client.name,
    status: client.status,
    mode: 'always_ask',
  });
});

// PATCH /wallet/agent-clients/:id - pause or revoke agent key
app.patch('/wallet/agent-clients/:id', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId;
  const clientId = req.params.id;
  const { status } = req.body;

  if (!['active', 'paused', 'revoked'].includes(status)) {
    return res.status(400).json({ error: 'INVALID_STATUS' });
  }

  const { data, error } = await supabase
    .from('agent_clients')
    .update({ status })
    .eq('id', clientId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    return res.status(500).json({ error: 'UPDATE_FAILED', details: error.message });
  }

  return res.json({ success: true, client: data });
});

// PATCH /wallet/grants/:id - update grant mode / velocity limits
app.patch('/wallet/grants/:id', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId;
  const grantId = req.params.id;
  const { mode, maxWeiPerTx, maxWeiPerDay, allowedRecipients, allowAnyRecipient } = req.body;

  const updates: any = { updated_at: new Date().toISOString() };
  if (mode && ['always_ask', 'autonomous'].includes(mode)) updates.mode = mode;
  if (maxWeiPerTx) updates.max_wei_per_tx = String(maxWeiPerTx);
  if (maxWeiPerDay) updates.max_wei_per_day = String(maxWeiPerDay);
  if (allowedRecipients) updates.allowed_recipients = allowedRecipients;
  if (allowAnyRecipient !== undefined) updates.allow_any_recipient = Boolean(allowAnyRecipient);

  const { data, error } = await supabase
    .from('grants')
    .update(updates)
    .eq('id', grantId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    return res.status(500).json({ error: 'UPDATE_GRANT_FAILED', details: error.message });
  }

  return res.json({ success: true, grant: data });
});

// -------------------------------------------------------------
// Google OAuth Endpoints (Vite SPA Backend)
// -------------------------------------------------------------
export function walletRedirect(origin: string, q: Record<string, string>): string {
  const u = new URL('/', origin);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.toString();
}

function getGoogleCallbackUrl(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const host = req.get('host') || 'mcp.northveil.xyz';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
  const proto = isLocal ? req.protocol : 'https';
  return `${proto}://${host}/auth/google/callback`;
}

app.get('/auth/google', (req: Request, res: Response) => {
  const query = new URLSearchParams(req.query as any).toString();
  return res.redirect(`/auth/google/start${query ? `?${query}` : ''}`);
});

app.get('/auth/google/start', (req: Request, res: Response) => {
  const redirect = (req.query.redirect as string) || 'https://wallet.northveil.xyz/';
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const callbackUrl = getGoogleCallbackUrl(req);

  if (!clientId) {
    try {
      return res.redirect(walletRedirect(redirect, { error: 'GOOGLE_CLIENT_ID_NOT_CONFIGURED' }));
    } catch {}
    return res.status(500).json({
      error: 'GOOGLE_CLIENT_ID_NOT_CONFIGURED',
      message: 'Google OAuth Client ID is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Vercel environment variables.',
      authorizedRedirectUri: callbackUrl,
    });
  }

  const state = Buffer.from(JSON.stringify({ redirect, nonce: crypto.randomBytes(16).toString('hex') })).toString('base64url');
  const scope = encodeURIComponent('openid email profile');
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scope}&state=${state}&prompt=consent&access_type=offline`;

  res.redirect(googleAuthUrl);
});

app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const stateRaw = req.query.state as string;

  let redirectTarget = 'https://wallet.northveil.xyz/';
  if (stateRaw) {
    try {
      const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
      if (parsed.redirect) redirectTarget = parsed.redirect;
    } catch {}
  }

  if (!code) {
    return res.redirect(walletRedirect(redirectTarget, { error: 'OAUTH_CODE_MISSING' }));
  }

  try {
    const callbackUrl = getGoogleCallbackUrl(req);
    const userInfo = await exchangeGoogleCode(code, '', callbackUrl);
    const user = await upsertGoogleUser(userInfo);
    const sessionToken = signSessionToken({ userId: user.id, email: user.email, passkeyOk: false });
    const isProd = isHosted();
    res.cookie('nv_session', sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 72 * 3600 * 1000,
      domain: isProd ? '.northveil.xyz' : undefined,
    });

    return res.redirect(walletRedirect(redirectTarget, { sessionToken }));
  } catch (err: any) {
    console.error('[Northveil] Google OAuth callback error:', err);
    const msg = String(err?.message || err || '');
    if (/invalid api key/i.test(msg) || /SUPABASE_ADMIN_KEY_INVALID/i.test(msg)) {
      return res.redirect(walletRedirect(redirectTarget, { error: 'AUTH_DB_MISCONFIGURED' }));
    }
    return res.redirect(walletRedirect(redirectTarget, { error: 'AUTH_FAILED' }));
  }
});

// -------------------------------------------------------------
// Email OTP Endpoints (5-minute TTL, Rate-Limited, Single-Use)
// -------------------------------------------------------------
app.post('/auth/email/start', async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress;
    const result = await startEmailOtp(email, clientIp);
    return res.json(result);
  } catch (err: any) {
    const status = err.statusCode || err.status || 400;
    const errCode = err.code || err.message || 'OTP_START_FAILED';
    return res.status(status).json({ error: errCode, message: err.message });
  }
});

app.post('/auth/email/verify', async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body || {};
    const result = await verifyEmailOtp(email, code);
    const isProd = isHosted();
    res.cookie('nv_session', result.sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 72 * 3600 * 1000,
      domain: isProd ? '.northveil.xyz' : undefined,
    });
    return res.json(result);
  } catch (err: any) {
    const status = err.statusCode || err.status || 400;
    const errCode = err.code || err.message || 'OTP_VERIFY_FAILED';
    return res.status(status).json({ error: errCode, message: err.message });
  }
});


// -------------------------------------------------------------
// WebAuthn Passkey Registration & Login Endpoints
// -------------------------------------------------------------
app.post('/auth/passkey/register/begin', async (req: Request, res: Response) => {
  const session = getSession(req);
  const userId = session?.userId || req.body?.userId;
  const userName = session?.email || req.body?.userName || 'user';
  if (!userId) {
    return res.status(401).json({ error: 'SESSION_REQUIRED' });
  }
  try {
    const clientHostname = req.body?.hostname || (req.headers.origin ? new URL(req.headers.origin as string).hostname : req.hostname);
    console.log(`[Northveil] register/begin rp.id: ${getRpId(clientHostname)}, Origin: ${req.headers.origin}`);
    const options = await generatePasskeyRegistrationOptions({
      userId,
      userName,
      hostname: clientHostname,
      rpID: req.body?.rpID,
    });

    const isProd = isHosted();
    const domain = isProd ? '.northveil.xyz' : undefined;
    if (options.challengeToken) {
      res.cookie('nv_challenge', options.challengeToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        domain,
        maxAge: 5 * 60 * 1000,
      });
    }

    return res.json({ ...options, options });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/auth/passkey/register/finish', async (req: Request, res: Response) => {
  const session = getSession(req);
  const userId = session?.userId || req.body?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'SESSION_REQUIRED' });
  }

  let cred: any;
  try {
    cred = asWebAuthnCredentialJSON(req.body);
  } catch (err: any) {
    return res.status(400).json({ error: 'PASSKEY_RESPONSE_MALFORMED', message: err.message });
  }

  let rawChallenge: string | undefined;
  if (cred?.response?.clientDataJSON) {
    try {
      rawChallenge = JSON.parse(Buffer.from(cred.response.clientDataJSON, 'base64url').toString('utf8')).challenge;
    } catch {}
  }

  const cookieMatch = req.headers.cookie?.match(/nv_challenge=([^;]+)/);
  const rawToken = req.body?.challengeToken || (cookieMatch ? cookieMatch[1] : undefined);
  const tokenVerified = rawToken ? verifyChallengeToken(rawToken) : null;

  const candidateChallenge = req.body?.challenge || tokenVerified?.challenge || rawChallenge;

  let challenge = await consumeWebauthnChallenge({ userId, kind: 'reg', challenge: candidateChallenge });
  if (!challenge && tokenVerified?.challenge) {
    if (!rawChallenge || rawChallenge === tokenVerified.challenge) {
      challenge = tokenVerified.challenge;
    }
  }

  if (!challenge) {
    return res.status(400).json({ error: 'CHALLENGE_EXPIRED_OR_NOT_FOUND' });
  }

  const isProd = isHosted();
  res.clearCookie('nv_challenge', {
    path: '/',
    domain: isProd ? '.northveil.xyz' : undefined,
  });

  try {
    const clientHostname = req.body?.hostname || (req.headers.origin ? new URL(req.headers.origin as string).hostname : req.hostname);
    const verified = await verifyPasskeyRegistration({
      response: cred,
      expectedChallenge: challenge,
      origin: req.headers.origin as string,
      hostname: clientHostname,
    });

    // Query existing wallets to link to this passkey credential
    const { data: userWallets } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active');
    const existingWalletIds = (userWallets || []).map((w: any) => w.id);

    await savePasskeyRecord({
      userId,
      credentialId: verified.credentialId,
      credentialPublicKey: verified.credentialPublicKey,
      counter: verified.counter,
      transports: req.body?.response?.transports || cred?.response?.transports,
      walletIds: existingWalletIds,
    });
    return res.json({ success: true, credentialId: verified.credentialId });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'PASSKEY_REGISTRATION_FAILED' });
  }
});

app.post('/auth/passkey/login/begin', async (req: Request, res: Response) => {
  try {
    const clientHostname = req.body?.hostname || (req.headers.origin ? new URL(req.headers.origin as string).hostname : req.hostname);
    const options = await generatePasskeyLoginOptions({
      userId: req.body?.userId,
      hostname: clientHostname,
      rpID: req.body?.rpID,
    });

    const isProd = isHosted();
    const domain = isProd ? '.northveil.xyz' : undefined;
    if (options.challengeToken) {
      res.cookie('nv_challenge', options.challengeToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        domain,
        maxAge: 5 * 60 * 1000,
      });
    }

    return res.json({ ...options, options });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/auth/passkey/login/finish', async (req: Request, res: Response) => {
  let cred: any;
  try {
    cred = asWebAuthnCredentialJSON(req.body);
  } catch (err: any) {
    return res.status(400).json({ error: 'PASSKEY_RESPONSE_MALFORMED', message: err.message });
  }

  const { credentialId, challenge, challengeToken: bodyChallengeToken } = req.body || {};
  const credId = credentialId || cred?.id;
  if (!credId) {
    return res.status(400).json({ error: 'CREDENTIAL_ID_REQUIRED' });
  }
  const passkey = await findPasskeyByCredentialId(credId);
  if (!passkey) {
    return res.status(404).json({ error: 'PASSKEY_NOT_FOUND' });
  }

  let rawChallenge: string | undefined;
  if (cred?.response?.clientDataJSON) {
    try {
      rawChallenge = JSON.parse(Buffer.from(cred.response.clientDataJSON, 'base64url').toString('utf8')).challenge;
    } catch {}
  }

  const cookieMatch = req.headers.cookie?.match(/nv_challenge=([^;]+)/);
  const rawToken = bodyChallengeToken || (cookieMatch ? cookieMatch[1] : undefined);
  const tokenVerified = rawToken ? verifyChallengeToken(rawToken) : null;

  const candidateChallenge = challenge || tokenVerified?.challenge || rawChallenge;

  let expectedChallenge: string | null = null;
  if (candidateChallenge) {
    const consumed = await consumeWebauthnChallenge({
      userId: passkey.user_id,
      kind: 'auth',
      challenge: candidateChallenge,
    });
    if (consumed) {
      expectedChallenge = consumed;
    }
  }

  if (!expectedChallenge && tokenVerified?.challenge) {
    if (!rawChallenge || rawChallenge === tokenVerified.challenge) {
      expectedChallenge = tokenVerified.challenge;
    }
  }

  if (!expectedChallenge && rawChallenge) {
    const fallbackConsumed = await consumeWebauthnChallenge({
      kind: 'auth',
      challenge: rawChallenge,
    });
    if (fallbackConsumed) {
      expectedChallenge = fallbackConsumed;
    }
  }

  if (!expectedChallenge) {
    return res.status(400).json({
      error: 'CHALLENGE_EXPIRED_OR_NOT_FOUND',
      message: 'Authentication challenge expired or not found. Please click Unlock Vault with Passkey to try again.',
    });
  }

  try {
    const clientHostname = req.body?.hostname || (req.headers.origin ? new URL(req.headers.origin as string).hostname : req.hostname);
    await verifyPasskeyLogin({
      response: cred,
      expectedChallenge,
      storedAuthenticator: {
        credentialID: Buffer.from(passkey.credential_id, 'base64url'),
        credentialPublicKey: passkey.credential_public_key,
        counter: passkey.counter,
      },
      origin: req.headers.origin as string,
      hostname: clientHostname,
    });

    const isProd = isHosted();
    res.clearCookie('nv_challenge', {
      path: '/',
      domain: isProd ? '.northveil.xyz' : undefined,
    });

    const { data: user } = await supabase.from('users').select('*').eq('id', passkey.user_id).maybeSingle();
    const { data: wallets } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', passkey.user_id)
      .eq('status', 'active')
      .order('is_primary', { ascending: false });

    const wallet = wallets?.[0];

    // Session elevated with passkeyOk: true
    const sessionToken = signSessionToken({ userId: passkey.user_id, email: user?.email || '', passkeyOk: true });
    res.cookie('nv_session', sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      domain: isProd ? '.northveil.xyz' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      sessionToken,
      user: user
        ? { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url }
        : { id: passkey.user_id },
      wallet: wallet
        ? { id: wallet.id, name: wallet.name, address: wallet.address, chainFamily: wallet.chain_family, mpcWalletId: wallet.mpc_wallet_id, is_primary: wallet.is_primary }
        : null,
      wallets: (wallets || []).map((w: any) => ({
        id: w.id,
        name: w.name,
        address: w.address,
        chainFamily: w.chain_family,
        mpcWalletId: w.mpc_wallet_id,
        is_primary: w.is_primary,
        status: w.status,
      })),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'PASSKEY_LOGIN_FAILED' });
  }
});

// POST /wallet/create - provisions Turnkey MPC wallet and inserts into wallets table
app.post('/wallet/create', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId;
  try {
    const { count } = await supabase
      .from('wallets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');
    const isPrimary = (count === 0);

    const mpc = getMpcProvider();
    const created = await mpc.createWallet(userId);

    const { data: inserted, error } = await supabase
      .from('wallets')
      .insert({
        user_id: userId,
        name: req.body?.name || (isPrimary ? 'Primary Vault' : 'Secondary Vault'),
        is_primary: isPrimary,
        address: created.address.toLowerCase(),
        chain_family: 'evm',
        mpc_provider: 'turnkey',
        mpc_wallet_id: created.mpcWalletId,
        status: 'active',
      })
      .select('*')
      .single();

    if (error) throw error;

    // Link passkey to wallet: append wallet.id to passkeys.wallet_ids for this user
    try {
      const { data: userPasskeys } = await supabase
        .from('passkeys')
        .select('id, wallet_ids')
        .eq('user_id', userId);
      if (userPasskeys && userPasskeys.length > 0) {
        for (const pk of userPasskeys) {
          const currentIds = Array.isArray(pk.wallet_ids) ? pk.wallet_ids : [];
          if (!currentIds.includes(inserted.id)) {
            await supabase
              .from('passkeys')
              .update({ wallet_ids: [...currentIds, inserted.id] })
              .eq('id', pk.id);
          }
        }
      }
    } catch (linkErr: any) {
      console.warn('[Northveil] Error linking wallet to passkeys:', linkErr.message);
    }

    return res.status(201).json({
      address: inserted.address,
      id: inserted.id,
      mpcWalletId: inserted.mpc_wallet_id,
      wallet: inserted,
    });
  } catch (err: any) {
    console.error('[Northveil] /wallet/create error:', err);
    return res.status(500).json({ error: err.message || 'WALLET_CREATION_FAILED' });
  }
});

// POST /wallet/import/begin - Enclave import begin (returns Turnkey importBundle TEK public)
app.post('/wallet/import/begin', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId;
  try {
    const mpc = getMpcProvider();
    if (typeof mpc.importBegin !== 'function') {
      return res.status(501).json({ error: 'IMPORT_NOT_SUPPORTED', message: 'Signer provider does not support importBegin' });
    }
    const result = await mpc.importBegin(userId);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'IMPORT_BEGIN_FAILED' });
  }
});

// POST /wallet/import/finish - Enclave import finish (receives encryptedBundle only. Server never sees mnemonic)
app.post('/wallet/import/finish', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId;
  const { encryptedBundle, name, mnemonic, privateKey } = req.body || {};

  if (mnemonic || privateKey) {
    return res.status(400).json({
      error: 'RAW_MATERIAL_FORBIDDEN',
      message: 'Plaintext key material must never touch the server. Use in-browser encryption to Turnkey TEK.',
    });
  }

  if (!encryptedBundle || typeof encryptedBundle !== 'string') {
    return res.status(400).json({ error: 'ENCRYPTED_BUNDLE_REQUIRED' });
  }

  try {
    const imported = await importFinishOrAttach(userId, { encryptedBundle, name });

    const { count } = await supabase
      .from('wallets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');
    const isPrimary = (count === 0);

    const { data: inserted, error } = await supabase
      .from('wallets')
      .upsert({
        user_id: userId,
        name: name || (isPrimary ? 'Primary Vault' : 'Imported Vault'),
        is_primary: isPrimary,
        address: imported.address.toLowerCase(),
        chain_family: 'evm',
        mpc_provider: 'turnkey',
        mpc_wallet_id: imported.mpcWalletId,
        status: 'active',
      }, { onConflict: 'mpc_wallet_id' })
      .select('*')
      .single();

    if (error) {
      const msg = String(error.message || error);
      if (/invalid api key/i.test(msg) || /SUPABASE_ADMIN_KEY_INVALID/i.test(msg)) {
        return res.status(503).json({ error: 'AUTH_DB_MISCONFIGURED', message: 'Northveil auth database is misconfigured. Try again in a minute.' });
      }
      throw error;
    }

    // Link passkey to wallet: append wallet.id to passkeys.wallet_ids for this user
    try {
      const { data: userPasskeys } = await supabase
        .from('passkeys')
        .select('id, wallet_ids')
        .eq('user_id', userId);
      if (userPasskeys && userPasskeys.length > 0) {
        for (const pk of userPasskeys) {
          const currentIds = Array.isArray(pk.wallet_ids) ? pk.wallet_ids : [];
          if (!currentIds.includes(inserted.id)) {
            await supabase
              .from('passkeys')
              .update({ wallet_ids: [...currentIds, inserted.id] })
              .eq('id', pk.id);
          }
        }
      }
    } catch (linkErr: any) {
      console.warn('[Northveil] Error linking wallet to passkeys:', linkErr.message);
    }

    return res.status(201).json({
      address: inserted.address,
      id: inserted.id,
      mpcWalletId: inserted.mpc_wallet_id,
      wallet: inserted,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/invalid api key/i.test(msg) || /SUPABASE_ADMIN_KEY_INVALID/i.test(msg)) {
      return res.status(503).json({ error: 'AUTH_DB_MISCONFIGURED', message: 'Northveil auth database is misconfigured. Try again in a minute.' });
    }
    return res.status(500).json({ error: err.message || 'IMPORT_FINISH_FAILED' });
  }
});

// POST /wallet/import - Direct plaintext key material import is strictly forbidden
app.post('/wallet/import', (req: Request, res: Response) => {
  if (req.body?.mnemonic || req.body?.privateKey || req.body?.seed) {
    return res.status(400).json({
      error: 'RAW_MATERIAL_FORBIDDEN',
      message: 'Use POST /wallet/import/begin then /wallet/import/finish with encryptedBundle only',
    });
  }
  return res.status(400).json({ error: 'USE_BEGIN_FINISH' });
});

// GET /wallet/me - canonical authenticated user profile, active wallets, passkeys count, and next onboarding state
app.get('/wallet/me', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId;
  try {
    let user = req.session!.user;
    const { data: dbUser } = await supabase
      .from('users')
      .select('id, email, name, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (dbUser) {
      user = { id: dbUser.id, email: dbUser.email, name: dbUser.name, avatarUrl: dbUser.avatar_url };
    }

    let { data: wallets, error: walletsErr } = await supabase
      .from('wallets')
      .select('id, name, address, chain_family, mpc_wallet_id, is_primary, status')
      .eq('user_id', user.id)
      .in('status', ['active', 'imported', 'ready'])
      .order('is_primary', { ascending: false });

    if (walletsErr) {
      const msg = String(walletsErr.message || walletsErr);
      if (/invalid api key/i.test(msg) || /SUPABASE_ADMIN_KEY_INVALID/i.test(msg)) {
        return res.status(503).json({ error: 'AUTH_DB_MISCONFIGURED', message: 'Northveil auth database is misconfigured. Try again in a minute.' });
      }
      throw walletsErr;
    }

    let safeWallets = wallets ?? [];

    // Also attach orphans:
    // If Turnkey org already has a wallet created/imported for this user and Postgres has zero rows,
    // call attachExistingTurnkeyWallet(userId) once and insert the row.
    if (safeWallets.length === 0) {
      try {
        const attached = await attachExistingTurnkeyWallet(user.id);
        if (attached) {
          const { data: inserted, error: insErr } = await supabase
            .from('wallets')
            .upsert({
              user_id: user.id,
              name: 'Primary Vault',
              address: attached.address.toLowerCase(),
              chain_family: 'evm',
              mpc_provider: 'turnkey',
              mpc_wallet_id: attached.mpcWalletId,
              status: 'active',
              is_primary: true,
            }, { onConflict: 'mpc_wallet_id' })
            .select('id, name, address, chain_family, mpc_wallet_id, is_primary, status')
            .single();
          if (!insErr && inserted) {
            safeWallets = [inserted];
          }
        }
      } catch (attachErr: any) {
        console.warn('[Northveil] attachExistingTurnkeyWallet in /wallet/me notice:', attachErr?.message);
      }
    }

    const { count: passkeyCount, error: pkErr } = await supabase
      .from('passkeys')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (pkErr) {
      const msg = String(pkErr.message || pkErr);
      if (/invalid api key/i.test(msg) || /SUPABASE_ADMIN_KEY_INVALID/i.test(msg)) {
        return res.status(503).json({ error: 'AUTH_DB_MISCONFIGURED', message: 'Northveil auth database is misconfigured. Try again in a minute.' });
      }
    }

    const safePasskeyCount = passkeyCount ?? 0;

    const next =
      safeWallets.length === 0 && safePasskeyCount === 0 ? 'enroll_passkey' :
      safeWallets.length === 0 ? 'create_or_import' :
      safePasskeyCount === 0 ? 'enroll_passkey' :
      req.session?.passkeyOk ? 'dashboard' :
      'unlock_passkey';

    return res.json({
      user: { id: user.id, email: user.email },
      wallets: safeWallets,
      passkeyCount: safePasskeyCount,
      passkeyOk: Boolean(req.session?.passkeyOk),
      next,
      wallet: safeWallets[0] || null,
      authenticated: true,
    });
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (/invalid api key/i.test(msg) || /SUPABASE_ADMIN_KEY_INVALID/i.test(msg)) {
      return res.status(503).json({ error: 'AUTH_DB_MISCONFIGURED', message: 'Northveil auth database is misconfigured. Try again in a minute.' });
    }
    return res.status(500).json({ error: err.message || 'INTERNAL_ERROR' });
  }
});


// GET pending approvals for wallet or user
app.get(['/wallet/approvals/pending', '/api/v1/dashboard/approvals/pending'], async (req: Request, res: Response) => {
  const session = getSession(req);
  const userId = session?.userId || (req.query.userId as string);
  const walletAddress = (req.query.walletAddress as string) || (req.headers['x-wallet-address'] as string);

  try {
    let query = supabase.from('pending_approvals').select('*').eq('used', false);
    if (userId) {
      query = query.eq('user_id', userId);
    } else if (walletAddress) {
      const { data: w } = await supabase.from('wallets').select('id').eq('address', walletAddress.toLowerCase()).maybeSingle();
      if (w) {
        query = query.eq('wallet_id', w.id);
      }
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ success: true, pendingApprovals: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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
      'x-logo': {
        url: 'https://iili.io/CDS9fvn.png',
      },
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

// Global structured error-handling middleware for lifecycle & security errors
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  const errorMap: Record<string, { status: number; message: string }> = {
    NO_SIGN_PERMIT: { status: 403, message: 'No valid sign permit found for payload' },
    SIGNER_NOT_BOUND: { status: 409, message: 'No MPC signer bound to wallet' },
    OTP_EXPIRED: { status: 410, message: 'Email OTP code has expired' },
    WALLET_NOT_IN_GRANT: { status: 403, message: 'Wallet is not authorized under the active agent grant' },
    RAW_MATERIAL_FORBIDDEN: { status: 400, message: 'Raw private key or mnemonic material is forbidden' },
    APPROVAL_EXPIRED: { status: 410, message: 'Approval ticket has expired' },
    REPLAY_REJECTED: { status: 409, message: 'Ticket has already been used' },
    UNKNOWN_APPROVAL: { status: 404, message: 'Approval ticket not found' },
    PAYLOAD_MISMATCH: { status: 400, message: 'Payload hash does not match canonical transaction' },
  };

  const key = err.message || err.error;
  if (key && errorMap[key]) {
    return res.status(errorMap[key].status).json({
      error: key,
      message: errorMap[key].message,
    });
  }

  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    error: err.name || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
  });
});

export default app;
