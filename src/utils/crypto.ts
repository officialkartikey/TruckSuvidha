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
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Safely verifies an API key against its SHA-256 hash using timing-safe comparison.
 */
export function verifyDeviceApiKey(apiKey: string, hashedKey: string): boolean {
  const computedHash = hashDeviceApiKey(apiKey);
  if (computedHash.length !== hashedKey.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hashedKey));
}
