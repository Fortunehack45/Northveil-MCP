import crypto from 'node:crypto';
import { supabase } from '../supabase.js';
import { ToolContext, ToolWallet } from '../auth/resolveContext.js';
import { canonicalPayloadHash, evaluateGrant } from '../policy/grantEngine.js';
import { getMpcProvider } from './mpcAdapter.js';
import { logAudit } from '../audit/log.js';
import { createApproval, consumeApproval } from './approvals.js';
import { ethers } from 'ethers';

export type AgentRequestStatus =
  | 'pending_approval'
  | 'pending_signature'
  | 'pending_confirmation'
  | 'success'
  | 'denied'
  | 'error';

export interface AgentRequest {
  id: string;
  user_id: string;
  grant_id?: string;
  wallet_id: string;
  mpc_wallet_id?: string;
  tool: string;
  intent: Record<string, any>;
  canonical_tx: Record<string, any>;
  payload_hash: string;
  status: AgentRequestStatus;
  approve_url?: string;
  tx_hash?: string;
  error?: string;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

// In-memory caches for fast local lookups and isolated testing
export const inMemoryAgentRequests = new Map<string, AgentRequest>();
export const inMemorySignPermits = new Map<string, { id: string; mpcWalletId: string; payloadHash: string; expiresAt: Date }>();

/**
 * Creates a single-use sign permit row for (mpc_wallet_id, payload_hash)
 */
export async function insertSignPermit(
  mpcWalletId: string,
  payloadHash: string,
  ttlMs = 5 * 60 * 1000
): Promise<string> {
  const permitId = 'perm_' + crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);

  inMemorySignPermits.set(`${mpcWalletId}:${payloadHash}`, {
    id: permitId,
    mpcWalletId,
    payloadHash,
    expiresAt,
  });

  const { error: insertError } = await supabase.from('sign_permits').insert({
    id: permitId,
    mpc_wallet_id: mpcWalletId,
    payload_hash: payloadHash,
    expires_at: expiresAt.toISOString(),
  });

  if (insertError) {
    const isHosted = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) || process.env.NORTHVEIL_HOSTED === '1';
    if (isHosted) {
      throw new Error(`SIGN_PERMIT_PERSISTENCE_FAILED: ${insertError.message}`);
    }
  }

  return permitId;
}

/**
 * Atomically consumes a single-use sign permit.
 * The MPC signer refuses to sign unless this returns true.
 */
export async function assertSignPermit(mpcWalletId: string, payloadHash: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const cacheKey = `${mpcWalletId}:${payloadHash}`;

  // 1. Check in-memory store
  const cached = inMemorySignPermits.get(cacheKey);
  if (cached) {
    inMemorySignPermits.delete(cacheKey);
    try {
      await supabase
        .from('sign_permits')
        .delete()
        .eq('mpc_wallet_id', mpcWalletId)
        .eq('payload_hash', payloadHash);
    } catch {}
    if (cached.expiresAt > new Date()) {
      return;
    }
  }

  // 2. Check Supabase table atomically with DELETE ... RETURNING
  try {
    const { data } = await supabase
      .from('sign_permits')
      .delete()
      .eq('mpc_wallet_id', mpcWalletId)
      .eq('payload_hash', payloadHash)
      .gt('expires_at', nowIso)
      .select('id')
      .maybeSingle();

    if (data) {
      return;
    }
  } catch {}

  throw new Error('NO_SIGN_PERMIT: Refusing to sign without an active, single-use approval permit');
}

/**
 * Loads an agent request by ID
 */
export async function loadRequest(requestId: string): Promise<AgentRequest | null> {
  // Check in-memory
  const cached = inMemoryAgentRequests.get(requestId);
  if (cached) return cached;

  try {
    const { data } = await supabase
      .from('agent_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (data) {
      const rec: AgentRequest = {
        id: data.id,
        user_id: data.user_id,
        grant_id: data.grant_id,
        wallet_id: data.wallet_id,
        tool: data.tool,
        intent: data.intent,
        canonical_tx: data.canonical_tx,
        payload_hash: data.payload_hash,
        status: data.status as AgentRequestStatus,
        approve_url: data.approve_url,
        tx_hash: data.tx_hash,
        error: data.error,
        expires_at: new Date(data.expires_at),
        created_at: new Date(data.created_at),
        updated_at: new Date(data.updated_at),
      };
      inMemoryAgentRequests.set(rec.id, rec);
      return rec;
    }
  } catch {}

  return null;
}

/**
 * Updates an agent request
 */
