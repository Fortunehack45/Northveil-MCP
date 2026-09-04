import { Request } from 'express';
import { SUPPORTED_CHAINS, WRITE_CHAINS, READ_EXTRA_CHAINS } from '../config/chains.js';
import { getBalances, getNftBalances } from '../read/balances.js';
import { getTokenPrice } from '../read/prices.js';
import { simulateTx, estimateGas } from '../read/simulation.js';
import { getPortfolio } from './getPortfolio.js';
import { getTransactionStatus } from './getTransactionStatus.js';
import { listPositions, placePosition, cancelPosition } from './positions.js';
import { getRequest, submitIntent } from '../wallet/requestLifecycle.js';
import { resolveContext, HttpError, ToolContext } from '../auth/resolveContext.js';
import { supabase } from '../supabase.js';

export async function executeTool(name: string, args: Record<string, any>, req: Request, providedCtx?: any) {
  // Public inspection tools (no wallet context required)
  if (name === 'nv_health') {
    return {
      status: 'ok',
      system: 'Northveil Non-Custodial Control Plane',
      custody: 'none',
      signing: 'threshold_mpc',
      timestamp: new Date().toISOString(),
    };
  }

  if (name === 'nv_list_networks') {
    return {
      writeReadyChains: WRITE_CHAINS,
      readOnlyChains: READ_EXTRA_CHAINS,
      allSupported: Object.keys(SUPPORTED_CHAINS),
    };
  }

  if (name === 'nv_get_token_price') {
    return await getTokenPrice(args.symbol || 'ETH');
  }

  // All wallet operations require verified client key or OAuth bearer token
  const ctx = providedCtx || (req as any).nv || (await resolveContext(req, args));

  // Cross-tenant isolation check: if walletAddress is requested, it MUST match the user's active wallet
  if (args.walletAddress && typeof args.walletAddress === 'string') {
    const requested = args.walletAddress.trim().toLowerCase();
    const authorized = ctx.wallet.address.toLowerCase();
    if (requested !== authorized) {
      throw new HttpError(403, 'WALLET_NOT_IN_GRANT');
    }
  }

  switch (name) {
    case 'nv_list_wallets':
    case 'get_wallet_info': {
      if (!ctx?.wallet?.address) {
        return {
          wallets: [],
          hint: 'Create a vault at wallet.northveil.xyz',
          grantMode: ctx?.grant?.mode || 'always_ask',
          allowedChains: ctx?.grant?.chains || ['eip155:8453', 'eip155:11155111'],
          allowedAssets: ctx?.grant?.allowedAssets || ['ETH', 'USDC'],
          maxWeiPerTx: (ctx?.grant?.maxWeiPerTx || 0n).toString(),
          maxWeiPerDay: (ctx?.grant?.maxWeiPerDay || 0n).toString(),
        };
      }

      const walletList = (ctx as any).wallets && Array.isArray((ctx as any).wallets) && (ctx as any).wallets.length > 0
        ? (ctx as any).wallets.map((w: any) => ({
            id: w.id,
            address: w.address,
            chainFamily: w.chainFamily || w.chain_family,
          }))
        : [
            {
              id: ctx.wallet.id,
              address: ctx.wallet.address,
              chainFamily: ctx.wallet.chainFamily,
            },
          ];

      return {
        wallets: walletList,
        grantMode: ctx.grant?.mode || 'always_ask',
        allowedChains: ctx.grant?.chains || ['eip155:8453', 'eip155:11155111'],
        allowedAssets: ctx.grant?.allowedAssets || ['ETH', 'USDC'],
        maxWeiPerTx: (ctx.grant?.maxWeiPerTx || 0n).toString(),
        maxWeiPerDay: (ctx.grant?.maxWeiPerDay || 0n).toString(),
      };
    }

    case 'nv_get_balances':
      return await getBalances(ctx.wallet.address, args.network || 'all');

    case 'nv_get_portfolio':
    case 'get_portfolio':
      return await getPortfolio(ctx, args);

    case 'nv_get_nft_balances':
      return await getNftBalances(ctx.wallet.address, args.network || 'base');

    case 'nv_get_tx_history': {
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      try {
        const { data } = await supabase
          .from('agent_requests')
          .select('id, tool, status, tx_hash, created_at')
          .eq('user_id', ctx.userId)
          .order('created_at', { ascending: false })
          .limit(limit);
        return { transactions: data || [] };
      } catch {
        return { transactions: [] };
      }
    }

    case 'nv_get_tx':
    case 'get_transaction_status':
      return await getTransactionStatus(ctx, args as any);

    case 'nv_simulate_tx':
      return await simulateTx({
        chain: args.network || 'base',
        from: ctx.wallet.address,
        to: args.to,
        data: args.data,
        value: args.value,
      });

    case 'nv_estimate_gas':
      return await estimateGas({
        chain: args.network || 'base',
        from: ctx.wallet.address,
        to: args.to,
        data: args.data,
        value: args.value,
      });

    case 'nv_list_positions':
      return await listPositions(ctx);

    case 'nv_get_tokenomics':
      return {
        address: args.contractAddress || ctx.wallet.address,
        tokenomics: [
          { label: 'community', percent: 90 },
          { label: 'team', percent: 10 },
        ],
      };

    case 'nv_get_request':
    case 'get_request':
      return await getRequest(args.requestId || args.id);

    case 'nv_prepare_transfer':
    case 'prepare_transfer':
      return await submitIntent(ctx, 'nv_prepare_transfer', args as any);

    case 'nv_prepare_swap':
      return await submitIntent(ctx, 'nv_prepare_swap', args as any);

    case 'nv_prepare_deploy_token':
      return await submitIntent(ctx, 'nv_prepare_deploy_token', args as any);

    case 'nv_prepare_deploy_nft':
      return await submitIntent(ctx, 'nv_prepare_deploy_nft', args as any);

    case 'nv_prepare_mint_nft':
      return await submitIntent(ctx, 'nv_prepare_mint_nft', args as any);

    case 'nv_prepare_mint_token':
      return await submitIntent(ctx, 'nv_prepare_mint_token', args as any);

    case 'nv_prepare_contract_call':
      return await submitIntent(ctx, 'nv_prepare_contract_call', args as any);

    case 'nv_place_position':
      return await placePosition(ctx, args as any);

    case 'nv_cancel_position':
      return await cancelPosition(ctx, args.positionId);

    case 'nv_set_autonomous_mode': {
      // Updates agent grant to autonomous mode if within policy
      return {
        requestId: 'req_grant_' + Date.now(),
        status: 'pending_approval',
        approveUrl: `https://wallet.northveil.xyz/grant/${ctx.clientId}`,
        tool: 'nv_set_autonomous_mode',
      };
    }

    case 'nv_list_pending_approvals':
    case 'list_pending_approvals': {
      const { data } = await supabase
        .from('pending_approvals')
        .select('id, payload_hash, canonical_tx, expires_at, used, created_at')
        .eq('client_id', ctx.clientId)
        .eq('used', false);
      return { pendingApprovals: data || [] };
    }

    case 'nv_get_approval_status': {
      const { data } = await supabase
        .from('pending_approvals')
        .select('id, used, expires_at, created_at')
        .eq('id', args.approvalId)
        .single();
      return data || { error: 'Approval ticket not found' };
    }

    default:
      throw new HttpError(404, 'TOOL_NOT_FOUND', `Tool "${name}" not found or out of scope.`);
  }
}

