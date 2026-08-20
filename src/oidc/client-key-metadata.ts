import type { OidcClientData } from './adapter/client.interface.js';

const PUBLIC_JWK_REQUIREMENTS = {
  RSA: {
    required: ['e', 'n'],
    private: ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'],
  },
  EC: {
    required: ['x', 'y'],
    private: ['d'],
    curves: new Set(['P-256', 'P-384', 'P-521']),
  },
  OKP: {
    required: ['x'],
    private: ['d'],
    curves: new Set(['Ed25519', 'X25519']),
  },
  AKP: {
    required: ['alg', 'pub'],
    private: ['priv'],
  },
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && (value as { constructor?: unknown }).constructor === Object;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSafeHttpUri(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

/**
 * Validate managed client key metadata using the same invariants enforced by
 * node-oidc-provider's client model. Only public JWK material may be stored.
 */
export function validateClientKeyMetadata(
  data: Partial<OidcClientData>,
  options: { requirePrivateKeyJwtSource?: boolean } = {}
): string[] {
  const errors: string[] = [];
  const hasJwks = data.jwks !== undefined;
  const hasJwksUri = data.jwks_uri !== undefined;

  if (hasJwks && hasJwksUri) {
    errors.push('jwks and jwks_uri must not be used at the same time');
  }

  if (data.jwks_uri !== undefined && !isSafeHttpUri(data.jwks_uri)) {
    errors.push('jwks_uri must be a safe HTTP(S) URL');
  }

  if (data.token_endpoint_auth_signing_alg !== undefined) {
    const algorithm = data.token_endpoint_auth_signing_alg;
    if (!isNonEmptyString(algorithm)) {
      errors.push(
        'token_endpoint_auth_signing_alg must be a non-empty string if provided'
      );
    } else if (data.token_endpoint_auth_method === 'private_key_jwt') {
      if (algorithm.startsWith('HS')) {
        errors.push(
          'private_key_jwt requires an asymmetric token_endpoint_auth_signing_alg'
        );
      }
    } else if (data.token_endpoint_auth_method === 'client_secret_jwt') {
      if (!algorithm.startsWith('HS')) {
        errors.push(
          'client_secret_jwt requires an HMAC token_endpoint_auth_signing_alg'
        );
      }
    } else {
      errors.push(
        'token_endpoint_auth_signing_alg is only valid with private_key_jwt or client_secret_jwt'
      );
    }
  }

  if (data.jwks !== undefined) {
    if (
      !Array.isArray(data.jwks.keys) ||
      data.jwks.keys.length === 0 ||
      !data.jwks.keys.every(isPlainObject)
    ) {
      errors.push('jwks must contain at least one public JSON Web Key');
    } else {
      data.jwks.keys.forEach((key, index) => {
        if (!isNonEmptyString(key.kty)) {
          errors.push(`jwks.keys[${index}].kty must be a non-empty string`);
          return;
        }

        if (key.kty === 'oct') {
          errors.push(`jwks.keys[${index}] must not contain a symmetric key`);
          return;
        }

        const requirements =
          PUBLIC_JWK_REQUIREMENTS[
            key.kty as keyof typeof PUBLIC_JWK_REQUIREMENTS
          ];
        // oidc-provider deliberately ignores unknown key types and unsupported
        // EC/OKP curves instead of rejecting the client's metadata.
        if (!requirements) return;

        if ('curves' in requirements) {
          if (!isNonEmptyString(key.crv)) {
            errors.push(`jwks.keys[${index}].crv must be a non-empty string`);
            return;
          }
          if (!requirements.curves.has(key.crv as never)) return;
        }

        for (const parameter of requirements.required) {
          if (!isNonEmptyString(key[parameter])) {
            errors.push(
              `jwks.keys[${index}].${parameter} must be a non-empty string`
            );
          }
        }
        for (const parameter of requirements.private) {
          if (key[parameter] !== undefined) {
            errors.push(
              `jwks.keys[${index}].${parameter} must not contain private key material`
            );
          }
        }

        for (const parameter of ['alg', 'kid', 'use']) {
          if (
            key[parameter] !== undefined &&
            !isNonEmptyString(key[parameter])
          ) {
            errors.push(
              `jwks.keys[${index}].${parameter} must be a non-empty string if provided`
            );
          }
        }

        if (
          key.x5c !== undefined &&
          (!Array.isArray(key.x5c) || !key.x5c.every(isNonEmptyString))
        ) {
          errors.push(
            `jwks.keys[${index}].x5c must contain non-empty strings if provided`
          );
        }
      });
    }
  }

  if (
    options.requirePrivateKeyJwtSource &&
    data.token_endpoint_auth_method === 'private_key_jwt' &&
    !hasJwks &&
    !hasJwksUri
  ) {
    errors.push('jwks or jwks_uri is mandatory for private_key_jwt clients');
  }

  return errors;
}