export async function updateRequest(requestId: string, updates: Partial<AgentRequest>): Promise<AgentRequest> {
  let existing = await loadRequest(requestId);
  if (!existing) {
    throw new Error(`Request not found: ${requestId}`);
  }

  const updated: AgentRequest = {
    ...existing,
    ...updates,
    updated_at: new Date(),
  };

  inMemoryAgentRequests.set(requestId, updated);

  try {
    const dbPayload: Record<string, any> = {
      updated_at: updated.updated_at.toISOString(),
    };
    if (updates.status !== undefined) dbPayload.status = updates.status;
    if (updates.tx_hash !== undefined) dbPayload.tx_hash = updates.tx_hash;
    if (updates.error !== undefined) dbPayload.error = updates.error;

    await supabase.from('agent_requests').update(dbPayload).eq('id', requestId);
  } catch {}

  return updated;
}

/**
 * Resolves which wallet to use from the grant
 */
export function pickWallet(ctx: ToolContext, requestedWalletId?: string): ToolWallet {
  if (requestedWalletId) {
    const grantWalletIds = (ctx.grant as any)?.walletIds || (ctx.grant as any)?.wallet_ids || [];
    if (grantWalletIds.length > 0 && !grantWalletIds.includes(requestedWalletId)) {
      throw new Error(`REQUESTED_WALLET_OUT_OF_SCOPE: Wallet ${requestedWalletId} is not in granted wallets.`);
    }
  }
  return ctx.wallet;
}

/**
 * Builds the canonical unsigned transaction object based on tool and args
 */
export async function buildUnsignedTx(
  wallet: ToolWallet,
  tool: string,
  args: Record<string, any>
): Promise<{
  chain: string;
  chainIdNum: number;
  to: string;
  valueWei: string;
  data: string;
  amountUsd?: number;
  unsignedTx: Record<string, any>;
}> {
  let chain = args.chain || args.network || 'eip155:8453';
  if (chain === 'base') chain = 'eip155:8453';
  else if (chain === 'mainnet' || chain === 'ethereum') chain = 'eip155:1';
  else if (chain === 'sepolia') chain = 'eip155:11155111';

  let chainIdNum = 8453;
  if (chain.startsWith('eip155:')) {
    chainIdNum = parseInt(chain.split(':')[1], 10) || 8453;
  }

  let to = (args.to || '').trim();
  let valueWei = '0';
  let data = (args.data || '0x').trim();

  if (tool === 'nv_prepare_transfer' || tool === 'prepare_transfer') {
    if (!to || !ethers.isAddress(to)) {
      throw new Error('INVALID_RECIPIENT_ADDRESS: "to" must be a valid EVM address.');
    }
    try {
      valueWei = ethers.parseEther(args.amount || '0').toString();
    } catch {
      throw new Error('INVALID_AMOUNT: "amount" must be a valid numerical decimal string.');
    }
  } else if (tool === 'nv_prepare_swap' || tool === 'prepare_swap') {
    const spenderAddress = chainIdNum === 8453
      ? '0xdef1c0ded9bec7f1a1670819833240f027b25eff'
      : '0x111111125421ca6dc452d289314280a0f8842a65';
    to = spenderAddress;
    valueWei = args.side === 'buy' ? ethers.parseEther(args.amount || '0').toString() : '0';
    data = '0x415565b00000000000000000000000000000000000000000000000000000000000000001';
  } else if (tool === 'nv_prepare_deploy_token' || tool === 'prepare_deploy_token') {
    to = '0x0000000000000000000000000000000000000000';
    data = '0x608060405234801561001057600080fd5b50';
  } else if (tool === 'nv_prepare_deploy_nft' || tool === 'prepare_deploy_nft') {
    to = '0x0000000000000000000000000000000000000000';
    data = '0x608060405234801561001057600080fd5b50';
  } else if (tool === 'nv_prepare_mint_nft' || tool === 'prepare_mint_nft' || tool === 'nv_prepare_mint_token' || tool === 'prepare_mint_token') {
    to = (args.contractAddress || '').trim();
    data = '0x40c10f19000000000000000000000000' + (args.to || wallet.address).replace(/^0x/, '').padStart(64, '0');
  } else if (tool === 'nv_prepare_contract_call' || tool === 'prepare_contract_call') {
    to = (args.to || '').trim();
    data = (args.data || '0x').trim();
    if (args.value) {
      try {
        valueWei = ethers.parseEther(args.value).toString();
      } catch {}
    }
  }

  const unsignedTx = {
    from: wallet.address,
    to,
    value: valueWei,
    data,
    chainId: chainIdNum,
    nonce: 0,
    gasLimit: '150000',
    maxFeePerGas: '1000000000',
    maxPriorityFeePerGas: '100000000',
  };

  return {
    chain,
    chainIdNum,
    to,
    valueWei,
    data,
    unsignedTx,
  };
}