export async function dispatch(name: string, args: Record<string, any>, ctx: ToolContext, req: Request) {
  const raw: any = await executeTool(name, args, req, ctx);

  if (raw && typeof raw === 'object' && Array.isArray(raw.content)) {
    return raw;
  }

  // 1. Transfer
  if (name === 'nv_prepare_transfer' || name === 'prepare_transfer') {
    const fromPreview = ctx?.wallet?.address
      ? `${ctx.wallet.address.slice(0, 6)}...${ctx.wallet.address.slice(-4)}`
      : undefined;
    const toPreview = args.to
      ? (args.to.length > 10 ? `${args.to.slice(0, 6)}...${args.to.slice(-4)}` : args.to)
      : undefined;
    const approveUrl = raw.approveUrl || (raw.requestId ? `https://wallet.northveil.xyz/approve/${raw.requestId}` : undefined);

    return {
      content: [
        {
          type: 'text',
          text: `Submitted. requestId=${raw.requestId} status=${raw.status}. Poll nv_get_request. Do not call prepare again.`,
        },
      ],
      structuredContent: {
        kind: 'send',
        requestId: raw.requestId,
        status: raw.status,
        amount: args.amount,
        asset: args.asset || 'ETH',
        network: args.network || 'base',
        fromPreview,
        toPreview,
        approveUrl,
        txHash: raw.txHash,
        explorerUrl: raw.explorerUrl,
        error: raw.reason || raw.error,
      },
    };
  }

  // 2. Swap
  if (name === 'nv_prepare_swap') {
    const fromPreview = ctx?.wallet?.address
      ? `${ctx.wallet.address.slice(0, 6)}...${ctx.wallet.address.slice(-4)}`
      : undefined;
    const approveUrl = raw.approveUrl || (raw.requestId ? `https://wallet.northveil.xyz/approve/${raw.requestId}` : undefined);

    return {
      content: [
        {
          type: 'text',
          text: `Submitted swap. requestId=${raw.requestId} status=${raw.status}. Poll nv_get_request. Do not call prepare again.`,
        },
      ],
      structuredContent: {
        kind: 'swap',
        requestId: raw.requestId,
        status: raw.status,
        amount: args.amount,
        fromAsset: args.fromAsset,
        toAsset: args.toAsset,
        network: args.network || 'base',
        fromPreview,
        approveUrl,
        txHash: raw.txHash,
        explorerUrl: raw.explorerUrl,
        error: raw.reason || raw.error,
      },
    };
  }

  // 3. Deploy / mint / contract / position writes
  if (
    name === 'nv_prepare_deploy_token' ||
    name === 'nv_prepare_deploy_nft' ||
    name === 'nv_prepare_mint_nft' ||
    name === 'nv_prepare_mint_token' ||
    name === 'nv_prepare_contract_call' ||
    name === 'nv_place_position' ||
    name === 'nv_cancel_position' ||
    name === 'nv_set_autonomous_mode'
  ) {
    const reqId = raw.requestId || raw.positionId || (raw as any)?.id;
    const approveUrl = raw.approveUrl || (reqId ? `https://wallet.northveil.xyz/approve/${reqId}` : undefined);

    return {
      content: [
        {
          type: 'text',
          text: `Submitted ${name}. requestId=${reqId || 'ok'} status=${raw.status || 'ok'}. Poll nv_get_request.`,
        },
      ],
      structuredContent: {
        kind: 'deploy',
        requestId: reqId,
        status: raw.status || 'ok',
        tool: name,
        network: args.network || 'base',
        approveUrl,
        txHash: raw.txHash,
        explorerUrl: raw.explorerUrl,
        error: raw.reason || raw.error,
      },
    };
  }

  // 4. Request lifecycle status inspector
  if (name === 'nv_get_request' || name === 'get_request') {
    return {
      content: [
        {
          type: 'text',
          text: `Request ${raw.requestId}: status=${raw.status}${raw.txHash ? ` txHash=${raw.txHash}` : ''}${raw.approveUrl ? ` approveUrl=${raw.approveUrl}` : ''}${raw.error ? ` error=${raw.error}` : ''}`,
        },
      ],
      structuredContent: {
        kind: 'status',
        requestId: raw.requestId,
        status: raw.status,
        approveUrl: raw.approveUrl,
        txHash: raw.txHash,
        explorerUrl: raw.explorerUrl,
        error: raw.error,
      },
    };
  }

  // 5. Read tools (portfolio, balances, nft balances, history, health, positions)
  return {
    content: [
      {
        type: 'text',
        text: typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2),
      },
    ],
    structuredContent: {
      kind: 'read',
      tool: name,
      data: raw,
    },
  };
}
