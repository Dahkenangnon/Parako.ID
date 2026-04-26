import crypto from 'node:crypto';

export interface BreachResult {
  breached: boolean;
  count: number;
}

/**
 * Compute SHA1 hash of a password and split into prefix/suffix for k-anonymity.
 * Only the 5-char prefix is sent to the HIBP API — the full hash never leaves the server.
 */
export function computeSha1PrefixSuffix(password: string): {
  prefix: string;
  suffix: string;
} {
  const hash = crypto
    .createHash('sha1')
    .update(password)
    .digest('hex')
    .toUpperCase();
  return {
    prefix: hash.substring(0, 5),
    suffix: hash.substring(5),
  };
}

/**
 * Check if a password appears in known breach databases via HIBP Pwned Passwords API.
 * Uses k-anonymity: only sends the first 5 chars of the SHA1 hash.
 *
 * Graceful failure: any error returns { breached: false, count: 0 }.
 */
export async function checkPasswordBreach(
  password: string,
  timeoutMs = 3000
): Promise<BreachResult> {
  const { prefix, suffix } = computeSha1PrefixSuffix(password);
  return checkBreachBySha1(prefix, suffix, timeoutMs);
}

/**
 * Check breach using pre-computed SHA1 prefix and suffix.
 * Used by the background handler where the hash is already computed.
 *
 * Graceful failure: any error returns { breached: false, count: 0 }.
 */
export async function checkBreachBySha1(
  prefix: string,
  suffix: string,
  timeoutMs = 3000
): Promise<BreachResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { 'Add-Padding': 'true' },
        signal: controller.signal,
      }
    );

    clearTimeout(timer);

    if (!response.ok) {
      return { breached: false, count: 0 };
    }

    const text = await response.text();
    const upperSuffix = suffix.toUpperCase();

    for (const line of text.split('\n')) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === upperSuffix) {
        const count = parseInt(countStr, 10);
        return { breached: count > 0, count };
      }
    }

    return { breached: false, count: 0 };
  } catch {
    return { breached: false, count: 0 };
  }
}
