import { describe, it, expect } from 'vitest';
import {
  CHARSETS,
  isRegexSafe,
  normalizeIdentifierForLookup,
  normalizeIdentifierForStorage,
  validateCharsetMask,
  validateIdentifier,
  validateWithRegex,
  type CustomIdentifierValidationConfig,
} from '../../../src/utils/custom-identifier-validation.js';

describe('custom-identifier-validation', () => {
  describe('normalizeIdentifierForStorage', () => {
    it('returns null for null input', () => {
      expect(normalizeIdentifierForStorage(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(normalizeIdentifierForStorage(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(normalizeIdentifierForStorage('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(normalizeIdentifierForStorage('   ')).toBeNull();
      expect(normalizeIdentifierForStorage('\t\n')).toBeNull();
    });

    it('trims and returns non-empty value', () => {
      expect(normalizeIdentifierForStorage('  abc  ')).toBe('abc');
      expect(normalizeIdentifierForStorage('abc')).toBe('abc');
    });

    it('preserves internal whitespace', () => {
      expect(normalizeIdentifierForStorage('  a b c  ')).toBe('a b c');
    });
  });

  describe('normalizeIdentifierForLookup', () => {
    it('preserves case when caseSensitive=true', () => {
      expect(normalizeIdentifierForLookup('  ABC  ', true)).toBe('ABC');
      expect(normalizeIdentifierForLookup('Mixed', true)).toBe('Mixed');
    });

    it('lowercases when caseSensitive=false', () => {
      expect(normalizeIdentifierForLookup('  ABC  ', false)).toBe('abc');
      expect(normalizeIdentifierForLookup('Mixed', false)).toBe('mixed');
    });

    it('trims in both modes', () => {
      expect(normalizeIdentifierForLookup('   foo   ', true)).toBe('foo');
      expect(normalizeIdentifierForLookup('   FOO   ', false)).toBe('foo');
    });
  });

  describe('isRegexSafe', () => {
    it('rejects patterns longer than 200 chars', () => {
      expect(isRegexSafe('a'.repeat(201))).toBe(false);
    });

    it('accepts patterns at the 200-char boundary', () => {
      expect(isRegexSafe('a'.repeat(200))).toBe(true);
    });

    it('rejects patterns with backreferences', () => {
      expect(isRegexSafe('(foo)\\1')).toBe(false);
      expect(isRegexSafe('foo\\9bar')).toBe(false);
    });

    it('rejects directly-adjacent quantifiers (a++, a*+, a*?, a{2}{3})', () => {
      expect(isRegexSafe('a++')).toBe(false);
      expect(isRegexSafe('a*+')).toBe(false);
      expect(isRegexSafe('a*?')).toBe(false);
      expect(isRegexSafe('a{2}{3}')).toBe(false);
    });

    it('rejects nested quantified groups ((a+)+, (a*)*, (a+)?)', () => {
      expect(isRegexSafe('(a+)+')).toBe(false);
      expect(isRegexSafe('(a*)*')).toBe(false);
      expect(isRegexSafe('(a+)?')).toBe(false);
      expect(isRegexSafe('(a*){3}')).toBe(false);
    });

    it('rejects patterns that fail to compile', () => {
      expect(isRegexSafe('[unclosed')).toBe(false);
      expect(isRegexSafe('(unclosed')).toBe(false);
      expect(isRegexSafe('*foo')).toBe(false);
    });

    it('accepts the audit-example pattern ^[A-Z]{2}\\d{6}$', () => {
      expect(isRegexSafe('^[A-Z]{2}\\d{6}$')).toBe(true);
    });

    it('accepts simple safe patterns', () => {
      expect(isRegexSafe('[a-zA-Z0-9]+')).toBe(true);
      expect(isRegexSafe('^foo$')).toBe(true);
      expect(isRegexSafe('a')).toBe(true);
      expect(isRegexSafe('\\d{4}-\\d{2}-\\d{2}')).toBe(true);
    });
  });

  describe('validateWithRegex', () => {
    it('rejects values longer than 100 chars without compiling', () => {
      expect(validateWithRegex('a'.repeat(101), '.*')).toBe(false);
    });

    it('accepts values at the 100-char boundary', () => {
      expect(validateWithRegex('a'.repeat(100), '.*')).toBe(true);
    });

    it('anchors the pattern (full-match semantics)', () => {
      expect(validateWithRegex('foo', 'foo')).toBe(true);
      expect(validateWithRegex('foobar', 'foo')).toBe(false);
      expect(validateWithRegex('barfoo', 'foo')).toBe(false);
    });

    it('returns false for invalid patterns instead of throwing', () => {
      expect(validateWithRegex('foo', '[')).toBe(false);
      expect(validateWithRegex('foo', '(')).toBe(false);
    });

    it('matches the audit-example pattern', () => {
      expect(validateWithRegex('AB123456', '[A-Z]{2}\\d{6}')).toBe(true);
      expect(validateWithRegex('A1234567', '[A-Z]{2}\\d{6}')).toBe(false);
      expect(validateWithRegex('AB12345', '[A-Z]{2}\\d{6}')).toBe(false);
    });
  });

  describe('CHARSETS', () => {
    it('exposes the documented charsets', () => {
      expect(Object.keys(CHARSETS).sort()).toEqual(
        [
          'alphanumeric',
          'base20',
          'digits',
          'hex',
          'uppercase_alphanumeric',
        ].sort()
      );
    });

    it('digits contains exactly 0-9', () => {
      expect(CHARSETS.digits).toBe('0123456789');
    });

    it('base20 excludes vowels (Crockford-style ambiguity-resistant)', () => {
      expect(CHARSETS.base20).not.toMatch(/[AEIOU]/);
      expect(CHARSETS.base20).toMatch(/^[0-9BCDFGHJKLMNPQRSTVWXYZ]+$/);
    });
  });

  describe('validateCharsetMask', () => {
    it('returns false for unknown charset', () => {
      expect(validateCharsetMask('123', 'unknown', '***')).toBe(false);
    });

    it('returns false when value length differs from mask length', () => {
      expect(validateCharsetMask('1234', 'digits', '***')).toBe(false);
      expect(validateCharsetMask('12', 'digits', '***')).toBe(false);
    });

    it('validates digits with no separators', () => {
      expect(validateCharsetMask('12345', 'digits', '*****')).toBe(true);
      expect(validateCharsetMask('abcde', 'digits', '*****')).toBe(false);
    });

    it('honours literal separators in the mask', () => {
      expect(validateCharsetMask('123-4-567', 'digits', '***-*-***')).toBe(
        true
      );
      expect(validateCharsetMask('123x4-567', 'digits', '***-*-***')).toBe(
        false
      );
      expect(validateCharsetMask('123-4x567', 'digits', '***-*-***')).toBe(
        false
      );
    });

    it('validates hex (case-insensitive set)', () => {
      expect(validateCharsetMask('aF', 'hex', '**')).toBe(true);
      expect(validateCharsetMask('GG', 'hex', '**')).toBe(false);
    });

    it('uppercase_alphanumeric rejects lowercase chars', () => {
      expect(
        validateCharsetMask('ABCD', 'uppercase_alphanumeric', '****')
      ).toBe(true);
      expect(
        validateCharsetMask('abcd', 'uppercase_alphanumeric', '****')
      ).toBe(false);
    });

    it('alphanumeric accepts mixed case', () => {
      expect(validateCharsetMask('aB3z', 'alphanumeric', '****')).toBe(true);
      expect(validateCharsetMask('aB3-', 'alphanumeric', '****')).toBe(false);
    });

    it('base20 rejects ambiguous vowels', () => {
      expect(validateCharsetMask('BCDFG', 'base20', '*****')).toBe(true);
      expect(validateCharsetMask('AAAAA', 'base20', '*****')).toBe(false);
      expect(validateCharsetMask('BCDFE', 'base20', '*****')).toBe(false);
    });
  });

  describe('validateIdentifier', () => {
    const baseConfig = (
      overrides: Partial<CustomIdentifierValidationConfig> = {}
    ): CustomIdentifierValidationConfig => ({
      validation_type: 'none',
      ...overrides,
    });

    describe('length checks', () => {
      it('uses default min_length=1 and max_length=100', () => {
        expect(validateIdentifier('', baseConfig())).toBe(false);
        expect(validateIdentifier('a', baseConfig())).toBe(true);
        expect(validateIdentifier('a'.repeat(100), baseConfig())).toBe(true);
        expect(validateIdentifier('a'.repeat(101), baseConfig())).toBe(false);
      });

      it('respects explicit min_length / max_length', () => {
        const cfg = baseConfig({ min_length: 5, max_length: 10 });
        expect(validateIdentifier('1234', cfg)).toBe(false);
        expect(validateIdentifier('12345', cfg)).toBe(true);
        expect(validateIdentifier('1234567890', cfg)).toBe(true);
        expect(validateIdentifier('12345678901', cfg)).toBe(false);
      });
    });

    describe('validation_type: none', () => {
      it('passes anything within length bounds', () => {
        expect(validateIdentifier('foo!@#$%', baseConfig())).toBe(true);
      });
    });

    describe('validation_type: regex', () => {
      it('matches valid pattern', () => {
        expect(
          validateIdentifier(
            'AB123456',
            baseConfig({ validation_type: 'regex', pattern: '[A-Z]{2}\\d{6}' })
          )
        ).toBe(true);
      });

      it('rejects non-matching value', () => {
        expect(
          validateIdentifier(
            'ab123456',
            baseConfig({ validation_type: 'regex', pattern: '[A-Z]{2}\\d{6}' })
          )
        ).toBe(false);
      });

      it('passes when no pattern is configured (effectively length-only)', () => {
        expect(
          validateIdentifier(
            'anything',
            baseConfig({ validation_type: 'regex' })
          )
        ).toBe(true);
      });
    });

    describe('validation_type: charset_mask', () => {
      it('validates a digits+mask combo', () => {
        expect(
          validateIdentifier(
            '123-4-567',
            baseConfig({
              validation_type: 'charset_mask',
              charset: 'digits',
              mask: '***-*-***',
            })
          )
        ).toBe(true);
      });

      it('rejects a non-matching value', () => {
        expect(
          validateIdentifier(
            'abc-d-efg',
            baseConfig({
              validation_type: 'charset_mask',
              charset: 'digits',
              mask: '***-*-***',
            })
          )
        ).toBe(false);
      });

      it('passes when charset/mask is missing (effectively length-only)', () => {
        expect(
          validateIdentifier(
            'whatever',
            baseConfig({ validation_type: 'charset_mask' })
          )
        ).toBe(true);
        expect(
          validateIdentifier(
            'whatever',
            baseConfig({ validation_type: 'charset_mask', charset: 'digits' })
          )
        ).toBe(true);
        expect(
          validateIdentifier(
            'whatever',
            baseConfig({ validation_type: 'charset_mask', mask: '********' })
          )
        ).toBe(true);
      });
    });

    describe('unknown validation_type (defensive default)', () => {
      it('falls through to true', () => {
        expect(
          validateIdentifier('foo', {
            // @ts-expect-error — exercise the default branch
            validation_type: 'bogus',
          })
        ).toBe(true);
      });
    });
  });
});
