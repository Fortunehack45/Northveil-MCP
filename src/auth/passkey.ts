import crypto from 'node:crypto';
import { supabase } from '../supabase.js';
import { SESSION_SECRET } from './session.js';

let simpleWebAuthnPromise: Promise<typeof import('@simplewebauthn/server')> | null = null;

async function getSimpleWebAuthn() {
  if (!simpleWebAuthnPromise) {
    simpleWebAuthnPromise = import('@simplewebauthn/server');
  }
  return simpleWebAuthnPromise;
}

export function getRpId(hostname?: string): string {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return hostname;
  return process.env.WEBAUTHN_RP_ID || 'northveil.xyz';
}

export function allowedOrigins(): string[] {
  const extra = (process.env.WEBAUTHN_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    'https://wallet.northveil.xyz',
    'https://northveil.xyz',
    'https://www.northveil.xyz',
    'https://apex.northveil.xyz',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://localhost:8080',
    ...extra,
  ];
}

export function asWebAuthnCredentialJSON(body: any) {
  const raw = body?.response ?? body?.credential ?? body;
  if (raw?.response?.clientDataJSON) return raw;
  if (raw?.response?.response?.clientDataJSON) return raw.response;
  throw new Error('PASSKEY_RESPONSE_MALFORMED');
}

export interface StoredAuthenticator {
  credentialID: Uint8Array;
  credentialPublicKey: Uint8Array;
  counter: number;
  transports?: string[];
}

// In-memory fallback challenge store for offline / local testing
interface StoredChallenge {
  challenge: string;
  userId?: string;
  expiresAt: number;
}

export const challengeStore = new Map<string, StoredChallenge>();

export function signChallengeToken(challenge: string, userId?: string | null): string {
  const secret = SESSION_SECRET || 'northveil-default-webauthn-secret';
  const payload = JSON.stringify({
    c: challenge,
    u: userId || null,
    exp: Date.now() + 5 * 60 * 1000,
  });
  const b64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyChallengeToken(token?: string | null): { challenge: string; userId?: string | null } | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;

  const secret = SESSION_SECRET || 'northveil-default-webauthn-secret';
  const expectedSig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!payload.c || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return null;
    }
    return { challenge: payload.c, userId: payload.u };
  } catch {
    return null;
  }
}

const isHostedOrProd = Boolean(
  process.env.VERCEL ||
  process.env.NODE_ENV === 'production' ||
  process.env.NORTHVEIL_HOSTED === '1'
);

export async function saveWebauthnChallenge(opts: {
  userId?: string | null;
  kind: 'reg' | 'auth';
  challenge: string;
  ttlMs?: number;
}): Promise<void> {
  const ttl = opts.ttlMs || 5 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  try {
    const { error } = await supabase.from('webauthn_challenges').insert({
      user_id: opts.userId || null,
      kind: opts.kind,
      challenge: opts.challenge,
      expires_at: expiresAt,
    });
    if (error) {
      console.error('[Northveil] webauthn_challenges Supabase write failed:', error.message, error.code, error.details);
    }
  } catch (err: any) {
    console.error('[Northveil] webauthn_challenges Supabase write failed:', err?.message, err?.code, err?.details);
  }

  // Only use in-memory store in genuine local dev (never across serverless/hosted instances)
  if (!isHostedOrProd) {
    const storeEntry: StoredChallenge = {
      challenge: opts.challenge,
      userId: opts.userId || undefined,
      expiresAt: Date.now() + ttl,
    };
    challengeStore.set(`${opts.kind}_${opts.challenge}`, storeEntry);
    challengeStore.set(`raw_${opts.challenge}`, storeEntry);
    if (opts.userId) {
      challengeStore.set(`${opts.kind}_${opts.userId}`, storeEntry);
    }
  }
}

export async function consumeWebauthnChallenge(opts: {
  userId?: string | null;
  kind: 'reg' | 'auth';
  challenge?: string;
}): Promise<string | null> {
  const now = new Date().toISOString();
  try {
    let query = supabase
      .from('webauthn_challenges')
      .select('id, challenge, user_id')
      .eq('kind', opts.kind)
      .gt('expires_at', now)
      .order('created_at', { ascending: false });

    if (opts.challenge) {
      query = query.eq('challenge', opts.challenge);
    } else if (opts.userId) {
      query = query.eq('user_id', opts.userId);
    }

    const { data, error } = await query.limit(1);
    if (error) {
      console.error('[Northveil] consumeWebauthnChallenge Supabase select error:', error.message, error.code, error.details);
    }
    if (!error && data && data.length > 0) {
      const match = data[0];
      await supabase.from('webauthn_challenges').delete().eq('id', match.id);
      return match.challenge;
    }
  } catch (err: any) {
    console.error('[Northveil] consumeWebauthnChallenge DB error:', err?.message, err?.code, err?.details);
  }

  // Only fall back to in-memory store in local dev
  if (!isHostedOrProd) {
    const keys = [
      `raw_${opts.challenge || ''}`,
      `${opts.kind}_${opts.challenge || ''}`,
      `auth_raw_${opts.challenge || ''}`,
      `auth_${opts.challenge || ''}`,
      `${opts.kind}_${opts.userId || ''}`,
      `auth_${opts.userId || ''}`,
      `reg_${opts.userId || ''}`,
    ];
    for (const k of keys) {
      if (!k || k === 'raw_' || k.endsWith('_')) continue;
      const stored = challengeStore.get(k);
      if (stored && stored.expiresAt > Date.now()) {
        challengeStore.delete(k);
        return stored.challenge;
      }
    }
  }
  return null;
}

