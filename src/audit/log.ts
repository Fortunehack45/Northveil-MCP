import { supabase } from '../supabase.js';

export interface AuditLogEntry {
  userId?: string;
  walletAddress?: string;
  clientId?: string;
  action: string;
  details?: Record<string, any>;
}

// In-memory audit log for inspection during testing
export const inMemoryAuditLogs: Array<AuditLogEntry & { timestamp: Date }> = [];

/**
 * Persists an audit log event.
 * Sanitizes details to ensure no private keys or secrets are ever recorded.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  const sanitizedDetails = { ...(entry.details || {}) };
  delete sanitizedDetails.privateKey;
  delete sanitizedDetails.seedPhrase;
  delete sanitizedDetails.mnemonic;
  delete sanitizedDetails.secret;
  delete sanitizedDetails.clientKey;

  const now = new Date();
  inMemoryAuditLogs.push({
    ...entry,
    details: sanitizedDetails,
    timestamp: now,
  });

  try {
    await supabase.from('audit_logs').insert({
      user_id: entry.userId || null,
      wallet_address: entry.walletAddress || null,
      client_id: entry.clientId || null,
      action: entry.action,
      details: sanitizedDetails,
      created_at: now.toISOString(),
    });
  } catch (err) {
    console.warn('[Audit] Failed to persist audit log to DB:', err);
  }
}
