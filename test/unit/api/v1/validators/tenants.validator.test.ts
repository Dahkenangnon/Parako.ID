import { describe, expect, it } from 'vitest';

import {
  createTenantSchema,
  updateConfigSectionSchema,
} from '../../../../../src/api/v1/validators/tenants.validator.js';

describe('createTenantSchema', () => {
  it('normalizes tenant identity fields consistently across adapters', () => {
    expect(
      createTenantSchema.parse({
        slug: '  Acme-Corp  ',
        display_name: '  Acme Corporation  ',
        domain: '  LOGIN.Acme.Example  ',
      })
    ).toEqual({
      slug: 'acme-corp',
      display_name: 'Acme Corporation',
      domain: 'login.acme.example',
    });
  });

  it('omits an empty optional domain', () => {
    expect(
      createTenantSchema.parse({
        slug: 'acme',
        display_name: 'Acme',
        domain: '   ',
      })
    ).toEqual({
      slug: 'acme',
      display_name: 'Acme',
      domain: undefined,
    });
  });

  it.each(['ab', 'a-b', 'tenant123', 'x'.repeat(63)])(
    'accepts valid normalized slug %s',
    slug => {
      expect(
        createTenantSchema.parse({ slug, display_name: 'Tenant' }).slug
      ).toBe(slug);
    }
  );

  it.each([
    'a',
    'x'.repeat(64),
    '-acme',
    'acme-',
    'acme_tenant',
    'acme.tenant',
    'acme tenant',
    '---',
  ])('rejects invalid slug %j', slug => {
    expect(
      createTenantSchema.safeParse({ slug, display_name: 'Tenant' }).success
    ).toBe(false);
  });

  it.each(['Acme', '  Acme  ', 'x'.repeat(255)])(
    'accepts and normalizes display name %j',
    display_name => {
      const parsed = createTenantSchema.parse({
        slug: 'acme',
        display_name,
      });
      expect(parsed.display_name).toBe(display_name.trim());
    }
  );

  it.each(['', '   ', 'x'.repeat(256), 42])(
    'rejects invalid display name %j',
    display_name => {
      expect(
        createTenantSchema.safeParse({ slug: 'acme', display_name }).success
      ).toBe(false);
    }
  );

  it.each([
    'localhost',
    'tenant.example.com',
    '127.0.0.1',
    'xn--bcher-kva.example',
  ])('accepts hostname %s', domain => {
    expect(
      createTenantSchema.parse({
        slug: 'acme',
        display_name: 'Acme',
        domain,
      }).domain
    ).toBe(domain);
  });

  it.each([
    'https://tenant.example.com',
    'tenant.example.com:8443',
    'tenant.example.com/path',
    'user@tenant.example.com',
    '.tenant.example.com',
    'tenant.example.com.',
    '-tenant.example.com',
    'tenant-.example.com',
    'tenant_example.com',
    `${'x'.repeat(64)}.example.com`,
    'x'.repeat(254),
  ])('rejects non-hostname domain %j', domain => {
    expect(
      createTenantSchema.safeParse({
        slug: 'acme',
        display_name: 'Acme',
        domain,
      }).success
    ).toBe(false);
  });

  it('strips unknown properties without mutating the request body', () => {
    const body = {
      slug: '  ACME  ',
      display_name: '  Acme  ',
      status: 'active',
    };

    expect(createTenantSchema.parse(body)).toEqual({
      slug: 'acme',
      display_name: 'Acme',
    });
    expect(body).toEqual({
      slug: '  ACME  ',
      display_name: '  Acme  ',
      status: 'active',
    });
  });
});

describe('updateConfigSectionSchema', () => {
  it('accepts an arbitrary JSON object for section-level validation', () => {
    const section = {
      enabled: true,
      nested: { limit: 10, values: ['a', 'b'], nullable: null },
    };

    expect(updateConfigSectionSchema.parse(section)).toEqual(section);
  });

  it('accepts an empty section object for downstream semantic validation', () => {
    expect(updateConfigSectionSchema.parse({})).toEqual({});
  });

  it.each([null, [], 'value', 42, true])(
    'rejects non-object section payload %j',
    payload => {
      expect(updateConfigSectionSchema.safeParse(payload).success).toBe(false);
    }
  );
});
