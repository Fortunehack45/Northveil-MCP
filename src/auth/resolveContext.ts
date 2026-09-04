import { createHash } from 'node:crypto';
import { Request } from 'express';
import { supabase } from '../supabase.js';
import { verifyClientKey } from './agentClient.js';
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
  wwwAuthenticate?: boolean;

  constructor(status: number, message: string, wwwAuthenticate = false) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.statusCode = status;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

export function http(status: number, message: string, wwwAuthenticate = false): HttpError {
  return new HttpError(status, message, wwwAuthenticate);
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

  mockWalletsRegistry.set(opts.userId, {
    id: opts.wallet.id,
    userId: opts.userId,
    address: opts.wallet.address,
    chainFamily: opts.wallet.chainFamily,
    mpcWalletId: opts.wallet.mpcWalletId,
    status: 'active',
  });
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
  req: { header?: (n: string) => string | undefined; headers?: Record<string, any>; query?: any },
  _explicitArgs?: any
): Promise<ToolContext> {
  const getHdr = (n: string) => {
    if (typeof req.header === 'function') return req.header(n);
    if (req.headers) return req.headers[n.toLowerCase()];
    return undefined;
  };

  const authHeader = (getHdr('authorization') || '').trim();
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const apiKey = (getHdr('x-api-key') || req.query?.apiKey || req.query?.client_key || req.query?.key || '').trim();

  if (!bearer && !apiKey) {
    const err = new HttpError(401, 'UNAUTHORIZED', true);
    throw err;
  }

  if (bearer && !bearer.startsWith('nv_live_')) {
    // Authenticate via OAuth bearer token
    let tokens: any[] = [];
    try {
      const { data } = await supabase
        .from('oauth_tokens')
        .select('*')
        .gt('expires_at', new Date().toISOString());
      if (data) tokens = data;
    } catch {
      // In offline / test mode, fallback to in-memory tokens
    }

    const match = await findHash(tokens, bearer, 'token_hash');
    if (!match) throw http(401, 'TOKEN_INVALID', true);

    if (match.status === 'revoked' || match.status === 'paused') {
      throw http(403, 'CLIENT_REVOKED');
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
        throw http(403, 'CLIENT_REVOKED');
      }
    }

    return loadScope(match.user_id, match.client_id);
  }

  // Authenticate via Agent Client key (X-API-Key or Bearer nv_live_...)
  const effectiveKey = apiKey || bearer;
  let clients: any[] = [];
  try {
    const { data } = await supabase
      .from('agent_clients')
      .select('*')
      .eq('status', 'active');
    if (data) clients = data;
  } catch {
    // In offline / test mode, fallback to in-memory clients
  }

  const client = await findClientKey(clients, effectiveKey);
  if (!client) throw http(401, 'INVALID_CLIENT_KEY');
  if (client.status === 'revoked' || client.status === 'paused') {
    throw http(403, 'CLIENT_REVOKED');
  }

  return loadScope(client.user_id || client.userId, client.id);
}

export async function loadScope(userId: string, clientId: string | null): Promise<ToolContext> {
  // 1. Resolve active wallet for user
  let walletRecord: any = null;
  try {
    const { data } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (data) walletRecord = data;
  } catch {}

  if (!walletRecord && process.env.NODE_ENV !== 'production') {
    const direct = mockWalletsRegistry.get(userId);
    if (direct) {
      walletRecord = direct;
    } else {
      for (const w of mockWalletsRegistry.values()) {
        if ((w.userId === userId || (w as any).user_id === userId) && (w.status === 'active' || !w.status)) {
          walletRecord = w;
          break;
        }
      }
    }
  }

  if (!walletRecord) {
    throw http(403, 'NO_WALLET');
  }

  const wallet: ToolWallet = {
    id: walletRecord.id,
    address: walletRecord.address,
    chainFamily: walletRecord.chain_family || walletRecord.chainFamily || 'evm',
    mpcWalletId: walletRecord.mpc_wallet_id || walletRecord.mpcWalletId || 'turnkey-wallet',
  };

  // 2. Resolve grant policy for client
  let grant: Grant | null = null;
  if (clientId) {
    let grantRecord: any = null;
    try {
      const { data } = await supabase
        .from('grants')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      if (data) grantRecord = data;
    } catch {}

    if (!grantRecord && process.env.NODE_ENV !== 'production') {
      const mockGrant = mockGrantsRegistry.get(clientId);
      if (mockGrant) {
        grant = {
          clientId: mockGrant.clientId,
          walletAddresses: [wallet.address.toLowerCase()],
          chains: mockGrant.chains,
          allowedAssets: mockGrant.allowedAssets,
          allowedRecipients: mockGrant.allowedRecipients,
          maxWeiPerTx: mockGrant.maxWeiPerTx,
          maxWeiPerDay: mockGrant.maxWeiPerDay,
          mode: mockGrant.mode,
          expiresAt: mockGrant.expiresAt,
          revoked: false,
        };
      }
    } else {
      grant = {
        clientId: grantRecord.client_id,
        walletAddresses: [wallet.address.toLowerCase()],
        chains: grantRecord.chains || ['eip155:8453', 'eip155:11155111'],
        allowedAssets: grantRecord.allowed_assets || ['ETH', 'USDC'],
        allowedRecipients: grantRecord.allow_any_recipient ? '*' : (grantRecord.allowed_recipients || []),
        maxWeiPerTx: BigInt(grantRecord.max_wei_per_tx || '0'),
        maxWeiPerDay: BigInt(grantRecord.max_wei_per_day || '0'),
        mode: (grantRecord.mode as Mode) || 'always_ask',
        expiresAt: new Date(Date.now() + 365 * 86400000),
        revoked: false,
      };
    }
  }

  const effectiveClientId = clientId || 'claude';

  // If no explicit grant exists, default to safe Always Ask policy
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
  }

  return { userId, clientId: effectiveClientId, wallet, grant };
}
