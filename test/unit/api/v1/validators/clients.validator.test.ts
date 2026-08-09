import { describe, expect, it } from 'vitest';

import {
  createClientSchema,
  updateClientSchema,
} from '../../../../../src/api/v1/validators/clients.validator.js';

const validCreateInput = {
  client_name: 'Demo RP',
};

describe('createClientSchema', () => {
  it('normalizes all supported client metadata without mutating the request', () => {
    const input = {
      client_name: '  Demo RP  ',
      application_type: 'spa',
      redirect_uris: ['  https://rp.example.test/callback  '],
      post_logout_redirect_uris: ['  https://rp.example.test/  '],
      grant_types: [' authorization_code ', 'refresh_token'],
      response_types: [' code '],
      scope: '  openid   profile\nemail  ',
      token_endpoint_auth_method: 'none',
      client_uri: '  https://rp.example.test/about  ',
      logo_uri: '  https://rp.example.test/logo.svg  ',
      policy_uri: '  https://rp.example.test/privacy  ',
      tos_uri: '  https://rp.example.test/terms  ',
      contacts: ['  OWNER@Example.TEST  '],
      description: '  Demonstration relying party  ',
      tags: ['  demo  ', 'public'],
      id_token_signed_response_alg: '  EdDSA  ',
      subject_type: 'pairwise',
      default_max_age: 3600,
      unknown: 'discard me',
    };
    const snapshot = structuredClone(input);

    expect(createClientSchema.parse(input)).toEqual({
      client_name: 'Demo RP',
      application_type: 'web',
      preset: 'spa',
      redirect_uris: ['https://rp.example.test/callback'],
      post_logout_redirect_uris: ['https://rp.example.test/'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid profile email',
      token_endpoint_auth_method: 'none',
      client_uri: 'https://rp.example.test/about',
      logo_uri: 'https://rp.example.test/logo.svg',
      policy_uri: 'https://rp.example.test/privacy',
      tos_uri: 'https://rp.example.test/terms',
      contacts: ['owner@example.test'],
      description: 'Demonstration relying party',
      tags: ['demo', 'public'],
      require_pkce: true,
      id_token_signed_response_alg: 'EdDSA',
      subject_type: 'pairwise',
      default_max_age: 3600,
    });
    expect(input).toEqual(snapshot);
  });

  it('applies only the documented web application default', () => {
    expect(createClientSchema.parse(validCreateInput)).toEqual({
      client_name: 'Demo RP',
      application_type: 'web',
    });
  });

  it.each([
    'https://rp.example.test/callback',
    'http://127.0.0.1:49152/callback',
    'http://localhost:3000/callback',
    'com.example.app:/oauth2redirect',
  ])('accepts portable redirect URI %s', redirectUri => {
    expect(
      createClientSchema.parse({
        ...validCreateInput,
        redirect_uris: [redirectUri],
      }).redirect_uris
    ).toEqual([redirectUri]);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,callback',
    'file:///tmp/callback',
    'vbscript:msgbox(1)',
    'https://user:secret@rp.example.test/callback',
    'https://*.example.test/callback',
    'https://rp.example.test/callback#fragment',
    'not a URI',
  ])('rejects unsafe redirect URI %j', redirectUri => {
    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        redirect_uris: [redirectUri],
      }).success
    ).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,logout',
    'file:///tmp/logout',
    'vbscript:msgbox(1)',
    'https://user:secret@rp.example.test/logout',
    'https://*.example.test/logout',
    'https://rp.example.test/logout#fragment',
    'not a URI',
  ])('rejects unsafe post-logout redirect URI %j', redirectUri => {
    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        post_logout_redirect_uris: [redirectUri],
      }).success
    ).toBe(false);
  });

  it.each(['client_uri', 'logo_uri', 'policy_uri', 'tos_uri'] as const)(
    'accepts an HTTP(S) %s',
    field => {
      expect(
        createClientSchema.parse({
          ...validCreateInput,
          [field]: 'https://rp.example.test/resource',
        })[field]
      ).toBe('https://rp.example.test/resource');
    }
  );

  it.each(['client_uri', 'logo_uri', 'policy_uri', 'tos_uri'] as const)(
    'rejects unsafe or non-HTTP %s values',
    field => {
      for (const value of [
        'javascript:alert(1)',
        'com.example.app:/resource',
        'https://user:secret@rp.example.test/resource',
        'not a URI',
      ]) {
        expect(
          createClientSchema.safeParse({
            ...validCreateInput,
            [field]: value,
          }).success
        ).toBe(false);
      }
    }
  );

  it.each(['a', 'x'.repeat(255)])(
    'accepts normalized client name boundary %j',
    clientName => {
      expect(
        createClientSchema.parse({ client_name: ` ${clientName} ` }).client_name
      ).toBe(clientName);
    }
  );

  it.each(['', '   ', 'x'.repeat(256), 42])(
    'rejects invalid client name %j',
    clientName => {
      expect(
        createClientSchema.safeParse({ client_name: clientName }).success
      ).toBe(false);
    }
  );

  it.each([
    ['web', 'web'],
    ['native', 'native'],
    ['spa', 'web'],
  ] as const)(
    'accepts application type %s as provider type %s',
    (applicationType, providerApplicationType) => {
      expect(
        createClientSchema.parse({
          ...validCreateInput,
          application_type: applicationType,
        }).application_type
      ).toBe(providerApplicationType);
    }
  );

  it('rejects duplicate URI entries after normalization', () => {
    for (const field of [
      'redirect_uris',
      'post_logout_redirect_uris',
    ] as const) {
      expect(
        createClientSchema.safeParse({
          ...validCreateInput,
          [field]: [
            'https://rp.example.test/callback',
            ' https://rp.example.test/callback ',
          ],
        }).success
      ).toBe(false);
    }
  });

  it.each([
    ['grant_types', 'password'],
    ['grant_types', 'urn:example:params:oauth:grant-type:custom'],
    ['response_types', 'token'],
    ['response_types', 'code token'],
  ] as const)('rejects unsupported provider %s value %s', (field, value) => {
    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        [field]: [value],
      }).success
    ).toBe(false);
  });

  it.each(['grant_types', 'response_types'] as const)(
    'rejects blank, oversized, duplicate, or excessive %s entries',
    field => {
      for (const value of [
        ['   '],
        ['x'.repeat(201)],
        ['code', ' code '],
        Array.from({ length: 21 }, (_, index) => `value-${index}`),
      ]) {
        expect(
          createClientSchema.safeParse({
            ...validCreateInput,
            [field]: value,
          }).success
        ).toBe(false);
      }
    }
  );

  it('normalizes a space-separated scope and rejects invalid scope input', () => {
    expect(
      createClientSchema.parse({
        ...validCreateInput,
        scope: ' openid   profile\temail ',
      }).scope
    ).toBe('openid profile email');

    for (const scope of ['   ', 'x'.repeat(4097), 42]) {
      expect(
        createClientSchema.safeParse({ ...validCreateInput, scope }).success
      ).toBe(false);
    }
  });

  it('preserves and validates Parako resource-access metadata', () => {
    expect(
      createClientSchema.parse({
        ...validCreateInput,
        allowedResources: [' urn:parako:api:v1 ', 'https://api.example.test/'],
        resourcesScopes: ' parako:stats:read   custom:read ',
        active: false,
      })
    ).toMatchObject({
      allowedResources: ['urn:parako:api:v1', 'https://api.example.test/'],
      resourcesScopes: 'parako:stats:read custom:read',
      active: false,
    });

    for (const input of [
      { allowedResources: ['not a URI'] },
      { allowedResources: ['javascript:alert(1)'] },
      { allowedResources: ['urn:api:one', ' urn:api:one '] },
      { resourcesScopes: '   ' },
      { active: 'false' },
    ]) {
      expect(
        createClientSchema.safeParse({ ...validCreateInput, ...input }).success
      ).toBe(false);
    }
  });

  it.each([
    'none',
    'client_secret_basic',
    'client_secret_post',
    'client_secret_jwt',
  ] as const)('accepts token endpoint auth method %s', authMethod => {
    expect(
      createClientSchema.parse({
        ...validCreateInput,
        token_endpoint_auth_method: authMethod,
      }).token_endpoint_auth_method
    ).toBe(authMethod);
  });

  it('accepts private_key_jwt with exactly one provider-supported key source', () => {
    const jwksUriResult = createClientSchema.parse({
      ...validCreateInput,
      token_endpoint_auth_method: 'private_key_jwt',
      jwks_uri: ' https://rp.example.test/jwks.json ',
    });
    expect(jwksUriResult.jwks_uri).toBe('https://rp.example.test/jwks.json');

    const jwks = {
      keys: [
        {
          kty: 'RSA',
          kid: 'signing-key',
          use: 'sig',
          alg: 'RS256',
          n: 'sXchDaQebHnPiGvyDOAT4saGEUetSyo_0QSqfRmbPxLu',
          e: 'AQAB',
        },
      ],
    };
    expect(
      createClientSchema.parse({
        ...validCreateInput,
        token_endpoint_auth_method: 'private_key_jwt',
        jwks,
      }).jwks
    ).toEqual(jwks);
  });

  it('enforces the provider signing algorithm family for JWT client authentication', () => {
    const publicJwks = {
      keys: [{ kty: 'RSA', n: 'modulus', e: 'AQAB' }],
    };

    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_signing_alg: 'HS256',
        jwks: publicJwks,
      }).success
    ).toBe(false);
    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        token_endpoint_auth_method: 'client_secret_jwt',
        token_endpoint_auth_signing_alg: 'RS256',
      }).success
    ).toBe(false);
    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        token_endpoint_auth_method: 'client_secret_basic',
        token_endpoint_auth_signing_alg: 'RS256',
      }).success
    ).toBe(false);

    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_signing_alg: 'RS256',
        jwks: publicJwks,
      }).success
    ).toBe(true);
    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        token_endpoint_auth_method: 'client_secret_jwt',
        token_endpoint_auth_signing_alg: 'HS256',
      }).success
    ).toBe(true);
  });

  it('rejects unusable private_key_jwt key metadata', () => {
    for (const input of [
      { token_endpoint_auth_method: 'private_key_jwt' },
      {
        token_endpoint_auth_method: 'private_key_jwt',
        jwks_uri: 'https://rp.example.test/jwks.json',
        jwks: { keys: [{ kty: 'RSA', n: 'modulus', e: 'AQAB' }] },
      },
      {
        token_endpoint_auth_method: 'private_key_jwt',
        jwks_uri: 'file:///tmp/jwks.json',
      },
      {
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [] },
      },
      {
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [{ kty: 'RSA', n: 'missing-exponent' }] },
      },
    ]) {
      expect(
        createClientSchema.safeParse({ ...validCreateInput, ...input }).success
      ).toBe(false);
    }
  });

  it('requires PKCE for public clients and preserves explicit PKCE for confidential clients', () => {
    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        token_endpoint_auth_method: 'none',
        require_pkce: false,
      }).success
    ).toBe(false);

    expect(
      createClientSchema.parse({
        ...validCreateInput,
        token_endpoint_auth_method: 'client_secret_basic',
        require_pkce: false,
      }).require_pkce
    ).toBe(false);
  });

  it('normalizes contacts and tags and rejects duplicates after normalization', () => {
    expect(
      createClientSchema.parse({
        ...validCreateInput,
        contacts: [' OWNER@Example.TEST '],
        tags: [' internal ', 'finance'],
      })
    ).toMatchObject({
      contacts: ['owner@example.test'],
      tags: ['internal', 'finance'],
    });

    for (const input of [
      { contacts: ['owner@example.test', ' OWNER@example.test '] },
      { tags: ['internal', ' internal '] },
    ]) {
      expect(
        createClientSchema.safeParse({ ...validCreateInput, ...input }).success
      ).toBe(false);
    }
  });

  it('rejects malformed or excessive contacts and tags', () => {
    for (const input of [
      { contacts: ['not-an-email'] },
      { contacts: Array.from({ length: 101 }, () => 'owner@example.test') },
      { tags: ['   '] },
      { tags: ['x'.repeat(101)] },
      { tags: Array.from({ length: 101 }, (_, index) => `tag-${index}`) },
    ]) {
      expect(
        createClientSchema.safeParse({ ...validCreateInput, ...input }).success
      ).toBe(false);
    }
  });

  it('trims descriptions while retaining an explicit empty description', () => {
    expect(
      createClientSchema.parse({
        ...validCreateInput,
        description: '  description  ',
      }).description
    ).toBe('description');
    expect(
      createClientSchema.parse({
        ...validCreateInput,
        description: '   ',
      }).description
    ).toBe('');
    expect(
      createClientSchema.safeParse({
        ...validCreateInput,
        description: 'x'.repeat(1001),
      }).success
    ).toBe(false);
  });

  it.each(['RS256', 'ES256', 'EdDSA', 'custom_alg-1'])(
    'accepts normalized non-empty signing algorithm %s',
    algorithm => {
      expect(
        createClientSchema.parse({
          ...validCreateInput,
          id_token_signed_response_alg: ` ${algorithm} `,
        }).id_token_signed_response_alg
      ).toBe(algorithm);
    }
  );

  it.each(['', '   ', 'invalid algorithm', 'x'.repeat(65)])(
    'rejects malformed signing algorithm %j',
    algorithm => {
      expect(
        createClientSchema.safeParse({
          ...validCreateInput,
          id_token_signed_response_alg: algorithm,
        }).success
      ).toBe(false);
    }
  );

  it.each([1, Number.MAX_SAFE_INTEGER])(
    'accepts safe positive default_max_age %d',
    defaultMaxAge => {
      expect(
        createClientSchema.parse({
          ...validCreateInput,
          default_max_age: defaultMaxAge,
        }).default_max_age
      ).toBe(defaultMaxAge);
    }
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '3600'])(
    'rejects invalid default_max_age %j',
    defaultMaxAge => {
      expect(
        createClientSchema.safeParse({
          ...validCreateInput,
          default_max_age: defaultMaxAge,
        }).success
      ).toBe(false);
    }
  );
});

