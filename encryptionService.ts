import crypto from 'crypto';

/**
 * Northveil Memory-Safe AES-256-GCM Encryption Service
 * Compliant with Northveil Custodial Signing Architecture Specification
 */

const MASTER_SECRET = process.env.NORTHVEIL_MASTER_KEY || process.env.SUPABASE_ANON_KEY || 'northveil_production_master_vault_key_2026';

// Derive a 32-byte (256-bit) key using SHA-256
function getMasterKey(): Buffer {
  return crypto.createHash('sha256').update(MASTER_SECRET).digest();
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts a plaintext credential (private key or seed phrase) using AES-256-GCM
 */
export function encryptCredential(plaintext: string): EncryptedPayload {
  const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
  const masterKey = getMasterKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

/**
 * Decrypts a ciphertext in memory and returns the plaintext credential
 */
export function decryptCredential(payload: EncryptedPayload): string {
  const ivBuffer = Buffer.from(payload.iv, 'hex');
  const authTagBuffer = Buffer.from(payload.authTag, 'hex');
  const masterKey = getMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, ivBuffer);
  decipher.setAuthTag(authTagBuffer);

  let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Securely overwrites a string/buffer in memory (best-effort JS garbage collection preparation)
 */
export function secureClearMemory(target: any): void {
  if (Buffer.isBuffer(target)) {
    target.fill(0);
  }
}
