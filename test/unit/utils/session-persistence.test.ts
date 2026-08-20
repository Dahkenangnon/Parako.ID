import { describe, expect, it } from 'vitest';
import { PersistenceDecodingError } from '../../../src/db/persistence/json-decoder.js';
import { decodePersistedSession } from '../../../src/utils/session-persistence.js';

describe('decodePersistedSession', () => {
  it('accepts flexible session extensions with typed administrative fields', () => {
    expect(
      decodePersistedSession(
        JSON.stringify({
          tenantId: 'tenant-a',
          accountId: 'user-1',
          isAuthenticated: true,
          extension: { enabled: true },
        }),
        'application_session.data'
      )
    ).toEqual({
      tenantId: 'tenant-a',
      accountId: 'user-1',
      isAuthenticated: true,
      extension: { enabled: true },
    });
  });

  it.each([
    ['a non-object document', '["private-marker"]'],
    [
      'an invalid tenant ownership field',
      '{"tenantId":{"secret":"private-marker"}}',
    ],
  ])('rejects %s without exposing values', (_label, serialized) => {
    try {
      decodePersistedSession(serialized, 'application_session.data');
      throw new Error('Expected persisted session decoding to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceDecodingError);
      expect(error).toMatchObject({ context: 'application_session.data' });
      expect(String(error)).not.toContain('private-marker');
    }
  });
});
