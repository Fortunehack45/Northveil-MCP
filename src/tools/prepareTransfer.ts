import { ethers } from 'ethers';
import { evaluateGrant, canonicalPayloadHash } from '../policy/grantEngine.js';
import { createApproval } from '../wallet/approvals.js';
import { getMpcProvider } from '../wallet/mpcAdapter.js';
import { logAudit } from '../audit/log.js';
import { supabase } from '../supabase.js';

export interface PrepareTransferInput {
  to: string;
  amount: string; // in ether or token units, e.g. "0.05"
  chain?: string; // default eip155:8453 (Base)
  asset?: string; // default ETH
  data?: string;
  walletAddress?: string;
}

// In-memory spend counter for tests/offline
export const inMemoryDailySpend = new Map<string, bigint>();

async function getSpentToday(grantId: string): Promise<bigint> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const cacheKey = `${grantId}:${todayStr}`;

  try {
    const { data } = await supabase
      .from('spend_counters')
      .select('spent_wei')
      .eq('grant_id', grantId)
      .eq('day_utc', todayStr)
      .maybeSingle();

    if (data) {
      return BigInt(data.spent_wei || '0');
    }
  } catch {}

  return inMemoryDailySpend.get(cacheKey) || 0n;
}

async function recordSpend(grantId: string, amountWei: bigint): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const cacheKey = `${grantId}:${todayStr}`;
  const current = inMemoryDailySpend.get(cacheKey) || 0n;
  inMemoryDailySpend.set(cacheKey, current + amountWei);

  try {
    const { data } = await supabase
      .from('spend_counters')
      .select('spent_wei')
      .eq('grant_id', grantId)
      .eq('day_utc', todayStr)
      .maybeSingle();

    const newTotal = (data ? BigInt(data.spent_wei || '0') : 0n) + amountWei;

    await supabase.from('spend_counters').upsert({
      grant_id: grantId,
      day_utc: todayStr,
      spent_wei: newTotal.toString(),
    });
  } catch {}
}

export async function prepareTransfer(
  ctx: {
    userId: string;
    clientId: string;
    grant: any;
    wallet: { id: string; address: string; chainFamily: string; mpcWalletId: string };
  },
  args: PrepareTransferInput
) {
  const chain = args.chain || 'eip155:8453';
  const asset = (args.asset || 'ETH').toUpperCase();
  const to = (args.to || '').trim();
  const data = (args.data || '0x').trim();

  if (!to || !ethers.isAddress(to)) {
    return {
      status: 'DENIED',
      reason: 'INVALID_RECIPIENT_ADDRESS: "to" must be a valid EVM address.',
    };
  }

  let valueWei: bigint;
  try {
    valueWei = ethers.parseEther(args.amount || '0');
  } catch {
    return {
      status: 'DENIED',
      reason: 'INVALID_AMOUNT: "amount" must be a valid numerical decimal string.',
    };
  }

  const spentToday = await getSpentToday(ctx.grant.clientId);

  const intent = {
    walletAddress: ctx.wallet.address,
    chain,
    to,
    valueWei,
    asset,
    data,
    spentWeiToday: spentToday,
  };

  const decision = evaluateGrant(ctx.grant, intent);

  if (decision.type === 'deny') {
    await logAudit({
      userId: ctx.userId,
      walletAddress: ctx.wallet.address,
      clientId: ctx.clientId,
      action: 'TRANSFER_DENIED',
      details: { reason: decision.reason, to, amount: args.amount, chain, asset },
    });

    return {
      status: 'DENIED',
      reason: decision.reason,
      agentNextStep: `Operation blocked by security policy (${decision.reason}). Explain the boundary to the user.`,
    };
  }

  // Derive chainId number
  let chainIdNum = 8453;
  if (chain.startsWith('eip155:')) {
    chainIdNum = parseInt(chain.split(':')[1], 10) || 8453;
  }

  // Estimate next nonce (mock or public query)
  const nonce = 0; // Default / simulation nonce

  const unsignedTx = {
    from: ctx.wallet.address,
    to,
    value: valueWei.toString(),
    data,
    chainId: chainIdNum,
    nonce,
    gasLimit: '21000',
    maxFeePerGas: '1000000000',
    maxPriorityFeePerGas: '1000000000',
  };

  const payloadHash = canonicalPayloadHash({
    chain,
    to,
    valueWei: valueWei.toString(),
    data,
    nonce,
  });

  // Autonomous Path: Direct MPC Sign inside Enclave
  if (decision.type === 'allow_autonomous') {
    if (!process.env.TURNKEY_API_PRIVATE_KEY) {
      return {
        status: 'ERROR',
        error: 'SIGNER_NOT_CONFIGURED',
      };
    }

    try {
      const mpcProvider = getMpcProvider();
      const signed = await mpcProvider.signAndBroadcast({
        mpcWalletId: ctx.wallet.mpcWalletId,
        unsignedTx,
        payloadHash,
        approvalEvidence: {
          type: 'autonomous_grant',
          grantId: ctx.grant.clientId,
        },
      });

      await recordSpend(ctx.grant.clientId, valueWei);

      await logAudit({
        userId: ctx.userId,
        walletAddress: ctx.wallet.address,
        clientId: ctx.clientId,
        action: 'AUTONOMOUS_TRANSFER_EXECUTED',
        details: { txHash: signed.txHash, to, amount: args.amount, chain },
      });

      const explorerBase = chainIdNum === 8453 ? 'https://basescan.org/tx/' : 'https://sepolia.etherscan.io/tx/';

      return {
        status: 'EXECUTED',
        txHash: signed.txHash,
        explorerUrl: `${explorerBase}${signed.txHash}`,
        summary: {
          from: ctx.wallet.address,
          to,
          amount: args.amount,
          asset,
          chain,
          mode: 'autonomous',
        },
      };
    } catch (err: any) {
      return {
        status: 'EXECUTION_FAILED',
        error: err.message,
      };
    }
  }

  // Always Ask Path: Stage PendingApproval for Passkey Ceremony
  const approval = await createApproval({
    userId: ctx.userId,
    clientId: ctx.clientId,
    walletId: ctx.wallet.id,
    walletAddress: ctx.wallet.address,
    payloadHash,
    canonicalTx: unsignedTx,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  });

  await logAudit({
    userId: ctx.userId,
    walletAddress: ctx.wallet.address,
    clientId: ctx.clientId,
    action: 'TRANSFER_APPROVAL_STAGED',
    details: { approvalId: approval.id, payloadHash, to, amount: args.amount, chain },
  });

  const approveUrl = `https://wallet.northveil.xyz/?action=approvals&id=${approval.id}`;

  return {
    status: 'APPROVAL_REQUIRED',
    approvalId: approval.id,
    payloadHash,
    approveUrl,
    expiresAt: approval.expiresAt.toISOString(),
    summary: {
      from: ctx.wallet.address,
      to,
      amount: args.amount,
      asset,
      chain,
      estimatedFeeUsd: 0.05,
    },
    agentNextStep: `I have staged a transfer of ${args.amount} ${asset} on ${chain} to ${to}. To complete this transaction, open your Northveil wallet and sign with your passkey: ${approveUrl}`,
  };
}
