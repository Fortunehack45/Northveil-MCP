import crypto from 'node:crypto';
import { supabase } from '../supabase.js';
import { signSessionToken } from './session.js';
import { HttpError } from './resolveContext.js';

export const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_ATTEMPTS = 5;

// In-memory rate limiting tracking
interface RateLimitBucket {
  timestamps: number[];
}

const emailAttempts = new Map<string, RateLimitBucket>();
const ipAttempts = new Map<string, RateLimitBucket>();

function pruneBucket(bucket: RateLimitBucket, windowMs: number) {
  const cutoff = Date.now() - windowMs;
  bucket.timestamps = bucket.timestamps.filter(ts => ts > cutoff);
}

export function checkEmailRateLimit(email: string): boolean {
  const norm = email.toLowerCase().trim();
  let bucket = emailAttempts.get(norm);
  if (!bucket) {
    bucket = { timestamps: [] };
    emailAttempts.set(norm, bucket);
  }
  pruneBucket(bucket, 15 * 60 * 1000); // 15-minute window
  if (bucket.timestamps.length >= 3) {
    return false; // Max 3 codes / email / 15 min
  }
  bucket.timestamps.push(Date.now());
  return true;
}

export function checkIpRateLimit(ip: string): boolean {
  if (!ip) return true;
  let bucket = ipAttempts.get(ip);
  if (!bucket) {
    bucket = { timestamps: [] };
    ipAttempts.set(ip, bucket);
  }
  pruneBucket(bucket, 60 * 60 * 1000); // 1-hour window
  if (bucket.timestamps.length >= 10) {
    return false; // Max 10 / IP / hour
  }
  bucket.timestamps.push(Date.now());
  return true;
}

export function resetRateLimitsForTesting() {
  emailAttempts.clear();
  ipAttempts.clear();
}

/**
 * Calculates a salted SHA-256 hash of an OTP code for an email
 */
export function hashOtp(email: string, code: string): string {
  const pepper = process.env.OTP_PEPPER || process.env.SESSION_SECRET || (process.env.NODE_ENV !== 'production' ? 'northveil-dev-pepper' : '');
  if (!pepper) {
    throw new Error('OTP_PEPPER required');
  }
  return crypto
    .createHash('sha256')
    .update(`${email.toLowerCase().trim()}:${code}:${pepper}`)
    .digest('hex');
}

/**
 * Generates a secure random 6-digit numeric verification code
 */
export function randomCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Sends the verification code via email provider (e.g. Resend)
 */
