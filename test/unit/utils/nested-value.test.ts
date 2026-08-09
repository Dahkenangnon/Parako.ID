import { describe, expect, it } from 'vitest';

import {
  getNestedValue,
  setNestedValue,
} from '../../../src/utils/nested-value.js';

describe('getNestedValue', () => {
  it('reads nested own values and returns undefined after a missing segment', () => {
    const source = {
      account: {
        enabled: false,
        aliases: [{ value: 'primary' }],
        profile: null,
      },
    };

    expect(getNestedValue(source, 'account.enabled')).toBe(false);
    expect(getNestedValue(source, 'account.aliases.0.value')).toBe('primary');
    expect(getNestedValue(source, 'account.missing.value')).toBeUndefined();
    expect(getNestedValue(source, 'account.profile.value')).toBeUndefined();
  });

  it.each(['', '.value', 'value.', 'value..nested'])(
    'rejects the malformed path %j',
    path => {
      expect(() => getNestedValue({}, path)).toThrow(
        'Nested property path must contain only non-empty segments'
      );
    }
  );

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the unsafe %s path segment',
    unsafeSegment => {
      expect(() => getNestedValue({}, `safe.${unsafeSegment}.value`)).toThrow(
        `Unsafe nested property path segment: ${unsafeSegment}`
      );
    }
  );
});

describe('setNestedValue', () => {
  it('sets values while preserving objects and replacing invalid intermediates', () => {
    const target: Record<string, unknown> = {
      account: {
        enabled: false,
        profile: null,
        sibling: 'preserved',
      },
    };

    setNestedValue(target, 'account.enabled', true);
    setNestedValue(target, 'account.profile.name', 'Maria');
    setNestedValue(target, 'topLevel', 42);

    expect(target).toEqual({
      account: {
        enabled: true,
        profile: { name: 'Maria' },
        sibling: 'preserved',
      },
      topLevel: 42,
    });
  });

  it('rejects prototype-polluting paths without mutating Object.prototype', () => {
    const target: Record<string, unknown> = {};
    const objectPrototype = Object.prototype as Record<string, unknown>;

    try {
      expect(() => setNestedValue(target, '__proto__.polluted', true)).toThrow(
        'Unsafe nested property path segment: __proto__'
      );
      expect(objectPrototype.polluted).toBeUndefined();
      expect(target).toEqual({});
    } finally {
      delete objectPrototype.polluted;
    }
  });

  it.each(['constructor', 'prototype'])(
    'rejects the unsafe %s path segment',
    unsafeSegment => {
      expect(() =>
        setNestedValue({}, `safe.${unsafeSegment}.value`, true)
      ).toThrow(`Unsafe nested property path segment: ${unsafeSegment}`);
    }
  );
});
