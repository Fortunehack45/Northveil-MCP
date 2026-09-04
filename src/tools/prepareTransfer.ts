import { submitIntent } from '../wallet/requestLifecycle.js';

export interface PrepareTransferInput {
  to: string;
  amount: string; // in ether or token units, e.g. "0.05"
  chain?: string; // default eip155:8453 (Base)
  asset?: string; // default ETH
  data?: string;
  walletAddress?: string;
  walletId?: string;
}

// In-memory spend counter for tests/offline
export const inMemoryDailySpend = new Map<string, bigint>();

export async function prepareTransfer(
  ctx: any,
  args: PrepareTransferInput
) {
  return await submitIntent(ctx, 'nv_prepare_transfer', args as any);
}
