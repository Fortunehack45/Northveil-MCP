/**
 * Northveil Positions (Take-Profit / Stop-Loss / Limit Orders)
 * Section 23 of Implementation Specification
 */

import { ToolContext } from '../auth/resolveContext.js';
import { supabase } from '../supabase.js';

export interface Position {
  id: string;
  userId: string;
  clientId: string;
  walletId: string;
  network: string;
  baseAsset: string;
  quoteAsset: string;
  side: 'take_profit' | 'stop_loss' | 'limit_buy' | 'limit_sell';
  sizeBase: string;
  triggerPriceUsd: number;
  limitPriceUsd?: number;
  slippageBps: number;
  status: 'open' | 'triggered' | 'executed' | 'cancelled' | 'failed';
  lastError?: string;
  createdAt: string;
}

// In-memory fallback if Supabase table is not yet migrated
export const inMemoryPositions = new Map<string, Position>();

export async function placePosition(ctx: ToolContext, args: {
  network?: string;
  baseAsset: string;
  quoteAsset: string;
  side: 'take_profit' | 'stop_loss' | 'limit_buy' | 'limit_sell';
  sizeBase: string;
  triggerPriceUsd: number;
  limitPriceUsd?: number;
  slippageBps?: number;
}): Promise<Position> {
  const positionId = 'pos_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const position: Position = {
    id: positionId,
    userId: ctx.userId,
    clientId: ctx.clientId,
    walletId: ctx.wallet.id,
    network: args.network || 'base',
    baseAsset: args.baseAsset.toUpperCase(),
    quoteAsset: args.quoteAsset.toUpperCase(),
    side: args.side,
    sizeBase: args.sizeBase,
    triggerPriceUsd: args.triggerPriceUsd,
    limitPriceUsd: args.limitPriceUsd,
    slippageBps: args.slippageBps || 50,
    status: 'open',
    createdAt: new Date().toISOString(),
  };

  inMemoryPositions.set(positionId, position);

  if (supabase) {
    try {
      await supabase.from('positions').insert({
        id: position.id,
        user_id: position.userId,
        client_id: position.clientId,
        wallet_id: position.walletId,
        network: position.network,
        base_asset: position.baseAsset,
        quote_asset: position.quoteAsset,
        side: position.side,
        size_base: position.sizeBase,
        trigger_price_usd: position.triggerPriceUsd,
        limit_price_usd: position.limitPriceUsd,
        slippage_bps: position.slippageBps,
        status: position.status,
      });
    } catch {
      // In-memory holds state if DB unavailable
    }
  }

  return position;
}

export async function cancelPosition(ctx: ToolContext, positionId: string): Promise<Position> {
  const pos = inMemoryPositions.get(positionId);
  if (pos) {
    if (pos.userId !== ctx.userId) {
      throw new Error('Position not owned by authenticated user');
    }
    pos.status = 'cancelled';
    inMemoryPositions.set(positionId, pos);
  }

  if (supabase) {
    try {
      await supabase.from('positions')
        .update({ status: 'cancelled' })
        .eq('id', positionId)
        .eq('user_id', ctx.userId);
    } catch {
      // Handled in memory
    }
  }

  if (!pos) {
    throw new Error(`Position ${positionId} not found`);
  }

  return pos;
}

export async function listPositions(ctx: ToolContext): Promise<Position[]> {
  const userPositions = Array.from(inMemoryPositions.values()).filter(p => p.userId === ctx.userId);
  return userPositions;
}
