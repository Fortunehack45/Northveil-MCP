/**
 * Northveil Deploy NFT & Mint Tools
 * Section 22 of Implementation Specification
 */

import { ToolContext } from '../auth/resolveContext.js';
import { createApproval } from '../wallet/approvals.js';
import { canonicalPayloadHash } from '../policy/grantEngine.js';

export interface PrepareDeployNftArgs {
  name: string;
  symbol: string;
  network?: string;
  imageUrl?: string;
  maxSupply?: number;
  royaltyBps?: number;
  description?: string;
}

export async function prepareDeployNft(ctx: ToolContext, args: PrepareDeployNftArgs) {
  if (args.imageUrl && !args.imageUrl.startsWith('https://')) {
    throw new Error('Image URL must use HTTPS protocol');
  }

  const network = args.network || 'base';
  const deployBytecode = '0x608060405234801561001057600080fd5b50610230806100206000396000f3fe';

  const unsignedTx = {
    to: '0x0000000000000000000000000000000000000000',
    value: '0',
    data: deployBytecode,
    chainId: network === 'base' ? 8453 : 1,
    nonce: 0,
    gasLimit: '2500000',
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
    action: 'deploy_nft_collection',
    name: args.name,
    symbol: args.symbol,
    network,
    maxSupply: args.maxSupply || 10000,
    royaltyBps: args.royaltyBps || 500,
    imageUrl: args.imageUrl || null,
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
  };
}

export interface PrepareMintNftArgs {
  contractAddress: string;
  network?: string;
  to?: string;
  tokenUri?: string;
  imageUrl?: string;
}

export async function prepareMintNft(ctx: ToolContext, args: PrepareMintNftArgs) {
  const network = args.network || 'base';
  const recipient = args.to ? args.to.toLowerCase() : ctx.wallet.address.toLowerCase();

  // Mint function selector: safeMint(address,string)
  const data = '0xd2049d48' + recipient.replace('0x', '').padStart(64, '0') + '00'.repeat(32);

  const unsignedTx = {
    to: args.contractAddress,
    value: '0',
    data,
    chainId: network === 'base' ? 8453 : 1,
    nonce: 0,
    gasLimit: '120000',
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
    action: 'mint_nft',
    contractAddress: args.contractAddress,
    recipient,
    network,
    tokenUri: args.tokenUri || args.imageUrl || null,
    isSelfMint: recipient === ctx.wallet.address.toLowerCase(),
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
  };
}

export interface PrepareMintTokenArgs {
  contractAddress: string;
  to: string;
  amount: string;
  network?: string;
}

export async function prepareMintToken(ctx: ToolContext, args: PrepareMintTokenArgs) {
  const network = args.network || 'base';
  const recipient = args.to.toLowerCase();

  // mint(address,uint256) selector: 0x40c10f19
  const data = '0x40c10f19' + recipient.replace('0x', '').padStart(64, '0') + '00'.repeat(32);

  const unsignedTx = {
    to: args.contractAddress,
    value: '0',
    data,
    chainId: network === 'base' ? 8453 : 1,
    nonce: 0,
    gasLimit: '80000',
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
    action: 'mint_token',
    contractAddress: args.contractAddress,
    recipient,
    amount: args.amount,
    network,
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
  };
}
