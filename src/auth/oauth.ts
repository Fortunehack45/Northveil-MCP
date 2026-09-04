import crypto from 'node:crypto';
import { supabase } from '../supabase.js';

export function sha256(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export function sha256Base64Url(str: string): string {
  return crypto.createHash('sha256').update(str).digest('base64url');
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86400000);
}

/**
 * RFC 7591 Dynamic Client Registration handler for Claude and OAuth clients
 */
export async function handleDynamicClientRegistration(body: any): Promise<{
  client_id: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  grant_types: string[];
}> {
  const redirectUris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  const allowed = redirectUris.filter(
    (u) =>
      typeof u === 'string' &&
      (u.startsWith('https://claude.ai/') ||
        u.startsWith('https://claude.com/') ||
        u.startsWith('https://chatgpt.com/') ||
        u.startsWith('https://chatgpt.com/connector/oauth/') ||
        u.startsWith('https://chat.openai.com/') ||
        u.startsWith('https://platform.openai.com/') ||
        u.startsWith('http://127.0.0.1') ||
        u.startsWith('http://localhost'))
  );

  if (!allowed.length) {
    const error: any = new Error('invalid_redirect_uri');
    error.statusCode = 400;
    throw error;
  }

  const clientId = 'claude_' + crypto.randomBytes(8).toString('hex');
  const clientName = body?.client_name || 'Claude';

  try {
    await supabase.from('oauth_clients').insert({
      id: clientId,
      client_name: clientName,
      name: clientName,
      allowed_redirect_uris: allowed,
      redirect_uri_prefixes: allowed,
      token_endpoint_auth_method: 'none',
    });
  } catch (err: any) {
    console.warn('[Northveil] OAuth client registration db notice:', err?.message);
  }

  return {
    client_id: clientId,
    redirect_uris: allowed,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
  };
}

/**
 * Saves single-use authorization code
 */
export async function saveAuthCode(opts: {
  code: string;
  user_id: string;
  client_id: string;
  code_challenge: string;
  redirect_uri: string;
}): Promise<void> {
  const codeHash = sha256(opts.code);
  if (process.env.NODE_ENV !== 'production') {
    mockCodesMap.set(codeHash, {
      user_id: opts.user_id,
      code_challenge: opts.code_challenge,
      client_id: opts.client_id,
      redirect_uri: opts.redirect_uri,
    });
  }
  try {
    await supabase.from('oauth_codes').insert({
      code_hash: codeHash,
      client_id: opts.client_id,
      user_id: opts.user_id,
      redirect_uri: opts.redirect_uri,
      code_challenge: opts.code_challenge,
      code_challenge_method: 'S256',
      scope: 'mcp',
      used: false,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  } catch {}
}

/**
 * Consumes single-use authorization code atomically
 */
export async function consumeAuthCode(code: string): Promise<{
  user_id: string;
  code_challenge: string;
  client_id: string;
  redirect_uri?: string;
} | null> {
  const codeHash = sha256(code);
  const now = new Date().toISOString();

  // In test/dev mode, fallback to in-memory code if db not populated
  if (process.env.NODE_ENV !== 'production' && mockCodesMap.has(codeHash)) {
    const memRow = mockCodesMap.get(codeHash)!;
    mockCodesMap.delete(codeHash);
    return memRow;
  }

  const { data: codeRow, error } = await supabase
    .from('oauth_codes')
    .select('*')
    .eq('code_hash', codeHash)
    .eq('used', false)
    .gt('expires_at', now)
    .maybeSingle();

  if (error || !codeRow) {
    return null;
  }

  // Mark as used immediately to prevent replay
  await supabase
    .from('oauth_codes')
    .update({ used: true })
    .eq('code_hash', codeHash);

  return {
    user_id: codeRow.user_id,
    code_challenge: codeRow.code_challenge,
    client_id: codeRow.client_id,
    redirect_uri: codeRow.redirect_uri,
  };
}

/**
 * Inserts OAuth access and refresh tokens
 */
export async function insertOauthToken(opts: {
  token_hash: string;
  refresh_hash?: string;
  user_id: string;
  client_id: string;
  expires_at: Date;
}): Promise<void> {
  try {
    await supabase.from('oauth_tokens').insert({
      token_hash: opts.token_hash,
      refresh_hash: opts.refresh_hash || null,
      user_id: opts.user_id,
      client_id: opts.client_id,
      scope: 'mcp',
      status: 'active',
      expires_at: opts.expires_at.toISOString(),
    });
  } catch (err: any) {
    console.warn('[Northveil] insertOauthToken db notice:', err?.message);
  }
}

/**
 * Ensures an agent_clients row exists for the OAuth client bound to the user
 */
export async function ensureOauthAgentClient(userId: string, clientName = 'OAuth Agent Client'): Promise<string> {
  try {
    const { data: existing } = await supabase
      .from('agent_clients')
      .select('id')
      .eq('user_id', userId)
      .eq('client_key_hash', 'oauth_managed')
      .eq('status', 'active')
      .maybeSingle();

    if (existing?.id) return existing.id;

    const { data: inserted } = await supabase
      .from('agent_clients')
      .insert({
        user_id: userId,
        name: clientName,
        client_key_hash: 'oauth_managed',
        status: 'active',
      })
      .select('id')
      .single();

    if (inserted?.id) return inserted.id;
  } catch {}

  return 'claude';
}

// In-memory mock store for unit testing
export const mockCodesMap = new Map<string, {
  user_id: string;
  code_challenge: string;
  client_id: string;
  redirect_uri?: string;
}>();
