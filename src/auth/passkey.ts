import { supabase } from '../supabase.js';

let simpleWebAuthnPromise: Promise<typeof import('@simplewebauthn/server')> | null = null;

async function getSimpleWebAuthn() {
  if (!simpleWebAuthnPromise) {
    simpleWebAuthnPromise = import('@simplewebauthn/server');
  }
  return simpleWebAuthnPromise;
}

const defaultRpID = process.env.WEBAUTHN_RP_ID || 'wallet.northveil.xyz';
const defaultOrigin = process.env.WEBAUTHN_ORIGIN || 'https://wallet.northveil.xyz';

export interface StoredAuthenticator {
  credentialID: Uint8Array;
  credentialPublicKey: Uint8Array;
  counter: number;
  transports?: string[];
}

// Challenge store with TTL (5 minutes)
interface StoredChallenge {
  challenge: string;
  userId?: string;
  expiresAt: number;
}

export const challengeStore = new Map<string, StoredChallenge>();

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
}) {
  const { generateRegistrationOptions } = await getSimpleWebAuthn();
  pruneExpiredChallenges();

  const options = await generateRegistrationOptions({
    rpName: 'Northveil',
    rpID: opts.rpID || defaultRpID,
    userID: Buffer.from(opts.userId, 'utf-8'),
    userName: opts.userName,
    userDisplayName: opts.userDisplayName || opts.userName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });

  // Save challenge keyed by userId
  challengeStore.set(`reg_${opts.userId}`, {
    challenge: options.challenge,
    userId: opts.userId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return options;
}

/**
 * Generates WebAuthn authentication/login options
 */
export async function generatePasskeyLoginOptions(opts?: {
  userId?: string;
  rpID?: string;
}) {
  const { generateAuthenticationOptions } = await getSimpleWebAuthn();
  pruneExpiredChallenges();

  const options = await generateAuthenticationOptions({
    rpID: opts?.rpID || defaultRpID,
    userVerification: 'required',
  });

  const key = opts?.userId ? `auth_${opts.userId}` : `auth_challenge_${options.challenge}`;
  challengeStore.set(key, {
    challenge: options.challenge,
    userId: opts?.userId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  // Also index by raw challenge so finish can look it up even without userId upfront
  challengeStore.set(`auth_raw_${options.challenge}`, {
    challenge: options.challenge,
    userId: opts?.userId,
    expiresAt: Date.now() + 5 * 60 * 1000,
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
}) {
  const { verifyRegistrationResponse } = await getSimpleWebAuthn();

  const verifyOpts = {
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: opts.origin || defaultOrigin,
    expectedRPID: opts.rpID || defaultRpID,
    requireUserVerification: true,
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
}) {
  const { verifyAuthenticationResponse } = await getSimpleWebAuthn();

  const verifyOpts = {
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: opts.origin || defaultOrigin,
    expectedRPID: opts.rpID || defaultRpID,
    authenticator: {
      credentialID: opts.storedAuthenticator.credentialID,
      credentialPublicKey: opts.storedAuthenticator.credentialPublicKey,
      counter: opts.storedAuthenticator.counter,
    },
    requireUserVerification: true,
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
