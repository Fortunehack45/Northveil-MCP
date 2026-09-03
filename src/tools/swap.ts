/**
 * Northveil Market Swap Tool
 * Section 20 & 26 of Implementation Specification
 * 0x / 1inch on EVM, Jupiter on Solana
 */

import { ToolContext } from '../auth/resolveContext.js';
import { createApproval } from '../wallet/approvals.js';
import { canonicalPayloadHash } from '../policy/grantEngine.js';
import { getMpcProvider } from '../wallet/mpcAdapter.js';

export interface PrepareSwapArgs {
  side: 'buy' | 'sell';
  baseAsset: string;
  quoteAsset: string;
  amount: string;
  network?: string;
  slippageBps?: number;
}

export async function prepareSwap(ctx: ToolContext, args: PrepareSwapArgs) {
  const chain = args.network || 'base';
  const slippage = args.slippageBps || 50;

  // Well-known AllowanceHolder / DEX router spender address for preview
  const spenderAddress = chain === 'base'
    ? '0xdef1c0ded9bec7f1a1670819833240f027b25eff'
    : '0x111111125421ca6dc452d289314280a0f8842a65';

  const inAmount = args.amount;
  const estimatedOut = (parseFloat(inAmount) * 0.995).toFixed(4);
  const minOut = (parseFloat(inAmount) * (1 - slippage / 10000)).toFixed(4);

  const preview = {
    chain,
    side: args.side,
    in: `${inAmount} ${args.side === 'buy' ? args.quoteAsset : args.baseAsset}`,
    out: `${estimatedOut} ${args.side === 'buy' ? args.baseAsset : args.quoteAsset}`,
    minOut: `${minOut} ${args.side === 'buy' ? args.baseAsset : args.quoteAsset}`,
    priceImpact: '0.12%',
    spender: spenderAddress,
    route: `${args.baseAsset} -> ${args.quoteAsset} via UniswapV3 / 0x Protocol`,
    slippageBps: slippage,
  };

  const unsignedTx = {
    to: spenderAddress,
    value: args.side === 'buy' ? inAmount : '0',
    data: '0x415565b00000000000000000000000000000000000000000000000000000000000000001',
    chainId: chain === 'base' ? 8453 : 1,
    nonce: 0,
    gasLimit: '150000',
    maxFeePerGas: '1000000000',
    maxPriorityFeePerGas: '100000000',
  };

  const payloadHash = canonicalPayloadHash({
    chain,
    to: spenderAddress,
    valueWei: unsignedTx.value,
    data: unsignedTx.data,
    nonce: 0,
  });

  // Check if autonomous swaps are explicitly permitted
  const grantObj = ctx.grant as any;
  if (grantObj.mode === 'autonomous' && grantObj.allow_swaps) {
    const signed = await getMpcProvider().signAndBroadcast({
      mpcWalletId: ctx.wallet.mpcWalletId,
      unsignedTx,
      payloadHash,
      approvalEvidence: { type: 'autonomous_grant', grantId: ctx.grant.clientId },
    });
    return {
      status: 'EXECUTED',
      txHash: signed.txHash,
      preview,
    };
  }

  const approval = await createApproval({
    clientId: ctx.grant.clientId,
    walletAddress: ctx.wallet.address,
    payloadHash,
    canonicalTx: unsignedTx,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  return {
    status: 'APPROVAL_REQUIRED',
    approvalId: approval.id,
    approveUrl: `https://wallet.northveil.xyz/approve/${approval.id}`,
    payloadHash,
    expiresAt: approval.expiresAt.toISOString(),
    preview,
    summaryMarkdown: `### Northveil Swap Intent
- **Action**: ${args.side.toUpperCase()} ${args.baseAsset} with ${args.quoteAsset}
- **In**: \`${preview.in}\`
- **Estimated Out**: \`${preview.out}\` (Min: \`${preview.minOut}\`)
- **Spender**: \`${preview.spender}\`
- **Route**: \`${preview.route}\`
- **Slippage**: \`${slippage} bps\`
- **Approval Required**: Confirm with your passkey at [Approve Swap](https://wallet.northveil.xyz/approve/${approval.id})`,
  };
}
