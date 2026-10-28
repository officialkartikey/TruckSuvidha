import crypto from 'crypto';

/**
 * Generates a high-entropy API key for a device.
 * Format: trk_<32 random hex characters>
 */
export function generateDeviceApiKey(): string {
  const randomBytes = crypto.randomBytes(24).toString('hex');
  return `trk_${randomBytes}`;
}

/**
 * Computes SHA-256 hash of an API key for safe database storage.
 */
export function hashDeviceApiKey(apiKey: string): string {
  if (typeof apiKey !== 'string') {
    throw new TypeError('API key must be a string');
  }
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Safely verifies an API key against its SHA-256 hash using timing-safe comparison.
 */
export function verifyDeviceApiKey(apiKey: string, hashedKey: string): boolean {
  if (typeof apiKey !== 'string' || typeof hashedKey !== 'string') {
    return false;
  }
  const trimmedKey = apiKey.trim();
  const trimmedHash = hashedKey.trim();
  if (!trimmedKey || !trimmedHash) {
    return false;
  }
  const computedHash = hashDeviceApiKey(trimmedKey);
  if (computedHash.length !== trimmedHash.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(computedHash, 'utf8'), Buffer.from(trimmedHash, 'utf8'));
}
