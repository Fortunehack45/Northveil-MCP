import { supabase } from '../supabase.js';

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
    if (error) throw error;
  } catch (err: any) {
    // In-memory fallback
    challengeStore.set(`${opts.kind}_${opts.userId || opts.challenge}`, {
      challenge: opts.challenge,
      userId: opts.userId || undefined,
      expiresAt: Date.now() + ttl,
    });
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

    if (opts.userId) {
      query = query.eq('user_id', opts.userId);
    }
    if (opts.challenge) {
      query = query.eq('challenge', opts.challenge);
    }

    const { data, error } = await query.limit(1);
    if (!error && data && data.length > 0) {
      const match = data[0];
      await supabase.from('webauthn_challenges').delete().eq('id', match.id);
      return match.challenge;
    }
  } catch {}

  const keys = [
    `${opts.kind}_${opts.userId || ''}`,
    `${opts.kind}_${opts.challenge || ''}`,
    `reg_${opts.userId || ''}`,
    `auth_${opts.userId || ''}`,
    `auth_raw_${opts.challenge || ''}`,
  ];
  for (const k of keys) {
    const stored = challengeStore.get(k);
    if (stored && stored.expiresAt > Date.now()) {
      challengeStore.delete(k);
      return stored.challenge;
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

  return options;
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

  return options;
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
    await supabase.from('passkeys').insert({
      user_id: opts.userId,
      credential_id: opts.credentialId,
      credential_public_key: opts.credentialPublicKey,
      counter: opts.counter,
      transports: opts.transports || [],
      wallet_ids: opts.walletIds || [],
      last_used_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.warn('[Northveil] savePasskeyRecord db notice:', err?.message);
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
    const { data } = await supabase
      .from('passkeys')
      .select('*')
      .eq('credential_id', credentialId)
      .maybeSingle();

    if (data) {
      return {
        id: data.id,
        user_id: data.user_id,
        credential_id: data.credential_id,
        credential_public_key: Buffer.isBuffer(data.credential_public_key)
          ? data.credential_public_key
          : Buffer.from(data.credential_public_key),
        counter: Number(data.counter || 0),
        wallet_ids: data.wallet_ids || [],
      };
    }
  } catch {}

  return null;
}
