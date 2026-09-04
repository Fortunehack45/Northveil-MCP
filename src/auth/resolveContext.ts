import { createHash } from 'node:crypto';
import { Request } from 'express';
import { supabase } from '../supabase.js';
import { verifyClientKey } from './agentClient.js';
import { verifySessionToken } from './session.js';
import { Grant, Mode } from '../policy/grantEngine.js';

export interface ToolWallet {
  id: string;
  address: string;
  chainFamily: string;
  mpcWalletId: string;
}

export interface ToolContext {
  userId: string;
  clientId: string;
  grant: Grant;
  wallet: ToolWallet;
}

export class HttpError extends Error {
  status: number;
  statusCode: number;
  code: string;
  wwwAuthenticate?: boolean;

  constructor(status: number, code: string, message?: string, wwwAuthenticate = false) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

export function http(status: number, code: string, message?: string, wwwAuthenticate = false): HttpError {
  return new HttpError(status, code, message || code, wwwAuthenticate);
}

// In-memory registries for testing and offline execution
export const mockClientsRegistry = new Map<string, {
  id: string;
  userId: string;
  keyHash: string;
  status: 'active' | 'paused' | 'revoked';
  expiresAt: Date;
}>();

export const mockGrantsRegistry = new Map<string, {
  id: string;
  clientId: string;
  userId: string;
  walletIds: string[];
  mode: Mode;
  chains: string[];
  allowedAssets: string[];
  allowedRecipients: string[] | '*';
  maxWeiPerTx: bigint;
  maxWeiPerDay: bigint;
  expiresAt: Date;
  revoked: boolean;
}>();

export const mockWalletsRegistry = new Map<string, {
  id: string;
  userId: string;
  address: string;
  chainFamily: string;
  mpcWalletId: string;
  status: string;
}>();

export const mockTokensRegistry = new Map<string, {
  id: string;
  tokenHash: string;
  userId: string;
  clientId: string;
  expiresAt: Date;
  status?: 'active' | 'paused' | 'revoked';
}>();

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function registerMockToken(
  rawToken: string,
  opts: {
    userId: string;
    clientId: string;
    wallet: ToolWallet;
    status?: 'active' | 'paused' | 'revoked';
  }
) {
  const tokenHash = hashToken(rawToken);
  mockTokensRegistry.set(tokenHash, {
    id: 'tok_' + tokenHash.slice(0, 8),
    tokenHash,
    userId: opts.userId,
    clientId: opts.clientId,
    expiresAt: new Date(Date.now() + 30 * 86400000),
    status: opts.status || 'active',
  });

  mockClientsRegistry.set(opts.clientId, {
    id: opts.clientId,
    userId: opts.userId,
    keyHash: tokenHash,
    status: opts.status || 'active',
    expiresAt: new Date(Date.now() + 30 * 86400000),
  });

  if (opts.wallet) {
    mockWalletsRegistry.set(opts.userId, {
      id: opts.wallet.id,
      userId: opts.userId,
      address: opts.wallet.address,
      chainFamily: opts.wallet.chainFamily,
      mpcWalletId: opts.wallet.mpcWalletId,
      status: 'active',
    });
  }
}

export async function findHash(tokens: any[] | null | undefined, bearer: string, keyField: string): Promise<any | null> {
  const targetHash = hashToken(bearer);

  // 1. Check in-memory test registry only in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    for (const token of mockTokensRegistry.values()) {
      if (token.tokenHash === targetHash || token.tokenHash === bearer) {
        if (token.expiresAt > new Date()) {
          return {
            user_id: token.userId,
            client_id: token.clientId,
            token_hash: token.tokenHash,
            status: token.status || 'active',
          };
        }
      }
    }
  }

  // 2. Check tokens from database
  if (!tokens || tokens.length === 0) return null;
  for (const item of tokens) {
    const stored = item[keyField];
    if (!stored) continue;
    if (stored === targetHash || stored === bearer) {
      return item;
    }
  }
  return null;
}

export async function findClientKey(clients: any[] | null | undefined, apiKey: string): Promise<any | null> {
  // 1. Check in-memory test registry only in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    for (const client of mockClientsRegistry.values()) {
      if (await verifyClientKey(apiKey, client.keyHash)) {
        return client;
      }
    }
  }

  // 2. Check Supabase client records
  if (!clients || clients.length === 0) return null;
  for (const client of clients) {
    if (await verifyClientKey(apiKey, client.client_key_hash)) {
      return {
        id: client.id,
        user_id: client.user_id,
        userId: client.user_id,
        keyHash: client.client_key_hash,
        status: client.status,
      };
    }
  }
  return null;
}

