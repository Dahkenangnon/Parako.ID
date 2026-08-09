import { describe, it, expect, vi } from 'vitest';
import {
  formatDateTimeForUser,
  formatDateTimeWithMetadata,
  getShortRelativeTime,
  isToday,
  isYesterday,
  isWithinLastDays,
  formatDateRange,
  getAvailableTimezones,
  getCurrentTimeInTimezone,
  isEmpty,
  deepMerge,
  getOrdinalSuffix,
  capitalizeFirstLetter,
  generateSecureRandomString,
} from '../../../src/utils/misc.js';

describe('misc utilities', () => {
  describe('formatDateTimeForUser', () => {
    const testDate = new Date('2024-01-15T14:30:00Z');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    it('should format today with time', () => {
      const result = formatDateTimeForUser(today, {
        includeTime: true,
        useRelativeTime: true,
        language: 'en',
        serverTimezone: false,
      });
      expect(result).toContain('Today at');
    });

    it('should format yesterday with time', () => {
      const result = formatDateTimeForUser(yesterday, {
        includeTime: true,
        useRelativeTime: true,
        language: 'en',
        serverTimezone: false,
      });
      expect(result).toContain('Yesterday at');
    });

    it('should format with French language', () => {
      const result = formatDateTimeForUser(today, {
        includeTime: true,
        useRelativeTime: true,
        language: 'fr',
        serverTimezone: false,
      });
      expect(result).toContain("Aujourd'hui");
    });

    it('should format without time', () => {
      const result = formatDateTimeForUser(testDate, {
        includeTime: false,
        useRelativeTime: false,
        language: 'en',
      });
      expect(result).not.toContain('at');
    });

    it('should format with specific timezone', () => {
      const result = formatDateTimeForUser(testDate, {
        timezone: 'America/New_York',
        serverTimezone: false,
        language: 'en',
      });
      expect(result).toContain('(America/New_York)');
    });

    it('should handle invalid timezone gracefully', () => {
      const result = formatDateTimeForUser(testDate, {
        timezone: 'Invalid/Timezone',
        serverTimezone: false,
        language: 'en',
      });
      expect(result).toBeDefined();
    });

    it('should format a date from the previous seven days by weekday', () => {
      const recent = new Date();
      recent.setDate(recent.getDate() - 3);

      const result = formatDateTimeForUser(recent, {
        includeTime: false,
        serverTimezone: false,
      });
      expect(result).toMatch(
        /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/
      );
    });

    it('should omit the year when requested', () => {
      const result = formatDateTimeForUser(testDate, {
        includeTime: false,
        includeYear: false,
        useRelativeTime: false,
        serverTimezone: false,
      });
      expect(result).not.toContain('2024');
    });

    it('should use its locale fallback for an unsupported runtime language', () => {
      expect(
        formatDateTimeForUser(testDate, {
          language: 'unsupported' as never,
          serverTimezone: false,
        })
      ).toMatch(/2024/);
    });

    it('should fall back to UTC when server timezone detection fails', () => {
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementationOnce(() => {
        throw new Error('timezone unavailable');
      });

      expect(formatDateTimeForUser(new Date())).toContain('Today');
      vi.restoreAllMocks();
    });

    it('should treat an empty detected server timezone as UTC', () => {
      vi.spyOn(Intl, 'DateTimeFormat').mockReturnValueOnce({
        resolvedOptions: () => ({ timeZone: '' }),
      } as Intl.DateTimeFormat);

      expect(formatDateTimeForUser(new Date())).toContain('Today');
      vi.restoreAllMocks();
    });

    it('should use the French locale in its simple formatting fallback', () => {
      const toLocaleDateString = vi.fn().mockReturnValue('date de secours');
      const invalidDate = {
        getFullYear: () => {
          throw new Error('date unavailable');
        },
        toLocaleDateString,
      } as unknown as Date;

      expect(
        formatDateTimeForUser(invalidDate, {
          language: 'fr',
          serverTimezone: false,
        })
      ).toBe('date de secours');
      expect(toLocaleDateString).toHaveBeenCalledWith(
        'fr-FR',
        expect.any(Object)
      );
    });
  });

  describe('formatDateTimeWithMetadata', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    it('should return metadata for today', () => {
      const result = formatDateTimeWithMetadata(today, {
        useRelativeTime: true,
        language: 'en',
        serverTimezone: false,
      });
      expect(result.isRelative).toBe(true);
      expect(result.relativeType).toBe('today');
      expect(result.formatted).toContain('Today');
    });

    it('should return metadata for yesterday', () => {
      const result = formatDateTimeWithMetadata(yesterday, {
        useRelativeTime: true,
        language: 'en',
        serverTimezone: false,
      });
      expect(result.isRelative).toBe(true);
      expect(result.relativeType).toBe('yesterday');
      expect(result.formatted).toContain('Yesterday');
    });

    it('should return metadata for full date', () => {
      const oldDate = new Date('2020-01-01T00:00:00Z');
      const result = formatDateTimeWithMetadata(oldDate, {
        useRelativeTime: true,
        language: 'en',
      });
      expect(result.isRelative).toBe(false);
      expect(result.relativeType).toBe('full');
    });

    it('should classify dates from the previous week as recent', () => {
      const recent = new Date();
      recent.setDate(recent.getDate() - 3);
      const result = formatDateTimeWithMetadata(recent, {
        serverTimezone: false,
      });

      expect(result.relativeType).toBe('recent');
      expect(result.isRelative).toBe(true);
    });

    it('should support explicitly disabled relative formatting', () => {
      const result = formatDateTimeWithMetadata(new Date('2024-01-15'), {
        useRelativeTime: false,
        serverTimezone: false,
      });
      expect(result.relativeType).toBe('full');
      expect(result.isRelative).toBe(false);
    });

    it('should fall back to full metadata for an unsupported language', () => {
      const result = formatDateTimeWithMetadata(new Date(), {
        language: 'unsupported' as never,
        serverTimezone: false,
      });
      expect(result).toEqual(
        expect.objectContaining({
          isRelative: false,
          relativeType: 'full',
          timezone: undefined,
        })
      );
    });

    it('should preserve an explicit timezone in fallback metadata', () => {
      expect(
        formatDateTimeWithMetadata(new Date(), {
          language: 'unsupported' as never,
          timezone: 'UTC',
          serverTimezone: false,
        }).timezone
      ).toBe('UTC');
    });

    it('should detect the server timezone in fallback metadata by default', () => {
      expect(
        formatDateTimeWithMetadata(new Date(), {
          language: 'unsupported' as never,
        }).timezone
      ).toEqual(expect.any(String));
    });
  });

  describe('getShortRelativeTime', () => {
    it('should return "just now" for recent times', () => {
      const now = new Date();
      const result = getShortRelativeTime(now, { language: 'en' });
      expect(result).toBe('just now');
    });

    it('should return minutes ago', () => {
      const past = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const result = getShortRelativeTime(past, { language: 'en' });
      expect(result).toBe('5m ago');
    });

    it('should return hours ago', () => {
      const past = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
      const result = getShortRelativeTime(past, { language: 'en' });
      expect(result).toBe('3h ago');
    });

    it('should return days ago', () => {
      const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      const result = getShortRelativeTime(past, { language: 'en' });
      expect(result).toBe('2d ago');
    });

    it('should return weeks ago', () => {
      const past = new Date(Date.now() - 2 * 7 * 24 * 60 * 60 * 1000); // 2 weeks ago
      const result = getShortRelativeTime(past, { language: 'en' });
      expect(result).toBe('2w ago');
    });

    it('should return months ago', () => {
      const past = new Date(Date.now() - 3 * 30 * 24 * 60 * 60 * 1000); // ~3 months ago
      const result = getShortRelativeTime(past, { language: 'en' });
      expect(result).toBe('3mo ago');
    });

    it('should return years ago', () => {
      const past = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000); // ~2 years ago
      const result = getShortRelativeTime(past, { language: 'en' });
      expect(result).toBe('2y ago');
    });

    it('should work with French language', () => {
      const past = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const result = getShortRelativeTime(past, { language: 'fr' });
      expect(result).toBe('5min il y a');
    });

    it('should return unknown for an unsupported language', () => {
      expect(
        getShortRelativeTime(new Date(), {
          language: 'unsupported' as never,
        })
      ).toBe('unknown');
    });
  });

  describe('isToday', () => {
    it('should use the server timezone by default', () => {
      expect(isToday(new Date())).toBe(true);
    });

    it('should return true for today', () => {
      const today = new Date();
      expect(isToday(today, { serverTimezone: false })).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isToday(yesterday, { serverTimezone: false })).toBe(false);
    });

    it('should return false for tomorrow', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(isToday(tomorrow, { serverTimezone: false })).toBe(false);
    });

    it('should work with timezone', () => {
      const today = new Date();
      expect(isToday(today, { timezone: 'UTC' })).toBe(true);
    });

    it('should compare both dates in a non-UTC timezone', () => {
      expect(isToday(new Date(), { timezone: 'Europe/Paris' })).toBe(true);
    });

    it('should use the direct comparison fallback after an accessor failure', () => {
      const today = new Date();
      const getDate = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('date unavailable');
        })
        .mockReturnValue(today.getDate());
      const date = {
        getDate,
        getMonth: () => today.getMonth(),
        getFullYear: () => today.getFullYear(),
      } as unknown as Date;

      expect(isToday(date, { serverTimezone: false })).toBe(true);
    });
  });

  describe('isYesterday', () => {
    it('should use the server timezone by default', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isYesterday(yesterday)).toBe(true);
    });

    it('should return true for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isYesterday(yesterday, { serverTimezone: false })).toBe(true);
    });

    it('should return false for today', () => {
      const today = new Date();
      expect(isYesterday(today, { serverTimezone: false })).toBe(false);
    });

    it('should return false for day before yesterday', () => {
      const dayBeforeYesterday = new Date();
      dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
      expect(isYesterday(dayBeforeYesterday, { serverTimezone: false })).toBe(
        false
      );
    });

    it('should compare both dates in a non-UTC timezone', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isYesterday(yesterday, { timezone: 'Europe/Paris' })).toBe(true);
    });

    it('should use the direct comparison fallback after an accessor failure', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const date = {
        getDate: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('date unavailable');
          })
          .mockReturnValue(yesterday.getDate()),
        getMonth: () => yesterday.getMonth(),
        getFullYear: () => yesterday.getFullYear(),
      } as unknown as Date;

      expect(isYesterday(date, { serverTimezone: false })).toBe(true);
    });
  });

  describe('isWithinLastDays', () => {
    it('should use the server timezone by default', () => {
      expect(isWithinLastDays(new Date(), 1)).toBe(true);
    });

    it('should return true for today', () => {
      const today = new Date();
      expect(isWithinLastDays(today, 1, { serverTimezone: false })).toBe(true);
    });

    it('should return true for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isWithinLastDays(yesterday, 2, { serverTimezone: false })).toBe(
        true
      );
    });

    it('should return false for old date', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      expect(isWithinLastDays(oldDate, 7, { serverTimezone: false })).toBe(
        false
      );
    });

    it('should work with timezone', () => {
      const today = new Date();
      expect(isWithinLastDays(today, 1, { timezone: 'UTC' })).toBe(true);
    });

    it('should compare the cutoff in a non-UTC timezone', () => {
      expect(
        isWithinLastDays(new Date(), 1, { timezone: 'Europe/Paris' })
      ).toBe(true);
    });

    it('should use the direct fallback when date comparison throws', () => {
      const date = new Date();
      let comparisonCount = 0;
      const throwingDate = new Proxy(date, {
        get(target, property) {
          if (property === Symbol.toPrimitive) {
            return () => {
              if (comparisonCount++ === 0) {
                throw new Error('comparison unavailable');
              }
              return target.getTime();
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      expect(
        isWithinLastDays(throwingDate as Date, 1, { serverTimezone: false })
      ).toBe(true);
    });
  });

  describe('formatDateRange', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    it('should format same day range', () => {
      const result = formatDateRange(today, today, {
        language: 'en',
        serverTimezone: false,
      });
      expect(result).toContain('Today');
    });

    it('should default same-day range text to English', () => {
      expect(formatDateRange(today, today, { serverTimezone: false })).toBe(
        'Today'
      );
    });

    it('should format different day range', () => {
      const result = formatDateRange(yesterday, today, {
        language: 'en',
        serverTimezone: false,
      });
      expect(result).toContain(' - ');
    });

    it('should format a range entirely within yesterday', () => {
      expect(
        formatDateRange(yesterday, yesterday, {
          language: 'en',
          serverTimezone: false,
        })
      ).toBe('Yesterday');
    });

    it('should default yesterday range text to English', () => {
      expect(
        formatDateRange(yesterday, yesterday, { serverTimezone: false })
      ).toBe('Yesterday');
    });

    it('should format same formatted dates', () => {
      const sameDay = new Date('2024-01-15T10:00:00Z');
      sameDay.setHours(10, 0, 0, 0);
      const sameDay2 = new Date('2024-01-15T15:00:00Z');
      sameDay2.setHours(15, 0, 0, 0);
      const result = formatDateRange(sameDay, sameDay2, {
        language: 'en',
        serverTimezone: false,
      });
      expect(result).not.toContain(' - ');
    });

    it('should fall back to locale dates for an unsupported language', () => {
      const start = new Date();
      const end = new Date(start);
      expect(
        formatDateRange(start, end, {
          language: 'unsupported' as never,
          serverTimezone: false,
        })
      ).toContain(' - ');
    });
  });

  describe('getAvailableTimezones', () => {
    it('should return array of timezones', () => {
      const timezones = getAvailableTimezones();
      expect(Array.isArray(timezones)).toBe(true);
      expect(timezones).toContain('UTC');
      expect(timezones).toContain('America/New_York');
      expect(timezones).toContain('Europe/London');
    });
  });

  describe('getCurrentTimeInTimezone', () => {
    it('should return current time in UTC', () => {
      const result = getCurrentTimeInTimezone('UTC');
      expect(result).toBeInstanceOf(Date);
    });

    it('should return current time in specific timezone', () => {
      const result = getCurrentTimeInTimezone('America/New_York');
      expect(result).toBeInstanceOf(Date);
    });

    it('should handle invalid timezone', () => {
      const result = getCurrentTimeInTimezone('Invalid/Timezone');
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('isEmpty', () => {
    it('should return true for null and undefined', () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
    });

    it('should return true for empty string', () => {
      expect(isEmpty('')).toBe(true);
    });

    it('should return false for non-empty string', () => {
      expect(isEmpty('hello')).toBe(false);
    });

    it('should return true for empty array', () => {
      expect(isEmpty([])).toBe(true);
    });

    it('should return false for non-empty array', () => {
      expect(isEmpty([1, 2, 3])).toBe(false);
    });

    it('should return true for empty object', () => {
      expect(isEmpty({})).toBe(true);
    });

    it('should return false for non-empty object', () => {
      expect(isEmpty({ key: 'value' })).toBe(false);
    });

    it('should return true for empty Map', () => {
      expect(isEmpty(new Map())).toBe(true);
    });

    it('should return false for non-empty Map', () => {
      const map = new Map();
      map.set('key', 'value');
      expect(isEmpty(map)).toBe(false);
    });

    it('should return true for empty Set', () => {
      expect(isEmpty(new Set())).toBe(true);
    });

    it('should return false for non-empty Set', () => {
      const set = new Set([1, 2, 3]);
      expect(isEmpty(set)).toBe(false);
    });

    it('should return false for WeakMap and WeakSet', () => {
      expect(isEmpty(new WeakMap())).toBe(false);
      expect(isEmpty(new WeakSet())).toBe(false);
    });

    it('should handle Buffer', () => {
      if (typeof Buffer !== 'undefined') {
        expect(isEmpty(Buffer.alloc(0))).toBe(true);
        expect(isEmpty(Buffer.alloc(5))).toBe(false);
      }
    });

    it('should handle arguments objects, typed arrays, DataView, and primitives', () => {
      const captureArguments = function (..._values: unknown[]) {
        // eslint-disable-next-line prefer-rest-params -- this contract specifically requires an Arguments object
        return arguments;
      };
      const emptyArguments = captureArguments();
      const populatedArguments = captureArguments('value');

      expect(isEmpty(emptyArguments)).toBe(true);
      expect(isEmpty(populatedArguments)).toBe(false);
      expect(isEmpty(new Uint8Array())).toBe(true);
      expect(isEmpty(new Uint8Array([1]))).toBe(false);
      expect(isEmpty(new DataView(new ArrayBuffer(0)))).toBe(true);
      expect(isEmpty(0)).toBe(false);
      expect(isEmpty(false)).toBe(false);
    });

    it('should ignore inherited enumerable object properties', () => {
      const value = Object.create({ inherited: true });
      expect(isEmpty(value)).toBe(true);
    });
  });

  describe('deepMerge', () => {
    it('should merge simple objects', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should merge nested objects', () => {
      const target = { a: { x: 1, y: 2 }, b: 3 };
      const source = { a: { y: 3, z: 4 }, c: 5 };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { x: 1, y: 3, z: 4 }, b: 3, c: 5 });
    });

    it('should merge multiple sources', () => {
      const target = { a: 1 };
      const source1 = { b: 2 };
      const source2 = { c: 3 };
      const result = deepMerge(target, source1, source2);
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('should handle arrays by replacement', () => {
      const target = { arr: [1, 2, 3] };
      const source = { arr: [4, 5] };
      const result = deepMerge(target, source);
      expect(result).toEqual({ arr: [4, 5] });
    });

    it('should handle null and undefined sources', () => {
      const target = { a: 1 };
      const result = deepMerge(target, null, undefined, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should modify target object in place', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };
      const result = deepMerge(target, source);
      expect(result).toBe(target); // Should return the same object reference
      expect(target).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should replace a non-object target and ignore non-object sources', () => {
      expect(deepMerge(null, 1, 'value', { safe: true })).toEqual({
        safe: true,
      });
    });

    it('should block prototype-pollution keys', () => {
      const source = Object.create(null);
      Object.defineProperty(source, '__proto__', {
        value: { polluted: true },
        enumerable: true,
      });
      source.constructor = { polluted: true };
      source.prototype = { polluted: true };

      expect(deepMerge({}, source)).toEqual({});
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('should create nested objects when the destination type differs', () => {
      expect(deepMerge({ nested: 1 }, { nested: { safe: true } })).toEqual({
        nested: { safe: true },
      });
    });

    it('should assign non-plain object values without recursively merging them', () => {
      const date = new Date('2024-01-01');
      const regex = /safe/;
      const buffer = Buffer.from('safe');
      const map = new Map([['safe', true]]);
      const set = new Set(['safe']);
      const weakMap = new WeakMap();
      const weakSet = new WeakSet();
      const result = deepMerge(
        {},
        {
          date,
          regex,
          buffer,
          map,
          set,
          weakMap,
          weakSet,
        }
      );

      expect(result).toEqual({
        date,
        regex,
        buffer,
        map,
        set,
        weakMap,
        weakSet,
      });
    });

    it('should ignore inherited enumerable source properties', () => {
      const source = Object.create({ inherited: true });
      source.own = true;

      expect(deepMerge({}, source)).toEqual({ own: true });
    });
  });

  describe('getOrdinalSuffix', () => {
    it('should return correct English suffixes', () => {
      expect(getOrdinalSuffix(1, 'en')).toBe('st');
      expect(getOrdinalSuffix(2, 'en')).toBe('nd');
      expect(getOrdinalSuffix(3, 'en')).toBe('rd');
      expect(getOrdinalSuffix(4, 'en')).toBe('th');
      expect(getOrdinalSuffix(11, 'en')).toBe('th');
      expect(getOrdinalSuffix(12, 'en')).toBe('th');
      expect(getOrdinalSuffix(13, 'en')).toBe('th');
      expect(getOrdinalSuffix(21, 'en')).toBe('st');
      expect(getOrdinalSuffix(22, 'en')).toBe('nd');
      expect(getOrdinalSuffix(23, 'en')).toBe('rd');
    });

    it('should return correct French suffixes', () => {
      expect(getOrdinalSuffix(1, 'fr')).toBe('er');
      expect(getOrdinalSuffix(2, 'fr')).toBe('e');
      expect(getOrdinalSuffix(3, 'fr')).toBe('e');
      expect(getOrdinalSuffix(4, 'fr')).toBe('e');
    });

    it('should default to English', () => {
      expect(getOrdinalSuffix(1)).toBe('st');
      expect(getOrdinalSuffix(2)).toBe('nd');
    });
  });

  describe('capitalizeFirstLetter', () => {
    it('should capitalize first letter', () => {
      expect(capitalizeFirstLetter('hello')).toBe('Hello');
      expect(capitalizeFirstLetter('world')).toBe('World');
    });

    it('should handle empty string', () => {
      expect(capitalizeFirstLetter('')).toBe('');
    });

    it('should handle single character', () => {
      expect(capitalizeFirstLetter('a')).toBe('A');
    });

    it('should handle already capitalized', () => {
      expect(capitalizeFirstLetter('Hello')).toBe('Hello');
    });
  });

  describe('generateSecureRandomString', () => {
    it('should generate string of specified length', () => {
      const result = generateSecureRandomString(16);
      expect(result).toHaveLength(16);
    });

    it('should generate different strings each time', () => {
      const result1 = generateSecureRandomString(32);
      const result2 = generateSecureRandomString(32);
      expect(result1).not.toBe(result2);
    });

    it('should generate hex characters only', () => {
      const result = generateSecureRandomString(20);
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('should default to 32 characters', () => {
      const result = generateSecureRandomString();
      expect(result).toHaveLength(32);
    });

    it('should handle odd lengths', () => {
      const result = generateSecureRandomString(15);
      expect(result).toHaveLength(15);
    });
  });
});
