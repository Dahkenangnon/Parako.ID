import { describe, it, expect } from 'vitest';

import { adminActivityListQuerySchema } from '../../../../src/validators/admin/activities.js';
import { adminGrantListQuerySchema } from '../../../../src/validators/admin/grants.js';
import { adminOidcClientListQuerySchema } from '../../../../src/validators/admin/oidc-clients.js';
import { adminSessionListQuerySchema } from '../../../../src/validators/admin/sessions.js';
import { adminUserListQuerySchema } from '../../../../src/validators/admin/users.js';

describe('adminUserListQuerySchema', () => {
  it('applies pagination defaults', () => {
    const result = adminUserListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('coerces page / limit from string', () => {
    const result = adminUserListQuerySchema.parse({
      page: '3',
      limit: '50',
    });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });

  it('preserves literal search text for repository-specific translation', () => {
    const result = adminUserListQuerySchema.parse({
      search: 'person.name+tag@example.test',
    });
    expect(result.search).toBe('person.name+tag@example.test');
  });

  it('rejects sortBy outside the allow-list', () => {
    expect(
      adminUserListQuerySchema.safeParse({ sortBy: 'password' }).success
    ).toBe(false);
  });

  it('accepts the new sortBy values that were added with the consolidation', () => {
    for (const field of [
      'created_at',
      'updated_at',
      'username',
      'email',
      'last_login_at',
    ]) {
      expect(adminUserListQuerySchema.parse({ sortBy: field }).sortBy).toBe(
        field
      );
    }
  });

  it('rejects role values outside the allow-list', () => {
    expect(adminUserListQuerySchema.safeParse({ role: 'root' }).success).toBe(
      false
    );
  });
});

describe('adminSessionListQuerySchema', () => {
  it('accepts an empty query with pagination defaults', () => {
    expect(adminSessionListQuerySchema.parse({})).toMatchObject({
      page: 1,
      limit: 20,
    });
  });

  it('preserves literal search and username values for the UI and repository boundary', () => {
    const result = adminSessionListQuerySchema.parse({
      search: 'person.name+tag@example.test',
      username: 'evil.*',
    });

    expect(result.search).toBe('person.name+tag@example.test');
    expect(result.username).toBe('evil.*');
  });

  it('rejects status outside the allow-list', () => {
    expect(
      adminSessionListQuerySchema.safeParse({ status: 'unknown' }).success
    ).toBe(false);
  });
});

describe('adminActivityListQuerySchema', () => {
  it('accepts the canonical filter shape', () => {
    const result = adminActivityListQuerySchema.parse({
      page: '2',
      type: 'login',
      status: 'success',
      username: 'alice',
      dateFrom: '2024-01-01T00:00:00Z',
      dateTo: '2024-01-31T23:59:59Z',
      sortBy: 'timestamp',
      sortOrder: 'asc',
    });
    expect(result.page).toBe(2);
    expect(result.type).toBe('login');
    expect(result.username).toBe('alice');
    expect(result.dateFrom).toBe('2024-01-01T00:00:00Z');
  });

  it('rejects a malformed dateFrom', () => {
    expect(
      adminActivityListQuerySchema.safeParse({ dateFrom: 'yesterday' }).success
    ).toBe(false);
  });

  it('accepts valid date-only values emitted by the activity filter UI', () => {
    const result = adminActivityListQuerySchema.parse({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    });

    expect(result.dateFrom).toBe('2026-08-01');
    expect(result.dateTo).toBe('2026-08-31');
  });

  it.each(['2026-02-30', '2026-99-99'])(
    'rejects impossible date-only value %s',
    dateFrom => {
      expect(adminActivityListQuerySchema.safeParse({ dateFrom }).success).toBe(
        false
      );
    }
  );

  it('rejects type over 50 characters', () => {
    expect(
      adminActivityListQuerySchema.safeParse({ type: 'x'.repeat(51) }).success
    ).toBe(false);
  });
});

describe('adminGrantListQuerySchema', () => {
  it('preserves a literal clientId used by the exact-match repository filter', () => {
    expect(
      adminGrantListQuerySchema.parse({ clientId: 'client.id+1' }).clientId
    ).toBe('client.id+1');
  });

  it('rejects sortBy outside the allow-list', () => {
    expect(
      adminGrantListQuerySchema.safeParse({ sortBy: 'leak' }).success
    ).toBe(false);
  });

  it('accepts every sort value emitted by the grant listing UI', () => {
    for (const sortBy of [
      'created_at',
      'payload.iat',
      'payload.accountId',
      'payload.clientId',
    ]) {
      expect(adminGrantListQuerySchema.parse({ sortBy }).sortBy).toBe(sortBy);
    }
  });
});

describe('adminOidcClientListQuerySchema', () => {
  it('accepts application_type values web/native/spa', () => {
    expect(
      adminOidcClientListQuerySchema.parse({ application_type: 'spa' })
        .application_type
    ).toBe('spa');
  });

  it('rejects environment outside the allow-list', () => {
    expect(
      adminOidcClientListQuerySchema.safeParse({ environment: 'qa' }).success
    ).toBe(false);
  });

  it('rejects source outside the allow-list', () => {
    expect(
      adminOidcClientListQuerySchema.safeParse({ source: 'external' }).success
    ).toBe(false);
  });
});
