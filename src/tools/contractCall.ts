/**
 * Northveil Contract Call Tool
 * Always Ask only
 */

import { ToolContext } from '../auth/resolveContext.js';
import { createApproval } from '../wallet/approvals.js';
import { canonicalPayloadHash } from '../policy/grantEngine.js';

export interface PrepareContractCallArgs {
  to: string;
  data: string;
  value?: string;
  network?: string;
  functionDescription?: string;
}

export async function prepareContractCall(ctx: ToolContext, args: PrepareContractCallArgs) {
  const network = args.network || 'base';
  const to = args.to.toLowerCase();
  const data = args.data.startsWith('0x') ? args.data : `0x${args.data}`;
  const value = args.value || '0';

  const unsignedTx = {
    to,
    value,
    data,
    chainId: network === 'base' ? 8453 : 1,
    nonce: 0,
    gasLimit: '200000',
    maxFeePerGas: '1000000000',
    maxPriorityFeePerGas: '100000000',
  };

  const payloadHash = canonicalPayloadHash({
    chain: network,
    to,
    valueWei: value,
    data,
    nonce: 0,
  });

  const preview = {
    action: 'contract_call',
    to,
    network,
    value,
    functionSelector: data.slice(0, 10),
    dataLength: (data.length - 2) / 2,
    description: args.functionDescription || 'Custom contract invocation',
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
    summaryMarkdown: `### Contract Call to \`${to}\`
- **Network**: \`${network}\`
- **Value**: \`${value} wei\`
- **Selector**: \`${preview.functionSelector}\`
- **Passkey Confirmation**: Required at [Approve Call](https://wallet.northveil.xyz/approve/${approval.id})`,
  };
}
