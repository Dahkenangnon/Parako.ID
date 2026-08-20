import { describe, expect, it } from 'vitest';
import { PersistenceDecodingError } from '../../../../src/db/persistence/json-decoder.js';
import {
  decodeOidcPayload,
  validateOidcPayload,
} from '../../../../src/oidc/adapter/payload-decoder.js';

describe('OIDC persisted payload decoder', () => {
  it('accepts serialized and already-decoded object payloads', () => {
    expect(decodeOidcPayload('{"accountId":"user-1"}', 'oidc.payload')).toEqual(
      {
        accountId: 'user-1',
      }
    );
    expect(validateOidcPayload({ uid: 'session-1' }, 'oidc.payload')).toEqual({
      uid: 'session-1',
    });
  });

  it.each([
    { value: '["private-marker"]', decode: true },
    { value: ['private-marker'], decode: false },
  ])(
    'rejects non-object payloads without exposing values',
    ({ value, decode }) => {
      try {
        if (decode) {
          decodeOidcPayload(value as string, 'oidc.payload');
        } else {
          validateOidcPayload(value, 'oidc.payload');
        }
        throw new Error('Expected persisted OIDC payload decoding to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(PersistenceDecodingError);
        expect(error).toMatchObject({ context: 'oidc.payload' });
        expect(String(error)).not.toContain('private-marker');
      }
    }
  );
});
