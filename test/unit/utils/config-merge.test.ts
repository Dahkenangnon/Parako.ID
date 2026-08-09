import { describe, expect, it } from 'vitest';

import {
  areConfigsEqual,
  cloneConfig,
  mergeConfig,
  mergeConfigs,
} from '../../../src/utils/config-merge.js';

describe('configuration merge utilities', () => {
  it('does not consider objects with different undefined-valued keys equal', () => {
    expect(areConfigsEqual({ first: undefined }, { second: undefined })).toBe(
      false
    );
  });

  it('preserves a non-object existing value when updates are empty', () => {
    expect(mergeConfig(42, {} as never)).toBe(42);
  });

  it('recursively merges objects while replacing and cloning arrays', () => {
    const existing = {
      nested: { enabled: true, level: 1 },
      scopes: ['openid', 'profile'],
      unchanged: 'value',
    };
    const updates = {
      nested: { level: 2 },
      scopes: ['email'],
    };

    const result = mergeConfig(existing, updates);

    expect(result).toEqual({
      nested: { enabled: true, level: 2 },
      scopes: ['email'],
      unchanged: 'value',
    });
    expect(result).not.toBe(existing);
    expect(result.nested).not.toBe(existing.nested);
    expect(result.scopes).not.toBe(updates.scopes);
    expect(existing).toEqual({
      nested: { enabled: true, level: 1 },
      scopes: ['openid', 'profile'],
      unchanged: 'value',
    });
  });

  it('honors array, undefined, and null merge options', () => {
    const existing = {
      fromScalar: 'not-an-array',
      nullable: 'keep',
      optional: 'keep',
      scopes: ['openid'],
    };

    expect(
      mergeConfig(
        existing,
        {
          fromScalar: ['email'] as never,
          nullable: null as never,
          optional: undefined,
          scopes: ['profile'],
        },
        { replaceArrays: false, skipNull: true }
      )
    ).toEqual({
      fromScalar: ['email'],
      nullable: 'keep',
      optional: 'keep',
      scopes: ['openid', 'profile'],
    });

    expect(
      mergeConfig(
        existing,
        { nullable: null as never, optional: undefined },
        {
          skipUndefined: false,
        }
      )
    ).toEqual({
      ...existing,
      nullable: null,
      optional: undefined,
    });
  });

  it('blocks prototype-polluting and Object-prototype keys', () => {
    const updates = JSON.parse(
      '{"safe":2,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"toString":"evil"}'
    );

    const result = mergeConfig({ safe: 1 }, updates);

    expect(result).toEqual({ safe: 2 });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('replaces explicit non-plain values and preserves nullish empty updates', () => {
    const originalDate = new Date('2026-01-01T00:00:00.000Z');
    const replacementDate = new Date('2026-08-01T00:00:00.000Z');

    expect(mergeConfig(originalDate, replacementDate as never)).toBe(
      replacementDate
    );
    expect(mergeConfig(42, null as never)).toBe(42);
    expect(
      mergeConfig(
        { generatedAt: originalDate },
        { generatedAt: replacementDate }
      )
    ).toEqual({ generatedAt: replacementDate });
  });

  it('merges multiple configurations in order and handles an empty list', () => {
    expect(
      mergeConfigs<Record<string, unknown>>([
        { nested: { first: true }, scopes: ['openid'] },
        { nested: { second: true }, scopes: ['profile'] },
        { version: 3 },
      ])
    ).toEqual({
      nested: { first: true, second: true },
      scopes: ['profile'],
      version: 3,
    });
    expect(mergeConfigs([])).toEqual({});
  });

  it('deep-clones JSON configuration values and preserves nullish roots', () => {
    const original = { nested: { enabled: true }, scopes: ['openid'] };
    const cloned = cloneConfig(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.nested).not.toBe(original.nested);
    expect(cloned.scopes).not.toBe(original.scopes);
    expect(cloneConfig(null)).toBe(null);
    expect(cloneConfig(undefined)).toBeUndefined();
  });

  it.each([
    ['same primitive', 'value', 'value', true],
    ['different type', 1, '1', false],
    ['one null', null, {}, false],
    ['equal arrays', [1, { nested: true }], [1, { nested: true }], true],
    ['different array length', [1], [1, 2], false],
    ['different array item', [1, 2], [1, 3], false],
    [
      'equal objects',
      { enabled: true, nested: { level: 2 } },
      { enabled: true, nested: { level: 2 } },
      true,
    ],
    ['different object size', { enabled: true }, {}, false],
    [
      'different nested value',
      { nested: { level: 2 } },
      { nested: { level: 3 } },
      false,
    ],
    [
      'distinct non-plain values',
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-01T00:00:00.000Z'),
      false,
    ],
  ])('compares %s correctly', (_case, first, second, expected) => {
    expect(areConfigsEqual(first, second)).toBe(expected);
  });
});
