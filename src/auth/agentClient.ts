import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * Issues a cryptographically random capability client key.
 * Format: nv_live_<base64url>
 * Returns raw key ONCE and its secure scrypt hash to persist.
 */
export async function issueClientKey(): Promise<{ rawOnce: string; hash: string }> {
  const raw = 'nv_live_' + randomBytes(24).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(raw, salt, 64)) as Buffer;
  const hash = `scrypt$${salt}$${derivedKey.toString('hex')}`;
  return { rawOnce: raw, hash };
}

/**
 * Verifies a presented raw client key against the stored hash.
 * Timing-attack resistant verification.
 */
export async function verifyClientKey(raw: string, storedHash: string): Promise<boolean> {
  try {
    if (!storedHash.startsWith('scrypt$')) {
      return false;
    }
    const [, salt, originalHex] = storedHash.split('$');
    if (!salt || !originalHex) return false;

    const originalBuffer = Buffer.from(originalHex, 'hex');
    const derivedBuffer = (await scryptAsync(raw, salt, 64)) as Buffer;

    return timingSafeEqual(originalBuffer, derivedBuffer);
  } catch {
    return false;
  }
}