/**
 * Core Non-Custodial Submit Intent Engine
 * Submits an operation intent ONCE, creates agent_requests row, and enqueues MPC signing
 */
export async function submitIntent(
  ctx: ToolContext,
  tool: string,
  args: Record<string, any>
): Promise<{
  requestId: string;
  status: AgentRequestStatus;
  approveUrl?: string;
  reason?: string;
  txHash?: string;
  explorerUrl?: string;
  approvalId?: string;
  payloadHash?: string;
}> {
  const wallet = pickWallet(ctx, args.walletId);
  let built: Awaited<ReturnType<typeof buildUnsignedTx>>;
  try {
    built = await buildUnsignedTx(wallet, tool, args);
  } catch (err: any) {
    const requestId = crypto.randomUUID();
    return {
      requestId,
      status: 'denied',
      reason: err.message || 'INVALID_PARAMETERS',
    };
  }

  const payloadHash = canonicalPayloadHash({
    chain: built.chain,
    to: built.to,
    valueWei: built.valueWei,
    data: built.data,
    nonce: 0,
  });

  const rawDecision = evaluateGrant(ctx.grant, {
    tool,
    walletAddress: wallet.address,
    chain: built.chain,
    to: built.to,
    valueWei: BigInt(built.valueWei),
    asset: (args.asset || 'ETH').toUpperCase(),
    data: built.data,
    spentWeiToday: 0n,
  } as any);

  const requestId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  if (rawDecision.type === 'deny') {
    const deniedRequest: AgentRequest = {
      id: requestId,
      user_id: ctx.userId,
      grant_id: (ctx.grant as any)?.id,
      wallet_id: wallet.id,
      tool,
      intent: args,
      canonical_tx: built.unsignedTx,
      payload_hash: payloadHash,
      status: 'denied',
      error: rawDecision.reason,
      expires_at: expiresAt,
      created_at: new Date(),
      updated_at: new Date(),
    };

    inMemoryAgentRequests.set(requestId, deniedRequest);
    try {
      await supabase.from('agent_requests').insert({
        id: requestId,
        user_id: ctx.userId,
        grant_id: (ctx.grant as any)?.id,
        wallet_id: wallet.id,
        tool,
        intent: args,
        canonical_tx: built.unsignedTx,
        payload_hash: payloadHash,
        status: 'denied',
        error: rawDecision.reason,
        expires_at: expiresAt.toISOString(),
      });
    } catch {}

    return {
      requestId,
      status: 'denied',
      reason: rawDecision.reason || 'GRANT_DENIED',
    };
  }

  const isAutonomous = rawDecision.type === 'allow_autonomous';
  const status: AgentRequestStatus = isAutonomous ? 'pending_signature' : 'pending_approval';
  const approveUrl = isAutonomous ? undefined : `https://wallet.northveil.xyz/approve/${requestId}`;

  const requestRecord: AgentRequest = {
    id: requestId,
    user_id: ctx.userId,
    grant_id: (ctx.grant as any)?.id,
    wallet_id: wallet.id,
    mpc_wallet_id: (wallet as any).mpcWalletId || (wallet as any).mpc_wallet_id,
    tool,
    intent: args,
    canonical_tx: built.unsignedTx,
    payload_hash: payloadHash,
    status,
    approve_url: approveUrl,
    expires_at: expiresAt,
    created_at: new Date(),
    updated_at: new Date(),
  };

  inMemoryAgentRequests.set(requestId, requestRecord);

  try {
    await supabase.from('agent_requests').insert({
      id: requestId,
      user_id: ctx.userId,
      grant_id: (ctx.grant as any)?.id,
      wallet_id: wallet.id,
      tool,
      intent: args,
      canonical_tx: built.unsignedTx,
      payload_hash: payloadHash,
      status,
      approve_url: approveUrl,
      expires_at: expiresAt.toISOString(),
    });

    // Also mirror to pending_approvals table for backward compatibility
    if (!isAutonomous) {
      await createApproval({
        id: requestId,
        userId: ctx.userId,
        clientId: ctx.clientId,
        walletId: wallet.id,
        walletAddress: wallet.address,
        payloadHash,
        canonicalTx: built.unsignedTx,
        expiresAt,
      });
    }
  } catch (err) {
    console.warn('[Northveil Lifecycle] DB insert error:', err);
  }

  if (isAutonomous) {
    // Autonomous execution: verify signer bound, insert permit, advance to pending_signature, then sign
    try {
      let mpcWalletId = (wallet as any)?.mpc_wallet_id || (wallet as any)?.mpcWalletId;
      if (!mpcWalletId) {
        const { data: w } = await supabase
          .from('wallets')
          .select('mpc_wallet_id')
          .eq('id', wallet.id)
          .maybeSingle();
        if (w?.mpc_wallet_id) {
          mpcWalletId = w.mpc_wallet_id;
        }
      }

      if (!mpcWalletId) {
        throw new Error('SIGNER_NOT_BOUND: Autonomous wallet has no mpc_wallet_id');
      }

      // Insert permit strictly after evaluateGrant passed allow_autonomous
      await insertSignPermit(mpcWalletId, payloadHash);
      await updateRequest(requestId, { status: 'pending_signature' });

      const outcome = await signAndAdvance(requestId, (ctx.grant as any)?.mode || 'autonomous');
      return {
        requestId,
        status: 'success',
        txHash: outcome.txHash,
        explorerUrl: built.chainIdNum === 8453 ? `https://basescan.org/tx/${outcome.txHash}` : `https://sepolia.etherscan.io/tx/${outcome.txHash}`,
        approvalId: requestId,
        payloadHash,
      };
    } catch (err: any) {
      await updateRequest(requestId, { status: 'error', error: err.message });
      return {
        requestId,
        status: 'error',
        reason: err.message,
      };
    }
  }

  return {
    requestId,
    status: 'pending_approval',
    approveUrl,
    approvalId: requestId,
    payloadHash,
  };
}

