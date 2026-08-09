import { describe, expect, it } from 'vitest';
import {
  merge,
  safeData,
  safeDatas,
  safePageDatas,
  serializeDocument,
  serializeDocuments,
  serializePaginatedResults,
} from '../../../src/db/utils.js';

function objectId(value: string) {
  return {
    buffer: {},
    toString: () => value,
  };
}

describe('database serialization utilities', () => {
  it('serializes a document instance, removes __v, and converts nested object IDs', () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const bytes = Buffer.from('unchanged');
    const document = {
      toObject: () => ({
        _id: objectId('root-id'),
        __v: 3,
        createdAt,
        bytes,
        owner: { id: objectId('owner-id') },
        members: [objectId('member-id'), 'plain'],
      }),
    };

    const result = serializeDocument(document) as Record<string, unknown>;

    expect(result).toMatchObject({
      _id: 'root-id',
      id: 'root-id',
      owner: { id: 'owner-id' },
      members: ['member-id', 'plain'],
    });
    expect(result).not.toHaveProperty('__v');
    expect(result.createdAt).toBe(createdAt);
    expect(result.bytes).toBe(bytes);
  });

  it('returns null for absent documents and copies plain documents without mutating them', () => {
    const source = { name: 'Parako', __v: 1 };

    expect(serializeDocument(null)).toBeNull();
    expect(serializeDocument(source)).toEqual({ name: 'Parako' });
    expect(source).toEqual({ name: 'Parako', __v: 1 });
  });

  it('preserves primitive, date, buffer, and unchanged array values', () => {
    const date = new Date('2026-08-01T00:00:00.000Z');
    const buffer = Buffer.from('value');
    const array = ['one', 2, null];
    const source = { date, buffer, array };

    const result = serializeDocument(source);

    expect(result).toEqual(source);
    expect(result?.date).toBe(date);
    expect(result?.buffer).toBe(buffer);
    expect(result?.array).toBe(array);
  });

  it('drops prototype-polluting keys while rebuilding nested values', () => {
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"unsafe":true}}'
    );
    source.owner = objectId('owner-id');

    const result = serializeDocument(source) as Record<string, unknown>;

    expect(result).toEqual({ owner: 'owner-id' });
    expect((result as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('ignores inherited enumerable properties in nested document data', () => {
    const nested = Object.assign(
      Object.create({ inherited: objectId('inherited-id') }),
      { own: objectId('own-id') }
    );

    expect(serializeDocument({ nested })).toEqual({
      nested: { own: 'own-id' },
    });
  });

  it('serializes arrays, filters null entries, and rejects non-array runtime input', () => {
    expect(
      serializeDocuments([
        { _id: objectId('one') },
        null,
        { _id: objectId('two') },
      ] as never)
    ).toEqual([
      { _id: 'one', id: 'one' },
      { _id: 'two', id: 'two' },
    ]);
    expect(serializeDocuments('not-an-array' as never)).toEqual([]);
  });

  it('serializes paginated results and supplies an empty fallback', () => {
    expect(serializePaginatedResults(null as never)).toEqual({
      results: [],
      totalPages: 0,
      totalResults: 0,
    });
    expect(
      serializePaginatedResults({
        results: [{ _id: objectId('one') }],
        totalPages: 2,
        totalResults: 3,
        page: 1,
      } as never)
    ).toEqual({
      results: [{ _id: 'one', id: 'one' }],
      totalPages: 2,
      totalResults: 3,
      page: 1,
    });
  });

  it('keeps compatibility wrappers aligned with the serializers', () => {
    expect(safeData({ _id: objectId('one') })).toEqual({
      _id: 'one',
      id: 'one',
    });
    expect(safeDatas([{ _id: objectId('one') }, null])).toEqual([
      { _id: 'one', id: 'one' },
      null,
    ]);
    expect(
      safePageDatas({
        results: [{ _id: objectId('one') }],
        totalPages: 1,
        totalResults: 1,
      })
    ).toMatchObject({ results: [{ _id: 'one', id: 'one' }] });
  });
});

describe('database merge utility', () => {
  it('returns non-object targets unchanged and ignores non-object sources', () => {
    expect(merge('target', { value: true })).toBe('target');
    const target = { existing: true };

    expect(merge(target, null, false, 'source')).toBe(target);
    expect(target).toEqual({ existing: true });
  });

  it('merges plain objects recursively, replaces arrays, and does not mutate sources', () => {
    const roles = ['admin'];
    const source = {
      profile: { locale: 'fr' },
      roles,
      nullable: null,
    };
    const target = {
      profile: { name: 'Maria', locale: 'en' },
      roles: ['user'],
    };

    const result = merge(target, source);

    expect(result).toBe(target);
    expect(result).toEqual({
      profile: { name: 'Maria', locale: 'fr' },
      roles: ['admin'],
      nullable: null,
    });
    expect(result.roles).not.toBe(roles);
    expect(source).toEqual({
      profile: { locale: 'fr' },
      roles: ['admin'],
      nullable: null,
    });
  });

  it('replaces non-plain target values and assigns non-plain source values by reference', () => {
    const date = new Date('2026-08-01T00:00:00.000Z');
    const result = merge(
      { profile: 'legacy', previous: { nested: true } },
      { profile: { locale: 'en' }, previous: date }
    );

    expect(result).toEqual({ profile: { locale: 'en' }, previous: date });
    expect(result.previous).toBe(date);
  });

  it('supports null-prototype plain objects', () => {
    const source = Object.assign(Object.create(null), {
      nested: Object.assign(Object.create(null), { enabled: true }),
    });

    expect(merge({}, source)).toEqual({ nested: { enabled: true } });
  });

  it('blocks prototype-polluting keys at every nesting level', () => {
    const source = JSON.parse(`{
      "safe": {
        "value": true,
        "__proto__": { "nestedPolluted": true }
      },
      "__proto__": { "polluted": true },
      "constructor": { "prototype": { "constructorPolluted": true } },
      "prototype": { "prototypePolluted": true }
    }`);
    const target: Record<string, unknown> = {};

    merge(target, source);

    expect(target).toEqual({ safe: { value: true } });
    expect((target as { polluted?: boolean }).polluted).toBeUndefined();
    expect(
      (target.safe as { nestedPolluted?: boolean }).nestedPolluted
    ).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
