import { supabase } from '../supabase.js';
import { logAudit } from '../audit/log.js';
import { mockGrantsRegistry } from '../auth/resolveContext.js';

export interface SetAutonomousModeInput {
  clientId: string;
  userId: string;
  enabled: boolean;
  maxWeiPerTx?: string;
  maxWeiPerDay?: string;
  chains?: string[];
  allowedAssets?: string[];
  allowedRecipients?: string[];
  allowAnyRecipient?: boolean;
  authorizedByCredentialId?: string; // WebAuthn credential ID from passkey step-up
}

/**
 * Dashboard API helper for toggling autonomous mode on/off.
 * Enabling autonomous mode strictly requires passkey step-up (authorizedByCredentialId).
 */
export async function setAutonomousMode(input: SetAutonomousModeInput) {
  const mode = input.enabled ? 'autonomous' : 'always_ask';
  const now = new Date();

  if (input.enabled && !input.authorizedByCredentialId) {
    throw new Error('STEP_UP_REQUIRED: Enabling autonomous signing requires passkey verification.');
  }

  const updateData: Record<string, any> = {
    mode,
    updated_at: now.toISOString(),
  };

  if (input.enabled) {
    updateData.max_wei_per_tx = input.maxWeiPerTx || '10000000000000000'; // 0.01 ETH default
    updateData.max_wei_per_day = input.maxWeiPerDay || '50000000000000000'; // 0.05 ETH default
    updateData.chains = input.chains || ['eip155:8453'];
    updateData.allowed_assets = input.allowedAssets || ['ETH', 'USDC'];
    updateData.allowed_recipients = input.allowedRecipients || [];
    updateData.allow_any_recipient = input.allowAnyRecipient ?? false;
    updateData.authorized_by_credential_id = input.authorizedByCredentialId;
    updateData.authorized_at = now.toISOString();
  }

  // Update in-memory mock if present
  const mockGrant = mockGrantsRegistry.get(input.clientId);
  if (mockGrant) {
    mockGrant.mode = mode;
    if (input.enabled) {
      mockGrant.maxWeiPerTx = BigInt(updateData.max_wei_per_tx);
      mockGrant.maxWeiPerDay = BigInt(updateData.max_wei_per_day);
      mockGrant.chains = updateData.chains;
      mockGrant.allowedAssets = updateData.allowed_assets;
      mockGrant.allowedRecipients = updateData.allow_any_recipient ? '*' : updateData.allowed_recipients;
    }
  }

  // Update Postgres
  try {
    await supabase
      .from('grants')
      .update(updateData)
      .eq('client_id', input.clientId)
      .eq('user_id', input.userId);
  } catch (err) {
    console.warn('[setAutonomousMode] Failed to persist grant update:', err);
  }

  await logAudit({
    userId: input.userId,
    clientId: input.clientId,
    action: input.enabled ? 'AUTONOMOUS_MODE_ENABLED' : 'AUTONOMOUS_MODE_DISABLED',
    details: { mode, authorizedByCredentialId: input.authorizedByCredentialId },
  });

  return {
    success: true,
    mode,
    timestamp: now.toISOString(),
  };
}