/**
 * Pollable request inspector tool implementation: nv_get_request
 */
export async function getRequest(requestId: string): Promise<{
  requestId: string;
  status: AgentRequestStatus;
  approveUrl?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  approvalId?: string;
  payloadHash?: string;
}> {
  const req = await loadRequest(requestId);
  if (!req) {
    return {
      requestId,
      status: 'error',
      error: 'REQUEST_NOT_FOUND',
    };
  }

  const chainId = req.canonical_tx?.chainId;
  const explorerBase = chainId === 8453 ? 'https://basescan.org/tx/' : 'https://sepolia.etherscan.io/tx/';

  return {
    requestId: req.id,
    status: req.status,
    approveUrl: req.approve_url || undefined,
    txHash: req.tx_hash || undefined,
    explorerUrl: req.tx_hash ? `${explorerBase}${req.tx_hash}` : undefined,
    error: req.error || undefined,
    approvalId: req.id,
    payloadHash: req.payload_hash,
  };
}

/**
 * Executes threshold MPC signature and on-chain broadcast.
 * ONLY consumes pre-existing sign permits. NEVER inserts its own permit.
 */
export async function signAndAdvance(
  requestId: string,
  grantMode = 'passkey'
): Promise<{ requestId: string; status: AgentRequestStatus; txHash?: string }> {
  const req = await loadRequest(requestId);
  if (!req) throw new Error('REQUEST_NOT_FOUND');
  if (req.status !== 'pending_signature') throw new Error('NOT_SIGNABLE: Request status is not pending_signature');

  // Load wallet for this request - NO FALLBACK to turnkey_wallet!
  let mpcWalletId: string | undefined;
  try {
    const { data: walletData } = await supabase
      .from('wallets')
      .select('mpc_wallet_id')
      .eq('id', req.wallet_id)
      .maybeSingle();
    if (walletData?.mpc_wallet_id) {
      mpcWalletId = walletData.mpc_wallet_id;
    }
  } catch {}

  if (!mpcWalletId && req.mpc_wallet_id) {
    mpcWalletId = req.mpc_wallet_id;
  }

  if (!mpcWalletId) {
    throw new Error('SIGNER_NOT_BOUND: Wallet row has no mpc_wallet_id');
  }

  // Consume single-use permit. If missing or already used -> throws NO_SIGN_PERMIT!
  // DO NOT insert permit here!
  await assertSignPermit(mpcWalletId, req.payload_hash);

  const provider = getMpcProvider();
  const signed = await provider.signAndBroadcast({
    mpcWalletId,
    unsignedTx: req.canonical_tx as any,
    payloadHash: req.payload_hash,
    approvalEvidence: {
      type: grantMode === 'autonomous' ? 'autonomous_grant' : 'passkey',
      approvalId: req.id,
    },
  });

  await updateRequest(req.id, {
    status: 'pending_confirmation',
    tx_hash: signed.txHash,
  });

  // Advance to terminal success
  const completed = await updateRequest(req.id, {
    status: 'success',
    tx_hash: signed.txHash,
  });

  return {
    requestId: completed.id,
    status: completed.status,
    txHash: completed.tx_hash,
  };
}
