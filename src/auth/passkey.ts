import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const defaultRpID = process.env.WEBAUTHN_RP_ID || 'wallet.northveil.xyz';
const defaultOrigin = process.env.WEBAUTHN_ORIGIN || 'https://wallet.northveil.xyz';

export interface StoredAuthenticator {
  credentialID: Uint8Array;
  credentialPublicKey: Uint8Array;
  counter: number;
  transports?: string[];
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