export function pruneExpiredChallenges(): void {
  const now = Date.now();
  for (const [key, val] of challengeStore.entries()) {
    if (val.expiresAt < now) {
      challengeStore.delete(key);
    }
  }
}

/**
 * Generates WebAuthn registration options for a user
 */
export async function generatePasskeyRegistrationOptions(opts: {
  userId: string;
  userName: string;
  userDisplayName?: string;
  rpID?: string;
  hostname?: string;
}) {
  const { generateRegistrationOptions } = await getSimpleWebAuthn();
  const effectiveRpId = getRpId(opts.hostname || opts.rpID);

  const options = await generateRegistrationOptions({
    rpName: 'Northveil',
    rpID: effectiveRpId,
    userID: new TextEncoder().encode(opts.userId),
    userName: opts.userName,
    userDisplayName: opts.userDisplayName || opts.userName,
    attestationType: 'none',
    timeout: 120_000,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
  });

  await saveWebauthnChallenge({
    userId: opts.userId,
    kind: 'reg',
    challenge: options.challenge,
  });

  const challengeToken = signChallengeToken(options.challenge, opts.userId);

  return {
    ...options,
    challengeToken,
  };
}

/**
 * Generates WebAuthn authentication/login options
 */
export async function generatePasskeyLoginOptions(opts?: {
  userId?: string;
  rpID?: string;
  hostname?: string;
}) {
  const { generateAuthenticationOptions } = await getSimpleWebAuthn();
  const effectiveRpId = getRpId(opts?.hostname || opts?.rpID);

  const options = await generateAuthenticationOptions({
    rpID: effectiveRpId,
    userVerification: 'preferred',
    timeout: 120_000,
  });

  await saveWebauthnChallenge({
    userId: opts?.userId,
    kind: 'auth',
    challenge: options.challenge,
  });

  const challengeToken = signChallengeToken(options.challenge, opts?.userId);

  return {
    ...options,
    challengeToken,
  };
}

/**
 * Verifies WebAuthn passkey registration response from navigator.credentials.create()
 */
export async function verifyPasskeyRegistration(opts: {
  response: any;
  expectedChallenge: string;
  rpID?: string;
  origin?: string;
  hostname?: string;
}) {
  const { verifyRegistrationResponse } = await getSimpleWebAuthn();
  const effectiveRpId = getRpId(opts.hostname || opts.rpID);
  const origins = allowedOrigins();

  const verifyOpts = {
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: origins,
    expectedRPID: effectiveRpId,
    requireUserVerification: false,
  };

  const verification = await verifyRegistrationResponse(verifyOpts as any);
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('PASSKEY_REGISTRATION_FAILED');
  }

  const regInfo = verification.registrationInfo as any;
  const credential = regInfo.credential || {};
  const publicKey = credential.publicKey || regInfo.credentialPublicKey;
  const counter = credential.counter ?? regInfo.counter ?? 0;

  return {
    verified: true,
    credentialId: typeof credential.id === 'string' ? credential.id : Buffer.from(credential.id || '').toString('base64url'),
    credentialPublicKey: Buffer.from(publicKey || []),
    counter: Number(counter),
  };
}

/**
 * Verifies WebAuthn passkey login/assertion response from navigator.credentials.get()
 */
export async function verifyPasskeyLogin(opts: {
  response: any;
  expectedChallenge: string;
  storedAuthenticator: StoredAuthenticator;
  rpID?: string;
  origin?: string;
  hostname?: string;
}) {
  const { verifyAuthenticationResponse } = await getSimpleWebAuthn();
  const effectiveRpId = getRpId(opts.hostname || opts.rpID);
  const origins = allowedOrigins();

  const credIDStr =
    typeof opts.storedAuthenticator.credentialID === 'string'
      ? opts.storedAuthenticator.credentialID
      : Buffer.from(opts.storedAuthenticator.credentialID).toString('base64url');
  const pubKeyBytes = new Uint8Array(opts.storedAuthenticator.credentialPublicKey);
  const counterVal = Number(opts.storedAuthenticator.counter || 0);

  const verifyOpts = {
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: origins,
    expectedRPID: effectiveRpId,
    credential: {
      id: credIDStr,
      publicKey: pubKeyBytes,
      counter: counterVal,
    },
    authenticator: {
      credentialID: opts.storedAuthenticator.credentialID,
      credentialPublicKey: opts.storedAuthenticator.credentialPublicKey,
      counter: counterVal,
    },
    requireUserVerification: false,
  };

  const result = await verifyAuthenticationResponse(verifyOpts as any);
  if (!result.verified) {
    throw new Error('PASSKEY_REJECTED');
  }

  return {
    verified: true,
    newCounter: result.authenticationInfo.newCounter,
  };
}