describe('updateClientSchema', () => {
  it('accepts an empty update without injecting create defaults', () => {
    expect(updateClientSchema.parse({})).toEqual({});
  });

  it('normalizes supplied mutable fields and strips unknown fields', () => {
    expect(
      updateClientSchema.parse({
        client_name: '  Updated RP  ',
        redirect_uris: [' https://rp.example.test/new-callback '],
        scope: 'openid   email',
        contacts: [' ADMIN@Example.TEST '],
        tags: [' updated '],
        unknown: true,
      })
    ).toEqual({
      client_name: 'Updated RP',
      redirect_uris: ['https://rp.example.test/new-callback'],
      scope: 'openid email',
      contacts: ['admin@example.test'],
      tags: ['updated'],
    });
  });

  it('does not mutate a partial update request', () => {
    const input = {
      client_name: '  Updated RP  ',
      tags: [' tag '],
    };
    const snapshot = structuredClone(input);

    updateClientSchema.parse(input);

    expect(input).toEqual(snapshot);
  });

  it('applies public-client PKCE hardening to partial updates', () => {
    expect(
      updateClientSchema.parse({ token_endpoint_auth_method: 'none' })
    ).toEqual({
      token_endpoint_auth_method: 'none',
      require_pkce: true,
    });
    expect(
      updateClientSchema.safeParse({
        token_endpoint_auth_method: 'none',
        require_pkce: false,
      }).success
    ).toBe(false);
  });

  it('validates supplied key metadata without requiring omitted stored metadata', () => {
    expect(
      updateClientSchema.parse({
        token_endpoint_auth_method: 'private_key_jwt',
      })
    ).toEqual({ token_endpoint_auth_method: 'private_key_jwt' });

    expect(
      updateClientSchema.safeParse({
        jwks_uri: 'https://rp.example.test/jwks.json',
        jwks: { keys: [{ kty: 'RSA', n: 'modulus', e: 'AQAB' }] },
      }).success
    ).toBe(false);
  });

  it.each([
    { client_name: '   ' },
    { redirect_uris: ['javascript:alert(1)'] },
    { post_logout_redirect_uris: ['https://example.test/#fragment'] },
    { scope: '   ' },
    { contacts: ['invalid'] },
    { tags: ['tag', ' tag '] },
    { id_token_signed_response_alg: '' },
    { default_max_age: 0 },
  ])('rejects invalid partial update %j', update => {
    expect(updateClientSchema.safeParse(update).success).toBe(false);
  });
});
