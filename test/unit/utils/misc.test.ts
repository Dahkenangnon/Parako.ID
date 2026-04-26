import { describe, it, expect } from 'vitest';
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
} from '../../../src/utils/misc';

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
  });

  describe('isToday', () => {
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
  });

  describe('isYesterday', () => {
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
  });

  describe('isWithinLastDays', () => {
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

    it('should format different day range', () => {
      const result = formatDateRange(yesterday, today, {
        language: 'en',
        serverTimezone: false,
      });
      expect(result).toContain(' - ');
    });

    it('should format same formatted dates', () => {
      const sameDay = new Date(today);
      sameDay.setHours(10, 0, 0, 0);
      const sameDay2 = new Date(today);
      sameDay2.setHours(15, 0, 0, 0);
      const result = formatDateRange(sameDay, sameDay2, {
        language: 'en',
        serverTimezone: false,
      });
      expect(result).not.toContain(' - ');
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
