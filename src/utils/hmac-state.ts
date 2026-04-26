/**
 * HMAC State Utility
 *
 * Creates and verifies HMAC-SHA256 signed state tokens for cross-tenant
 * OAuth flows via the _ops infrastructure gateway. The state encodes
 * the originating tenant_id, a nonce, and a timestamp, signed with a
 * shared secret so the callback handler can verify authenticity and
 * route back to the correct tenant.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Maximum age of a state token before it's considered expired (10 minutes). */
const STATE_TTL_MS = 10 * 60 * 1000;

export interface HmacStatePayload {
  tenant_id: string;
  nonce: string;
  timestamp: number;
}

export type VerifyResult =
  | { valid: true; tenant_id: string; nonce: string; timestamp: number }
  | { valid: false; error: string };

interface SignedPayload extends HmacStatePayload {
  sig: string;
}

/**
 * Compute HMAC-SHA256 over the canonical serialization of the payload.
 * Canonical form: sorted JSON keys to ensure deterministic output.
 */
function computeSignature(payload: HmacStatePayload, secret: string): string {
  const canonical = JSON.stringify({
    nonce: payload.nonce,
    tenant_id: payload.tenant_id,
    timestamp: payload.timestamp,
  });
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Create an HMAC-signed state token.
 *
 * @returns URL-safe base64 encoded string containing the payload + HMAC signature
 */
export function createHmacState(
  payload: HmacStatePayload,
  secret: string
): string {
  const sig = computeSignature(payload, secret);
  const signed: SignedPayload = { ...payload, sig };
  return Buffer.from(JSON.stringify(signed)).toString('base64url');
}

/**
 * Verify an HMAC-signed state token.
 *
 * Checks:
 * 1. Valid base64url encoding + JSON structure
 * 2. Required fields present (tenant_id, nonce, timestamp, sig)
 * 3. HMAC signature matches (timing-safe comparison)
 * 4. Timestamp within TTL window
 */
export function verifyHmacState(state: string, secret: string): VerifyResult {
  let parsed: Record<string, unknown>;

  try {
    const json = Buffer.from(state, 'base64url').toString('utf8');
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { valid: false, error: 'Malformed state: invalid encoding' };
  }

  if (
    typeof parsed.tenant_id !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.timestamp !== 'number' ||
    typeof parsed.sig !== 'string'
  ) {
    return { valid: false, error: 'Malformed state: missing required fields' };
  }

  const payload: HmacStatePayload = {
    tenant_id: parsed.tenant_id,
    nonce: parsed.nonce,
    timestamp: parsed.timestamp,
  };

  // Timing-safe signature comparison
  const expected = computeSignature(payload, secret);
  const sigBuffer = Buffer.from(parsed.sig as string, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { valid: false, error: 'Invalid signature' };
  }

  const age = Date.now() - payload.timestamp;
  if (age < 0) {
    return { valid: false, error: 'State timestamp in future' };
  }
  if (age > STATE_TTL_MS) {
    return { valid: false, error: 'State expired' };
  }

  return {
    valid: true,
    tenant_id: payload.tenant_id,
    nonce: payload.nonce,
    timestamp: payload.timestamp,
  };
}
