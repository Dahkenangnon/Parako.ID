export interface WebAuthnCapabilityScope {
  readonly PublicKeyCredential?: unknown;
}

export function isWebAuthnSupported(scope: WebAuthnCapabilityScope): boolean {
  return typeof scope.PublicKeyCredential === 'function';
}

export function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + '='.repeat(paddingLength));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export function encodeBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function isSafeSameOriginRedirect(
  value: unknown,
  origin: string
): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;

  try {
    const target = new URL(value, origin);
    return (
      (target.protocol === 'http:' || target.protocol === 'https:') &&
      target.origin === origin
    );
  } catch {
    return false;
  }
}