export function extractClientKey(req: any): string | null {
  const getHdr = (n: string) => (typeof req.header === 'function' ? req.header(n) : req.headers?.[n.toLowerCase()]);
  const authHeader = getHdr('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith('nv_live_')) return token;
  }

  const xApiKey = getHdr('x-api-key');
  if (typeof xApiKey === 'string' && xApiKey.startsWith('nv_live_')) {
    return xApiKey.trim();
  }

  const queryKey = req.query?.apiKey || req.query?.client_key || req.query?.key;
  if (typeof queryKey === 'string' && queryKey.startsWith('nv_live_')) {
    return queryKey.trim();
  }

  return null;
}

/**
 * Universal resolveContext function:
 * Resolves caller identity from either OAuth Bearer token or Agent Client key (nv_live_...)
 * Enforces tenant isolation: maps token/key -> user -> wallet.
 * Rejects unauthenticated requests with 401 + WWW-Authenticate header.
 */
export async function resolveContext(
  req: { header?: (n: string) => string | undefined; headers?: Record<string, any>; query?: any; session?: any; cookies?: any },
  args?: any
): Promise<ToolContext> {
  const getHdr = (n: string) => {
    if (typeof req.header === 'function') return req.header(n);
    if (req.headers) return req.headers[n.toLowerCase()];
    return undefined;
  };

  const authHeader = (getHdr('authorization') || '').trim();
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const apiKey = (getHdr('x-api-key') || req.query?.apiKey || req.query?.client_key || req.query?.key || '').trim();
  const sessionToken = (getHdr('x-session-token') || req.session?.token || req.cookies?.nv_session || '').trim();

  // 1. Authorization: Bearer nv_oauth_... -> oauth_tokens.token_hash
  if (bearer && !bearer.startsWith('nv_live_')) {
    const targetHash = hashToken(bearer);
    let match: any = null;

    if (process.env.NODE_ENV !== 'production') {
      for (const token of mockTokensRegistry.values()) {
        if (token.tokenHash === targetHash || token.tokenHash === bearer) {
          if (token.expiresAt > new Date()) {
            match = {
              user_id: token.userId,
              client_id: token.clientId,
              token_hash: token.tokenHash,
              status: token.status || 'active',
            };
            break;
          }
        }
      }
    }

    if (!match) {
      try {
        const { data } = await supabase
          .from('oauth_tokens')
          .select('*')
          .eq('token_hash', targetHash)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();
        if (data) match = data;
      } catch {}
    }

    if (!match) throw new HttpError(401, 'TOKEN_INVALID', 'Invalid OAuth token', true);

    if (match.status === 'revoked' || match.status === 'paused') {
      throw new HttpError(403, 'CLIENT_REVOKED', 'Client access has been revoked');
    }

    if (match.client_id) {
      let clientRecord: any = null;
      try {
        const { data } = await supabase
          .from('agent_clients')
          .select('*')
          .eq('id', match.client_id)
          .maybeSingle();
        if (data) clientRecord = data;
      } catch {}

      if (!clientRecord && process.env.NODE_ENV !== 'production') {
        clientRecord = mockClientsRegistry.get(match.client_id);
      }

      if (clientRecord && (clientRecord.status === 'revoked' || clientRecord.status === 'paused')) {
        throw new HttpError(403, 'CLIENT_REVOKED', 'Client access has been revoked');
      }
    }

    return loadScope(match.user_id, match.client_id, args);
  }

  // 2. X-API-Key: nv_live_... or Authorization: Bearer nv_live_... -> agent_clients.client_key_hash
  const effectiveKey = apiKey || (bearer.startsWith('nv_live_') ? bearer : '');
  if (effectiveKey) {
    let clients: any[] = [];
    try {
      const { data } = await supabase
        .from('agent_clients')
        .select('*')
        .eq('status', 'active');
      if (data) clients = data;
    } catch {}

    const client = await findClientKey(clients, effectiveKey);
    if (!client) throw new HttpError(401, 'INVALID_CLIENT_KEY', 'Invalid API Key', true);
    if (client.status === 'revoked' || client.status === 'paused') {
      throw new HttpError(403, 'CLIENT_REVOKED', 'Client access has been revoked');
    }

    return loadScope(client.user_id || client.userId, client.id, args);
  }

  // 3. X-Session-Token or session cookie (wallet SPA only)
  if (sessionToken || req.session?.userId) {
    let sessionUserId = req.session?.userId;
    if (!sessionUserId && sessionToken) {
      const payload = verifySessionToken(sessionToken);
      if (payload?.userId) {
        sessionUserId = payload.userId;
      }
    }
    if (sessionUserId) {
      return loadScope(sessionUserId, null, args);
    }
  }

  // 4. If none: 401 with WWW-Authenticate header
  throw new HttpError(401, 'UNAUTHORIZED', 'Missing authorization credentials', true);
}