/**
 * Verifies WebAuthn passkey assertion cryptographically bound to transaction payload hash.
 * Challenge MUST commit to payloadHash (e.g. base64url(payloadHash)).
 */
export async function verifyPasskeyForPayload(opts: {
  response: any;
  expectedChallenge: string; // base64url(payloadHash)
  rpID?: string;
  origin?: string;
  storedAuthenticator: StoredAuthenticator;
}) {
  return verifyPasskeyLogin(opts);
}

/**
 * Unpacks credential public key from any stored format (Postgres bytea hex \x...,
 * JSON-serialized Buffer {type: 'Buffer', data: [...]}, string, Buffer, or array)
 * into a clean COSE Key binary Buffer.
 */
export function unpackCredentialPublicKey(raw: any): Buffer {
  if (!raw) return Buffer.alloc(0);

  // If it's already an object with data array: { type: 'Buffer', data: [...] }
  if (typeof raw === 'object' && !Buffer.isBuffer(raw) && Array.isArray(raw.data)) {
    return Buffer.from(raw.data);
  }

  // If it's a string
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('\\x')) {
      const bufFromHex = Buffer.from(s.slice(2), 'hex');
      try {
        const asStr = bufFromHex.toString('utf8');
        if (asStr.startsWith('{') && asStr.includes('"data"')) {
          const parsed = JSON.parse(asStr);
          if (Array.isArray(parsed.data)) return Buffer.from(parsed.data);
        }
      } catch {}
      return bufFromHex;
    }
    if (s.startsWith('{')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed.data)) return Buffer.from(parsed.data);
      } catch {}
    }
    // Hex string check
    if (/^[0-9a-fA-F]+$/.test(s)) {
      return Buffer.from(s, 'hex');
    }
    return Buffer.from(s, 'base64');
  }

  // If it's a Buffer
  if (Buffer.isBuffer(raw)) {
    try {
      const asStr = raw.toString('utf8');
      if (asStr.startsWith('\\x')) {
        return unpackCredentialPublicKey(asStr);
      }
      if (asStr.startsWith('{') && asStr.includes('"data"')) {
        const parsed = JSON.parse(asStr);
        if (Array.isArray(parsed.data)) return Buffer.from(parsed.data);
      }
    } catch {}
    return raw;
  }

  return Buffer.from(raw);
}

/**
 * Saves registered passkey credential to Supabase public.passkeys
 */
export async function savePasskeyRecord(opts: {
  userId: string;
  credentialId: string;
  credentialPublicKey: Buffer;
  counter: number;
  transports?: string[];
  walletIds?: string[];
}): Promise<void> {
  try {
    const rawKey = opts.credentialPublicKey;
    const hexKey = `\\x${rawKey.toString('hex')}`;
    const { error } = await supabase.from('passkeys').insert({
      user_id: opts.userId,
      credential_id: opts.credentialId,
      credential_public_key: hexKey,
      counter: opts.counter,
      transports: opts.transports || [],
      wallet_ids: opts.walletIds || [],
      last_used_at: new Date().toISOString(),
    });
    if (error) {
      console.error('[Northveil] savePasskeyRecord Supabase insert error:', error.message, error.code, error.details);
    }
  } catch (err: any) {
    console.error('[Northveil] savePasskeyRecord error:', err?.message);
  }
}

/**
 * Retrieves stored passkey for credential ID
 */
export async function findPasskeyByCredentialId(credentialId: string): Promise<{
  id: string;
  user_id: string;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  wallet_ids?: string[];
} | null> {
  try {
    const { data, error } = await supabase
      .from('passkeys')
      .select('*')
      .eq('credential_id', credentialId)
      .maybeSingle();

    if (error) {
      console.error('[Northveil] findPasskeyByCredentialId Supabase error:', error.message, error.code);
    }

    if (data) {
      return {
        id: data.id,
        user_id: data.user_id,
        credential_id: data.credential_id,
        credential_public_key: unpackCredentialPublicKey(data.credential_public_key),
        counter: Number(data.counter || 0),
        wallet_ids: data.wallet_ids || [],
      };
    }
  } catch (err: any) {
    console.error('[Northveil] findPasskeyByCredentialId unexpected error:', err?.message);
  }

  return null;
}
