/**
 * Northveil Deploy Token Tool (ERC-20 and SPL)
 * Section 21 & 26 of Implementation Specification
 */

import { ToolContext } from '../auth/resolveContext.js';
import { createApproval } from '../wallet/approvals.js';
import { canonicalPayloadHash } from '../policy/grantEngine.js';

export interface TokenomicsItem {
  label: string;
  percent: number;
  wallet?: string;
}

export interface PrepareDeployTokenArgs {
  name: string;
  symbol: string;
  decimals?: number;
  totalSupply: string;
  network?: string;
  imageUrl?: string;
  tokenomics?: TokenomicsItem[];
  mintable?: boolean;
  owner?: string;
}

export async function prepareDeployToken(ctx: ToolContext, args: PrepareDeployTokenArgs) {
  // 1. Validate Image URL if provided: MUST be https://
  if (args.imageUrl) {
    if (!args.imageUrl.startsWith('https://')) {
      throw new Error('Image URL must use secure HTTPS protocol (https://)');
    }
  }

  // 2. Validate Tokenomics: if present, percentages MUST sum to exactly 100
  if (args.tokenomics && args.tokenomics.length > 0) {
    const totalPercent = args.tokenomics.reduce((sum, item) => sum + item.percent, 0);
    if (totalPercent !== 100) {
      throw new Error(`Tokenomics allocation percentages must sum to exactly 100 (received ${totalPercent})`);
    }
  }

  const network = args.network || 'base';
  const owner = args.owner || ctx.wallet.address;
  const decimals = args.decimals ?? 18;

  // Standard OpenZeppelin ERC-20 template creation bytecode stub
  const deployBytecode = '0x608060405234801561001057600080fd5b50610120806100206000396000f3fe';

  const unsignedTx = {
    to: '0x0000000000000000000000000000000000000000', // contract creation
    value: '0',
    data: deployBytecode,
    chainId: network === 'base' ? 8453 : 1,
    nonce: 0,
    gasLimit: '1500000',
    maxFeePerGas: '1000000000',
    maxPriorityFeePerGas: '100000000',
  };

  const payloadHash = canonicalPayloadHash({
    chain: network,
    to: unsignedTx.to,
    valueWei: '0',
    data: unsignedTx.data,
    nonce: 0,
  });

  const preview = {
    action: 'deploy_token',
    name: args.name,
    symbol: args.symbol,
    decimals,
    totalSupply: args.totalSupply,
    network,
    owner,
    imageUrl: args.imageUrl || null,
    tokenomics: args.tokenomics || null,
    mintable: args.mintable ?? false,
  };

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
    summaryMarkdown: `### Deploy Token: ${args.name} ($${args.symbol})
- **Network**: \`${network}\`
- **Total Supply**: \`${args.totalSupply}\`
- **Decimals**: \`${decimals}\`
- **Owner**: \`${owner}\`
- **Image**: ${args.imageUrl || 'None'}
- **Passkey Confirmation**: Required at [Approve Deploy](https://wallet.northveil.xyz/approve/${approval.id})`,
  };
}
