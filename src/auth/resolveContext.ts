import { Request } from 'express';
import { supabase } from '../supabase.js';
import { verifyClientKey } from './agentClient.js';
import { Grant, Mode } from '../policy/grantEngine.js';

export interface ToolWallet {
  id: string;
  address: string;
  chainFamily: string;
  mpcWalletId: string; // vendor enclave handle, NOT a private key
}

export interface ToolContext {
  userId: string;
  clientId: string;
  grant: Grant;
  wallet: ToolWallet;
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

function http(statusCode: number, message: string): HttpError {
  return new HttpError(statusCode, message);
}

// In-memory clients & grants registry for testing/offline mode
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

/**
 * Extracts raw client key from Authorization header or X-API-Key header.
 * Rejects Google tokens or wallet session cookies.
 */
export function extractClientKey(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    // Do not accept Google tokens or JWTs as client keys
    if (token.startsWith('nv_live_')) return token;
  }

  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.startsWith('nv_live_')) {
    return xApiKey.trim();
  }

  return null;
}

/**
 * Finds agent client record matching the presented client key
 */
async function findClientByKey(rawKey: string) {
  // Check in-memory test registry first
  for (const client of mockClientsRegistry.values()) {
    if (await verifyClientKey(rawKey, client.keyHash)) {
      return client;
    }
  }

  // Check Supabase public.agent_clients
  try {
    const { data: clients, error } = await supabase
      .from('agent_clients')
      .select('*')
      .eq('status', 'active');

    if (error || !clients) return null;

    for (const client of clients) {
      if (await verifyClientKey(rawKey, client.client_key_hash)) {
        return {
          id: client.id,
          userId: client.user_id,
          keyHash: client.client_key_hash,
          status: client.status as 'active' | 'paused' | 'revoked',
          expiresAt: client.expires_at ? new Date(client.expires_at) : new Date(Date.now() + 365 * 86400000),
        };
      }
    }
  } catch (err) {
    console.warn('[resolveContext] Error checking Supabase clients:', err);
  }

  return null;
}

async function loadGrantForClient(clientId: string, rawWalletAddresses: string[]): Promise<Grant | null> {
  const mockGrant = mockGrantsRegistry.get(clientId);
  if (mockGrant) {
    return {
      clientId: mockGrant.clientId,
      walletAddresses: rawWalletAddresses.map(a => a.toLowerCase()),
      chains: mockGrant.chains,
      allowedAssets: mockGrant.allowedAssets,
      allowedRecipients: mockGrant.allowedRecipients,
      maxWeiPerTx: mockGrant.maxWeiPerTx,
      maxWeiPerDay: mockGrant.maxWeiPerDay,
      mode: mockGrant.mode,
      expiresAt: mockGrant.expiresAt,
      revoked: mockGrant.revoked,
    };
  }

  try {
    const { data, error } = await supabase
      .from('grants')
      .select('*')
      .eq('client_id', clientId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      clientId: data.client_id,
      walletAddresses: rawWalletAddresses.map(a => a.toLowerCase()),
      chains: data.chains || ['eip155:8453'],
      allowedAssets: data.allowed_assets || ['ETH', 'USDC'],
      allowedRecipients: data.allow_any_recipient ? '*' : (data.allowed_recipients || []),
      maxWeiPerTx: BigInt(data.max_wei_per_tx || '0'),
      maxWeiPerDay: BigInt(data.max_wei_per_day || '0'),
      mode: (data.mode as Mode) || 'always_ask',
      expiresAt: new Date(Date.now() + 30 * 86400000),
      revoked: false,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the authenticated agent client, user, grant policy, and bound MPC wallet.
 * Every tool call (reads and writes) MUST pass through this function.
 */
export async function resolveContext(req: Request, toolArgs: Record<string, any> = {}): Promise<ToolContext> {
  const rawKey = extractClientKey(req);
  if (!rawKey) throw http(401, 'MISSING_CLIENT_KEY');

  const client = await findClientByKey(rawKey);
  if (!client) throw http(401, 'INVALID_CLIENT_KEY');
  if (client.status !== 'active') throw http(403, 'CLIENT_REVOKED_OR_PAUSED');
  if (client.expiresAt < new Date()) throw http(403, 'CLIENT_EXPIRED');

  // Load user's authorized wallets
  let userWallets: Array<{ id: string; user_id: string; address: string; chain_family: string; mpc_wallet_id: string; status: string }> = [];

  for (const w of mockWalletsRegistry.values()) {
    if (w.userId === client.userId) {
      userWallets.push({
        id: w.id,
        user_id: w.userId,
        address: w.address,
        chain_family: w.chainFamily,
        mpc_wallet_id: w.mpcWalletId,
        status: w.status,
      });
    }
  }

  if (userWallets.length === 0) {
    try {
      const { data } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', client.userId)
        .eq('status', 'active');
      if (data) {
        userWallets = data;
      }
    } catch (err) {
      console.warn('[resolveContext] Error loading wallets:', err);
    }
  }

  if (userWallets.length === 0) throw http(403, 'NO_WALLETS_ATTACHED');

  const grant = await loadGrantForClient(client.id, userWallets.map(w => w.address));
  if (!grant) throw http(403, 'NO_GRANT');

  // Select target wallet
  const requestedAddress = (toolArgs.walletAddress || '').trim().toLowerCase();
  let selectedWalletRecord: typeof userWallets[0] | undefined;

  if (!requestedAddress) {
    if (userWallets.length !== 1) {
      throw http(400, 'WALLET_AMBIGUOUS: Multiple wallets attached. Please specify walletAddress.');
    }
    selectedWalletRecord = userWallets[0];
  } else {
    selectedWalletRecord = userWallets.find(w => w.address.toLowerCase() === requestedAddress);
    if (!selectedWalletRecord) throw http(403, 'WALLET_NOT_OWNED');
    if (!grant.walletAddresses.includes(selectedWalletRecord.address.toLowerCase())) {
      throw http(403, 'WALLET_NOT_IN_GRANT');
    }
  }

  if (selectedWalletRecord.status !== 'active') throw http(403, 'WALLET_DISABLED');

  return {
    userId: client.userId,
    clientId: client.id,
    grant,
    wallet: {
      id: selectedWalletRecord.id,
      address: selectedWalletRecord.address,
      chainFamily: selectedWalletRecord.chain_family,
      mpcWalletId: selectedWalletRecord.mpc_wallet_id,
    },
  };
}
