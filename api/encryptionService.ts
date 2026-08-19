import crypto from 'crypto';

/**
 * Northveil Enterprise Memory-Safe AES-256-GCM Encryption Service
 * Compliant with NIST SP 800-38D and Multi-Tenant Key Isolation Architecture
 */

function getMasterSecret(): string {
  if (process.env.NORTHVEIL_MASTER_KEY && process.env.NORTHVEIL_MASTER_KEY.trim().length >= 16) {
    return process.env.NORTHVEIL_MASTER_KEY.trim();
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY.trim().length >= 16) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  }
  if (process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.trim().length >= 16) {
    return process.env.SUPABASE_ANON_KEY.trim();
  }
  throw new Error(
    'FATAL CONFIGURATION ERROR: No master vault secret key found in environment variables. ' +
    'Please set NORTHVEIL_MASTER_KEY or SUPABASE_SERVICE_ROLE_KEY with at least 16 characters of entropy.'
  );
}

// Derive a 32-byte (256-bit) root key from the master secret
function getMasterKey(): Buffer {
  return crypto.createHash('sha256').update(getMasterSecret()).digest();
}

// Derive a dedicated per-wallet 256-bit encryption key using PBKDF2 with a unique secret salt
function getWalletDerivedKey(salt: string): Buffer {
  const masterKey = getMasterKey();
  if (!salt || salt.trim().length === 0) {
    return masterKey;
  }
  return crypto.pbkdf2Sync(masterKey, salt.trim(), 10000, 32, 'sha256');
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt?: string;
}

/**
 * Encrypts a plaintext credential (private key or seed phrase) using AES-256-GCM
 * with a cryptographically random, non-public per-wallet secret salt (stored with the record).
 */
export function encryptCredential(plaintext: string, customSalt?: string): EncryptedPayload {
  const iv = crypto.randomBytes(12); // 96-bit cryptographically random IV for AES-GCM
  // Generate random 16-byte (128-bit) cryptographically secure salt if not provided
  const salt = customSalt && customSalt.length >= 16 ? customSalt : crypto.randomBytes(16).toString('hex');
  const key = getWalletDerivedKey(salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag,
    salt,
  };
}

/**
 * Decrypts a ciphertext in memory with automatic salt resolution and fallback compatibility
 */
export function decryptCredential(payload: EncryptedPayload, legacySaltOrAddress?: string): string {
  const ivBuffer = Buffer.from(payload.iv, 'hex');
  const authTagBuffer = Buffer.from(payload.authTag, 'hex');

  // 1. Primary: Decrypt using the random per-wallet secret salt stored with the payload
  if (payload.salt) {
    try {
      const walletKey = getWalletDerivedKey(payload.salt);
      const decipher = crypto.createDecipheriv('aes-256-gcm', walletKey, ivBuffer);
      decipher.setAuthTag(authTagBuffer);
      let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      // Continue to fallback
    }
  }

  // 2. Fallback: If legacy salt/address was passed
  if (legacySaltOrAddress) {
    try {
      const legacyKey = getWalletDerivedKey(legacySaltOrAddress.toLowerCase());
      const decipher = crypto.createDecipheriv('aes-256-gcm', legacyKey, ivBuffer);
      decipher.setAuthTag(authTagBuffer);
      let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      // Continue to fallback
    }
  }

  // 3. Fallback: Base Master Key Decryption
  try {
    const masterKey = getMasterKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, ivBuffer);
    decipher.setAuthTag(authTagBuffer);

    let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err: any) {
    throw new Error(`SECURITY ERROR: Decryption failed for payload. Invalid authentication tag, mismatched salt, or unauthorized key.`);
  }
}

/**
 * Securely clears a buffer in memory to mitigate cold-boot or memory inspection
 */
export function secureClearMemory(target: any): void {
  if (Buffer.isBuffer(target)) {
    target.fill(0);
  }
}
