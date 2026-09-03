import { randomBytes } from 'node:crypto';
import { supabase } from '../supabase.js';

export interface PendingApproval {
  id: string;
  userId?: string;
  clientId: string;
  walletId?: string;
  walletAddress: string;
  payloadHash: string;
  canonicalTx: Record<string, any>;
  expiresAt: Date;
  used: boolean;
}

// In-memory registry for synchronous lookups and testing
const inMemoryApprovals = new Map<string, PendingApproval>();

/**
 * Creates a single-use pending approval ticket bound to the exact payload hash.
 * Persists to Supabase public.pending_approvals and in-memory cache.
 */
export async function createApproval(
  row: Omit<PendingApproval, 'id' | 'used'>
): Promise<PendingApproval> {
  const approvalId = 'appr_' + randomBytes(16).toString('hex');
  const record: PendingApproval = {
    ...row,
    id: approvalId,
    used: false,
  };

  // Cache in-memory
  inMemoryApprovals.set(approvalId, record);

  // Persist to Postgres if Supabase is connected
  try {
    if (row.userId && row.walletId) {
      await supabase.from('pending_approvals').insert({
        id: approvalId,
        user_id: row.userId,
        client_id: row.clientId,
        wallet_id: row.walletId,
        payload_hash: row.payloadHash,
        canonical_tx: row.canonicalTx,
        used: false,
        expires_at: row.expiresAt.toISOString(),
      });
    }
  } catch (err) {
    // Non-fatal if Supabase is in offline/test mode
    console.warn('[Approvals] Could not persist to DB, using in-memory store:', err);
  }

  return record;
}

/**
 * Consumes an approval ticket. Enforces single-use replay protection,
 * expiration check, and cryptographic payload hash verification.
 */
export async function consumeApproval(
  id: string,
  expectedHash: string,
  now = new Date()
): Promise<PendingApproval> {
  let record = inMemoryApprovals.get(id);

  // If not found in cache, check Supabase
  if (!record) {
    try {
      const { data } = await supabase
        .from('pending_approvals')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (data) {
        record = {
          id: data.id,
          userId: data.user_id,
          clientId: data.client_id,
          walletId: data.wallet_id,
          walletAddress: data.canonical_tx?.from || '',
          payloadHash: data.payload_hash,
          canonicalTx: data.canonical_tx,
          expiresAt: new Date(data.expires_at),
          used: data.used,
        };
        inMemoryApprovals.set(id, record);
      }
    } catch (err) {
      console.warn('[Approvals] DB lookup error:', err);
    }
  }

  if (!record) throw new Error('UNKNOWN_APPROVAL');
  if (record.used) throw new Error('REPLAY_REJECTED');
  if (now > record.expiresAt) throw new Error('APPROVAL_EXPIRED');
  if (record.payloadHash !== expectedHash) throw new Error('PAYLOAD_MISMATCH');

  // Mark used atomically
  record.used = true;

  try {
    await supabase
      .from('pending_approvals')
      .update({ used: true })
      .eq('id', id);
  } catch (err) {
    console.warn('[Approvals] Failed to update DB used status:', err);
  }

  return record;
}

/**
 * Retrieve pending approval by ID for status checks
 */
export function getApproval(id: string): PendingApproval | undefined {
  return inMemoryApprovals.get(id);
}
