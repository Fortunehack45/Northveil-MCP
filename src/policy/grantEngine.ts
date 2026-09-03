import { createHash } from 'node:crypto';

export type Mode = 'always_ask' | 'autonomous';

export interface Grant {
  clientId: string;
  walletAddresses: string[]; // lowercase
  chains: string[];          // e.g. ["eip155:8453"]
  allowedAssets: string[];   // ["ETH", "USDC"] or ["*"]
  allowedRecipients: string[] | '*';
  maxWeiPerTx: bigint;
  maxWeiPerDay: bigint;
  mode: Mode;
  expiresAt: Date;
  revoked: boolean;
}

export interface Intent {
  walletAddress: string;
  chain: string;
  to: string;
  valueWei: bigint;
  asset: string;
  data: string; // 0x
  spentWeiToday: bigint;
}

export type Decision =
  | { type: 'deny'; reason: string }
  | { type: 'ask'; reason: string }
  | { type: 'allow_autonomous'; reason: string };

/**
 * Evaluates whether an agent's intended operation conforms to the user-authorized grant.
 * Server-side policy engine: untrusted models cannot bypass these rules.
 */
export function evaluateGrant(grant: Grant, intent: Intent, now = new Date()): Decision {
  if (grant.revoked) return { type: 'deny', reason: 'client_revoked' };
  if (now > grant.expiresAt) return { type: 'deny', reason: 'grant_expired' };
  
  const normalizedWalletAddresses = grant.walletAddresses.map(a => a.toLowerCase());
  if (!normalizedWalletAddresses.includes(intent.walletAddress.toLowerCase())) {
    return { type: 'deny', reason: 'wallet_not_in_grant' };
  }
  
  if (!grant.chains.includes(intent.chain)) {
    return { type: 'deny', reason: 'chain_not_allowed' };
  }
  
  if (!grant.allowedAssets.includes('*') && !grant.allowedAssets.includes(intent.asset)) {
    return { type: 'deny', reason: 'asset_not_allowed' };
  }
  
  if (grant.allowedRecipients !== '*') {
    const recipients = grant.allowedRecipients.map(r => r.toLowerCase());
    if (!recipients.includes(intent.to.toLowerCase())) {
      return { type: 'ask', reason: 'recipient_not_preauthorized' };
    }
  }
  
  if (intent.valueWei > grant.maxWeiPerTx) {
    return { type: 'ask', reason: 'over_per_tx_limit' };
  }
  
  if (intent.spentWeiToday + intent.valueWei > grant.maxWeiPerDay) {
    return { type: 'deny', reason: 'over_daily_limit' };
  }
  
  if (intent.data !== '0x' && grant.mode === 'autonomous') {
    return { type: 'ask', reason: 'calldata_requires_human_review' };
  }
  
  if (grant.mode === 'always_ask') return { type: 'ask', reason: 'mode_always_ask' };
  
  return { type: 'allow_autonomous', reason: 'within_grant' };
}

/**
 * Computes deterministic SHA-256 hash over canonical transaction properties.
 * Binds the passkey challenge cryptographically to the exact transaction bytes.
 */
export function canonicalPayloadHash(input: {
  chain: string;
  to: string;
  valueWei: string;
  data: string;
  nonce: number;
}): string {
  const canonical = JSON.stringify({
    chain: input.chain,
    to: input.to.toLowerCase(),
    valueWei: input.valueWei,
    data: (input.data || '0x').toLowerCase(),
    nonce: input.nonce,
  });
  return '0x' + createHash('sha256').update(canonical).digest('hex');
}
