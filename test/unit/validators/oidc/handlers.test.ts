import { describe, it, expect } from 'vitest';

import {
  oidcMfaBodySchema,
  oidcNewDeviceVerifyBodySchema,
  oidcSocialLoginQuerySchema,
  oidcSocialProviderParamsSchema,
  oidcUidParamsSchema,
  oidcWebauthnMfaVerifyBodySchema,
} from '../../../../src/validators/oidc/handlers.js';

describe('oidcUidParamsSchema', () => {
  it('accepts a 10..100 character uid', () => {
    expect(oidcUidParamsSchema.parse({ uid: 'a'.repeat(20) }).uid).toHaveLength(
      20
    );
  });

  it('rejects a uid shorter than 10 characters', () => {
    expect(oidcUidParamsSchema.safeParse({ uid: 'short' }).success).toBe(false);
  });

  it('rejects a uid longer than 100 characters', () => {
    expect(
      oidcUidParamsSchema.safeParse({ uid: 'x'.repeat(101) }).success
    ).toBe(false);
  });
});

describe('oidcSocialProviderParamsSchema', () => {
  it.each(['google', 'github', 'facebook'])(
    'accepts %s as a known provider',
    provider => {
      expect(oidcSocialProviderParamsSchema.parse({ provider }).provider).toBe(
        provider
      );
    }
  );

  it('rejects an unknown provider', () => {
    expect(
      oidcSocialProviderParamsSchema.safeParse({ provider: 'myspace' }).success
    ).toBe(false);
  });
});

describe('oidcSocialLoginQuerySchema', () => {
  it('passes through OIDC parameters the schema does not name', () => {
    const result = oidcSocialLoginQuerySchema.parse({
      uid: 'a'.repeat(15),
      client_id: 'my-client',
      response_type: 'code',
      scope: 'openid profile',
      nonce: 'abc',
    });
    expect((result as Record<string, unknown>).response_type).toBe('code');
    expect((result as Record<string, unknown>).nonce).toBe('abc');
  });

  it('rejects a client_id over 200 characters', () => {
    expect(
      oidcSocialLoginQuerySchema.safeParse({
        client_id: 'x'.repeat(201),
      }).success
    ).toBe(false);
  });
});

describe('oidcMfaBodySchema', () => {
  it.each(['totp', 'sms', 'email', 'backup_codes'])(
    'accepts %s as a method',
    method => {
      expect(oidcMfaBodySchema.parse({ method }).method).toBe(method);
    }
  );

  it('rejects an unknown method', () => {
    expect(oidcMfaBodySchema.safeParse({ method: 'face' }).success).toBe(false);
  });

  it('preserves other body fields (csrf token etc.)', () => {
    const result = oidcMfaBodySchema.parse({
      method: 'totp',
      csrf_token: 'abc',
    });
    expect((result as Record<string, unknown>).csrf_token).toBe('abc');
  });
});

describe('oidcNewDeviceVerifyBodySchema', () => {
  it('accepts a non-empty code', () => {
    expect(oidcNewDeviceVerifyBodySchema.parse({ code: '123456' }).code).toBe(
      '123456'
    );
  });

  it('accepts trust_this_device as string-bool', () => {
    expect(
      oidcNewDeviceVerifyBodySchema.parse({
        code: '123456',
        trust_this_device: 'true',
      }).trust_this_device
    ).toBe('true');
  });

  it('rejects an empty code', () => {
    expect(oidcNewDeviceVerifyBodySchema.safeParse({ code: '' }).success).toBe(
      false
    );
  });

  it('rejects trust_this_device with boolean true (must be string)', () => {
    expect(
      oidcNewDeviceVerifyBodySchema.safeParse({
        code: '1',
        trust_this_device: true as unknown as 'true',
      }).success
    ).toBe(false);
  });
});

describe('oidcWebauthnMfaVerifyBodySchema', () => {
  it('accepts a credential object', () => {
    expect(
      oidcWebauthnMfaVerifyBodySchema.parse({
        credential: { id: 'abc', response: {} },
      }).credential
    ).toBeDefined();
  });

  it('rejects a missing credential', () => {
    expect(oidcWebauthnMfaVerifyBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a credential that is not an object', () => {
    expect(
      oidcWebauthnMfaVerifyBodySchema.safeParse({
        credential: 'string-not-object',
      }).success
    ).toBe(false);
  });
});
