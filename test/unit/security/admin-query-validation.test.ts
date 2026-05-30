/**
 * Verifies the defense-in-depth query helpers used by admin controllers.
 *
 * The route-layer validators in src/middlewares/validation.middleware.ts
 * already coerce + bound-check inputs, but controllers re-validate via
 * parsePositiveInt / parseEnum / escapeRegExp so a middleware bypass does
 * not produce an exploitable hole.
 *
 * References:
 *   - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt
 *   - https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
 *   - https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
 */
import { describe, it, expect } from 'vitest';
import {
  parsePositiveInt,
  parseEnum,
  escapeRegExp,
} from '../../../src/utils/query-parse.js';

describe('parsePositiveInt', () => {
  it('returns the default when the value is missing', () => {
    expect(parsePositiveInt(undefined, { default: 1, min: 1, max: 100 })).toBe(
      1
    );
    expect(parsePositiveInt(null, { default: 5, min: 1, max: 100 })).toBe(5);
  });

  it('returns the default when the value is a non-numeric string', () => {
    expect(
      parsePositiveInt('not-a-number', { default: 3, min: 1, max: 100 })
    ).toBe(3);
  });

  it('parses a decimal-string in base 10 (no octal/hex auto-detect)', () => {
    expect(parsePositiveInt('010', { default: 1, min: 1, max: 100 })).toBe(10);
    expect(parsePositiveInt('0x10', { default: 1, min: 1, max: 100 })).toBe(1);
  });

  it('clamps to the configured min', () => {
    expect(parsePositiveInt('-5', { default: 1, min: 1, max: 100 })).toBe(1);
    expect(parsePositiveInt('0', { default: 1, min: 1, max: 100 })).toBe(1);
  });

  it('clamps to the configured max', () => {
    expect(parsePositiveInt('1000000', { default: 1, min: 1, max: 100 })).toBe(
      100
    );
  });

  it('accepts a numeric value directly (no string coercion)', () => {
    expect(parsePositiveInt(42, { default: 1, min: 1, max: 100 })).toBe(42);
    // truncates the fractional part — never throws
    expect(parsePositiveInt(7.9, { default: 1, min: 1, max: 100 })).toBe(7);
  });

  it('handles NaN and Infinity safely', () => {
    expect(parsePositiveInt(Number.NaN, { default: 5, min: 1, max: 100 })).toBe(
      5
    );
    expect(
      parsePositiveInt(Number.POSITIVE_INFINITY, {
        default: 5,
        min: 1,
        max: 100,
      })
    ).toBe(5);
  });
});

describe('parseEnum', () => {
  const allowed = ['asc', 'desc'] as const;

  it('returns the value when it is in the allowlist', () => {
    expect(parseEnum('asc', allowed, 'desc')).toBe('asc');
    expect(parseEnum('desc', allowed, 'desc')).toBe('desc');
  });

  it('returns the fallback when the value is missing', () => {
    expect(parseEnum(undefined, allowed, 'desc')).toBe('desc');
    expect(parseEnum(null, allowed, 'desc')).toBe('desc');
  });

  it('returns the fallback when the value is outside the allowlist', () => {
    expect(parseEnum('drop table', allowed, 'desc')).toBe('desc');
    expect(parseEnum('ASC', allowed, 'desc')).toBe('desc');
  });

  it('rejects non-string input even if it stringifies to an allowed value', () => {
    expect(parseEnum(42, allowed, 'desc')).toBe('desc');
    expect(parseEnum({ toString: () => 'asc' }, allowed, 'desc')).toBe('desc');
  });
});

describe('escapeRegExp', () => {
  it('escapes every metacharacter so the result is a literal match', () => {
    const literal = '.*+?^${}()|[]\\';
    const escaped = escapeRegExp(literal);
    const re = new RegExp(escaped);
    expect(re.test(literal)).toBe(true);
  });

  it('neutralises the canonical ReDoS payload (a+)+$', () => {
    const payload = '(a+)+$';
    const escaped = escapeRegExp(payload);
    const re = new RegExp(escaped);
    // Without escaping, `new RegExp('(a+)+$')` against 30+ a's is exponential.
    // With escaping, the regex matches the literal string "(a+)+$" — no
    // catastrophic backtracking is possible.
    const longA = 'a'.repeat(40);
    expect(re.test(longA)).toBe(false);
    expect(re.test(payload)).toBe(true);
  });

  it('leaves plain ASCII alphanumeric unchanged', () => {
    expect(escapeRegExp('alice123')).toBe('alice123');
  });
});