export async function loadScope(userId: string, clientId: string | null, args?: any): Promise<ToolContext> {
  // 1. Resolve active wallets for user
  let wallets: any[] = [];
  try {
    const { data, error } = await supabase
      .from('wallets')
      .select('id, user_id, address, mpc_wallet_id, is_primary, status, chain_family')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('is_primary', { ascending: false });
    if (data && !error) wallets = data;
  } catch {}

  if (!wallets.length && process.env.NODE_ENV !== 'production') {
    const direct = mockWalletsRegistry.get(userId);
    if (direct) {
      wallets = [direct];
    } else {
      for (const w of mockWalletsRegistry.values()) {
        if ((w.userId === userId || (w as any).user_id === userId) && (w.status === 'active' || !w.status)) {
          wallets.push(w);
        }
      }
    }
  }

  if (!wallets.length) {
    throw new HttpError(409, 'NO_WALLET', 'Create a vault on wallet.northveil.xyz first');
  }

  let chosen = wallets.find((w: any) => w.is_primary) || wallets[0];

  // 2. Resolve grant policy for client
  let grant: Grant | null = null;
  let rawGrant: any = null;
  if (clientId) {
    try {
      const { data } = await supabase
        .from('grants')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      if (data) rawGrant = data;
    } catch {}

    if (!rawGrant && process.env.NODE_ENV !== 'production') {
      const mockGrant = mockGrantsRegistry.get(clientId);
      if (mockGrant) {
        rawGrant = mockGrant;
      }
    }

    if (rawGrant) {
      grant = {
        clientId: rawGrant.client_id || rawGrant.clientId,
        walletAddresses: [chosen.address.toLowerCase()],
        chains: rawGrant.chains || ['eip155:8453', 'eip155:11155111'],
        allowedAssets: rawGrant.allowed_assets || rawGrant.allowedAssets || ['ETH', 'USDC'],
        allowedRecipients: rawGrant.allow_any_recipient ? '*' : (rawGrant.allowed_recipients || rawGrant.allowedRecipients || []),
        maxWeiPerTx: BigInt(rawGrant.max_wei_per_tx || rawGrant.maxWeiPerTx || '0'),
        maxWeiPerDay: BigInt(rawGrant.max_wei_per_day || rawGrant.maxWeiPerDay || '0'),
        mode: (rawGrant.mode as Mode) || 'always_ask',
        expiresAt: rawGrant.expiresAt || new Date(Date.now() + 365 * 86400000),
        revoked: false,
      };
    }
  }

  if (args?.walletId) {
    const override = wallets.find((w: any) => w.id === args.walletId);
    const grantIds: string[] = rawGrant?.wallet_ids || rawGrant?.walletIds || [];
    if (!override || (grantIds.length > 0 && !grantIds.includes(override.id))) {
      throw new HttpError(403, 'WALLET_NOT_IN_GRANT', 'walletId is not allowed for this agent');
    }
    chosen = override;
  }

  const mpcWalletId = chosen.mpc_wallet_id || chosen.mpcWalletId;
  if (!mpcWalletId) {
    throw new HttpError(409, 'SIGNER_NOT_BOUND', 'Signer not bound to MPC wallet');
  }

  const wallet: ToolWallet = {
    id: chosen.id,
    address: chosen.address,
    chainFamily: chosen.chain_family || chosen.chainFamily || 'evm',
    mpcWalletId,
  };

  const effectiveClientId = clientId || 'claude';

  if (!grant) {
    grant = {
      clientId: effectiveClientId,
      walletAddresses: [wallet.address.toLowerCase()],
      chains: ['eip155:8453', 'eip155:11155111', 'eip155:1'],
      allowedAssets: ['ETH', 'USDC', 'SOL'],
      allowedRecipients: [],
      maxWeiPerTx: 0n,
      maxWeiPerDay: 0n,
      mode: 'always_ask',
      expiresAt: new Date(Date.now() + 365 * 86400000),
      revoked: false,
    };
  } else {
    grant.walletAddresses = [wallet.address.toLowerCase()];
  }

  return { userId, clientId: effectiveClientId, wallet, grant };
}