export async function sendEmailCode(email: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Northveil <auth@northveil.xyz>';

  if (!apiKey) {
    console.info(`[Northveil Email OTP] No RESEND_API_KEY configured. Code for ${email}: ${code}`);
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Your Northveil Verification Code',
        text: `Your 6-digit Northveil verification code is: ${code}\n\nThis code expires in 5 minutes.\nIf you did not request this, please ignore this email.`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #09090b; color: #f4f4f5; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="text-align: center; margin-bottom: 24px;">
              <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 8px 0; color: #ffffff;">Northveil Verification</h2>
              <p style="font-size: 13px; color: #a1a1aa; margin: 0;">Non-Custodial Agent Wallet & Control Plane</p>
            </div>
            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px;">
              <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #3b82f6;">${code}</span>
            </div>
            <p style="font-size: 12px; color: #71717a; text-align: center; margin: 0;">
              This code will expire in <strong>5 minutes</strong>. One use only. Never share this code with anyone.
            </p>
          </div>
        `,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[Northveil Email OTP] Resend dispatch failed:', res.status, errBody);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[Northveil Email OTP] Resend dispatch warning:', err.message);
    return false;
  }
}

/**
 * Counts enrolled passkeys for a user
 */
export async function countPasskeys(userId: string): Promise<number> {
  const { count, data, error } = await supabase
    .from('passkeys')
    .select('*', { count: 'exact' })
    .eq('user_id', userId);
  if (error) {
    console.warn('[Northveil OTP] countPasskeys error:', error.message);
    return 0;
  }
  return typeof count === 'number' ? count : (data?.length || 0);
}

/**
 * Counts active MPC wallets for a user
 */
export async function countWallets(userId: string): Promise<number> {
  const { count, data, error } = await supabase
    .from('wallets')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) {
    console.warn('[Northveil OTP] countWallets error:', error.message);
    return 0;
  }
  return typeof count === 'number' ? count : (data?.length || 0);
}

/**
 * Determines the next onboarding / authentication screen based on user account state
 */
export async function nextStep(userId: string): Promise<'unlock_passkey' | 'enroll_passkey' | 'create_or_import'> {
  const [passkeys, wallets] = await Promise.all([countPasskeys(userId), countWallets(userId)]);
  if (wallets > 0 && passkeys > 0) return 'unlock_passkey';
  if (passkeys === 0) return 'enroll_passkey';
  return 'create_or_import';
}

/**
 * Canonical identity upsert merging Google and email identities into a single user row
 */
export async function upsertIdentity(opts: {
  email: string;
  googleSub?: string;
  name?: string;
  avatarUrl?: string;
}) {
  const email = opts.email.trim().toLowerCase();

  const { data: byEmail } = await supabase.from("users").select("*").ilike("email", email).maybeSingle();
  const { data: bySub } = opts.googleSub
    ? await supabase.from("users").select("*").eq("google_sub", opts.googleSub).maybeSingle()
    : { data: null };

  if (byEmail && bySub && byEmail.id !== bySub.id) {
    await supabase.from("wallets").update({ user_id: byEmail.id }).eq("user_id", bySub.id);
    await supabase.from("passkeys").update({ user_id: byEmail.id }).eq("user_id", bySub.id);
    await supabase.from("agent_clients").update({ user_id: byEmail.id }).eq("user_id", bySub.id);
    await supabase.from("users").delete().eq("id", bySub.id);
    await supabase.from("users").update({
      google_sub: opts.googleSub,
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      name: opts.name ?? byEmail.name,
      avatar_url: opts.avatarUrl ?? byEmail.avatar_url,
      last_login_at: new Date().toISOString(),
    }).eq("id", byEmail.id);
    return { ...byEmail, google_sub: opts.googleSub };
  }

  if (byEmail) {
    await supabase.from("users").update({
      google_sub: opts.googleSub ?? byEmail.google_sub,
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
      name: opts.name ?? byEmail.name,
      avatar_url: opts.avatarUrl ?? byEmail.avatar_url,
    }).eq("id", byEmail.id);
    return byEmail;
  }

  if (bySub) {
    await supabase.from("users").update({
      email,
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
      name: opts.name ?? bySub.name,
      avatar_url: opts.avatarUrl ?? bySub.avatar_url,
    }).eq("id", bySub.id);
    return { ...bySub, email };
  }

  const { data: created, error } = await supabase.from("users").insert({
    email,
    google_sub: opts.googleSub ?? null,
    name: opts.name ?? null,
    avatar_url: opts.avatarUrl ?? null,
    email_verified: true,
    email_verified_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }).select("*").single();

  if (error) throw error;
  return created;
}

/**
 * Upserts a user by verified email address
 */
export async function upsertUserByEmail(email: string) {
  return upsertIdentity({ email });
}

/**
 * Starts Email OTP Flow
 */
export async function startEmailOtp(email: string, clientIp?: string): Promise<{ ok: boolean; devCode?: string }> {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new HttpError(400, 'INVALID_EMAIL');
  }
  const normEmail = email.toLowerCase().trim();

  // 1. Rate Limiting
  if (!checkEmailRateLimit(normEmail)) {
    throw new HttpError(429, 'RATE_LIMIT_EXCEEDED: Max 3 codes per 15 minutes');
  }
  if (clientIp && !checkIpRateLimit(clientIp)) {
    throw new HttpError(429, 'RATE_LIMIT_EXCEEDED: Max 10 requests per hour');
  }

  // 2. Invalidate previous unused codes for this email
  await supabase
    .from('email_otp')
    .update({ consumed_at: new Date().toISOString() })
    .eq('email', normEmail)
    .is('consumed_at', null);

  // 3. Generate and hash code with 5-minute expiry
  const code = randomCode();
  const code_hash = hashOtp(normEmail, code);
  const expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();

  const { error: insertError } = await supabase.from('email_otp').insert({
    email: normEmail,
    code_hash,
    expires_at,
    attempt_count: 0,
  });

  if (insertError) {
    throw new HttpError(500, `OTP_PERSISTENCE_FAILED: ${insertError.message}`);
  }

  // 4. Send email
  const apiKey = process.env.RESEND_API_KEY;
  const emailSent = await sendEmailCode(normEmail, code);

  const shouldEcho = !apiKey || !emailSent || process.env.NODE_ENV !== 'production';
  return {
    ok: true,
    ...(shouldEcho
      ? {
          devCode: code,
          deliveryNotice: !apiKey
            ? 'RESEND_API_KEY is not configured in Vercel. Code is provided directly.'
            : 'Resend dispatch failed. Code is provided directly.',
        }
      : {}),
  };
}

/**
 * Verifies Email OTP Code
 */
export async function verifyEmailOtp(email: string, code: string): Promise<{
  sessionToken: string;
  next: 'unlock_passkey' | 'enroll_passkey' | 'create_or_import';
  user: any;
}> {
  if (!email || !code) {
    throw new HttpError(400, 'EMAIL_AND_CODE_REQUIRED');
  }
  const normEmail = email.toLowerCase().trim();
  const cleanCode = String(code).trim();

  // 1. Fetch latest OTP row for this email
  const { data: row, error } = await supabase
    .from('email_otp')
    .select('*')
    .eq('email', normEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !row) {
    throw new HttpError(400, 'OTP_INVALID');
  }

  // 2. Validate consumption status
  if (row.consumed_at) {
    throw new HttpError(400, 'OTP_USED');
  }

  // 3. Validate expiration (Strict 5 minutes)
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError(400, 'OTP_EXPIRED');
  }

  // 4. Validate attempts count (Max 5 attempts)
  if (row.attempt_count >= MAX_ATTEMPTS) {
    throw new HttpError(429, 'OTP_LOCKED');
  }

  // 5. Compare cryptographic hash
  const computedHash = hashOtp(normEmail, cleanCode);
  if (computedHash !== row.code_hash) {
    const newCount = row.attempt_count + 1;
    await supabase
      .from('email_otp')
      .update({ attempt_count: newCount })
      .eq('id', row.id);
    if (newCount >= MAX_ATTEMPTS) {
      throw new HttpError(429, 'OTP_LOCKED');
    }
    throw new HttpError(400, 'OTP_INVALID');
  }

  // 6. Mark consumed
  await supabase
    .from('email_otp')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id);

  // 7. Upsert user and generate session token
  const user = await upsertUserByEmail(normEmail);
  const sessionToken = signSessionToken({ userId: user.id, email: user.email, passkeyOk: false });
  const next = await nextStep(user.id);

  return {
    sessionToken,
    next,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
    },
  };
}
