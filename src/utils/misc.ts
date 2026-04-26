import crypto from 'node:crypto';

export type SupportedLanguage = 'en' | 'fr';

export interface DateTimeFormatOptions {
  includeTime?: boolean;
  includeYear?: boolean;
  useRelativeTime?: boolean;
  language?: SupportedLanguage;
  timezone?: string; // IANA timezone identifier (e.g., 'America/New_York', 'Europe/Paris')
  serverTimezone?: boolean; // Use server timezone (default: true)
}

export interface FormattedDateTimeResult {
  formatted: string;
  isRelative: boolean;
  relativeType?: 'today' | 'yesterday' | 'recent' | 'full';
  timezone?: string;
}

// Language-specific text mappings
const languageTexts = {
  en: {
    today: 'Today',
    yesterday: 'Yesterday',
    justNow: 'just now',
    ago: 'ago',
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    days: [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ],
    timeUnits: {
      m: 'm',
      h: 'h',
      d: 'd',
      w: 'w',
      mo: 'mo',
      y: 'y',
    },
  },
  fr: {
    today: "Aujourd'hui",
    yesterday: 'Hier',
    justNow: "à l'instant",
    ago: 'il y a',
    months: [
      'Janvier',
      'Février',
      'Mars',
      'Avril',
      'Mai',
      'Juin',
      'Juillet',
      'Août',
      'Septembre',
      'Octobre',
      'Novembre',
      'Décembre',
    ],
    days: [
      'Dimanche',
      'Lundi',
      'Mardi',
      'Mercredi',
      'Jeudi',
      'Vendredi',
      'Samedi',
    ],
    timeUnits: {
      m: 'min',
      h: 'h',
      d: 'j',
      w: 'sem',
      mo: 'mois',
      y: 'an',
    },
  },
};

/**
 * Get the server's timezone
 * @returns The server's timezone identifier
 */
function getServerTimezone(): string {
  try {
    const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return serverTz || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Convert a date to a specific timezone
 * @param date - The date to convert
 * @param timezone - The target timezone
 * @returns The date in the target timezone
 */
function convertToTimezone(date: Date, timezone: string): Date {
  try {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    const targetTz = new Date(utc);

    const targetDate = new Date(
      targetTz.toLocaleString('en-US', { timeZone: timezone })
    );
    return targetDate;
  } catch {
    // Fallback to original date if timezone conversion fails
    return date;
  }
}

/**
 * Format a datetime in a user-friendly way with relative time indicators
 * @param date - The date to format
 * @param options - Formatting options
 * @returns User-friendly formatted date string
 */
export function formatDateTimeForUser(
  date: Date,
  options: DateTimeFormatOptions = {}
): string {
  try {
    const {
      includeTime = true,
      includeYear = true,
      useRelativeTime = true,
      language = 'en',
      timezone,
      serverTimezone = true,
    } = options;

    let targetTimezone = timezone;
    if (serverTimezone && !timezone) {
      targetTimezone = getServerTimezone();
    }

    let targetDate = date;
    if (targetTimezone && targetTimezone !== 'UTC') {
      targetDate = convertToTimezone(date, targetTimezone);
    }

    const texts = languageTexts[language];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateOnly = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate()
    );

    const formatTime = (date: Date): string => {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, '0');
      return `${displayHours}:${displayMinutes}${ampm}`;
    };

    const formatDayName = (date: Date): string => {
      return texts.days[date.getDay()];
    };

    const formatMonthName = (date: Date): string => {
      return texts.months[date.getMonth()];
    };

    const formatDateWithOrdinal = (date: Date): string => {
      const day = date.getDate();
      const suffix = getOrdinalSuffix(day, language);
      return `${day}${suffix}`;
    };

    let result = '';

    // Use relative time if enabled and applicable
    if (useRelativeTime) {
      if (dateOnly.getTime() === today.getTime()) {
        result = texts.today;
      } else if (dateOnly.getTime() === yesterday.getTime()) {
        result = texts.yesterday;
      } else {
        const daysDiff = Math.floor(
          (today.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysDiff > 0 && daysDiff <= 7) {
          result = formatDayName(targetDate);
        } else {
          // More than 7 days ago, use full date
          result = `${formatDayName(targetDate)}, ${formatDateWithOrdinal(targetDate)} ${formatMonthName(targetDate)}`;
          if (includeYear) {
            result += `, ${targetDate.getFullYear()}`;
          }
        }
      }
    } else {
      // Always use full date format
      result = `${formatDayName(targetDate)}, ${formatDateWithOrdinal(targetDate)} ${formatMonthName(targetDate)}`;
      if (includeYear) {
        result += `, ${targetDate.getFullYear()}`;
      }
    }

    if (includeTime) {
      if (result === texts.today || result === texts.yesterday) {
        result += ` at ${formatTime(targetDate)}`;
      } else {
        result += ` at ${formatTime(targetDate)}`;
      }
    }

    if (timezone && !serverTimezone) {
      result += ` (${timezone})`;
    }

    return result;
  } catch (error) {
    const err = error as Error;
    console.error('Error formatting datetime for user:', err.message);

    // Fallback to simple formatting
    return date.toLocaleDateString(
      options.language === 'fr' ? 'fr-FR' : 'en-US',
      {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }
    );
  }
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 * @param num - The number to get the suffix for
 * @param language - The language for the suffix
 * @returns The ordinal suffix
 */
export function getOrdinalSuffix(
  num: number,
  language: SupportedLanguage = 'en'
): string {
  if (language === 'fr') {
    if (num === 1) return 'er';
    return 'e';
  }

  const j = num % 10;
  const k = num % 100;

  if (j === 1 && k !== 11) {
    return 'st';
  }
  if (j === 2 && k !== 12) {
    return 'nd';
  }
  if (j === 3 && k !== 13) {
    return 'rd';
  }
  return 'th';
}

/**
 * Format a datetime with detailed information about the formatting type
 * @param date - The date to format
 * @param options - Formatting options
 * @returns Object containing formatted string and formatting metadata
 */
export function formatDateTimeWithMetadata(
  date: Date,
  options: DateTimeFormatOptions = {}
): FormattedDateTimeResult {
  try {
    const { language = 'en', timezone, serverTimezone = true } = options;

    let targetTimezone = timezone;
    if (serverTimezone && !timezone) {
      targetTimezone = getServerTimezone();
    }

    const texts = languageTexts[language];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let targetDate = date;
    if (targetTimezone && targetTimezone !== 'UTC') {
      targetDate = convertToTimezone(date, targetTimezone);
    }

    const dateOnly = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate()
    );

    let relativeType: FormattedDateTimeResult['relativeType'] = 'full';
    let result = '';

    if (options.useRelativeTime !== false) {
      if (dateOnly.getTime() === today.getTime()) {
        result = texts.today;
        relativeType = 'today';
      } else if (dateOnly.getTime() === yesterday.getTime()) {
        result = texts.yesterday;
        relativeType = 'yesterday';
      } else {
        const daysDiff = Math.floor(
          (today.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysDiff > 0 && daysDiff <= 7) {
          result = formatDateTimeForUser(date, {
            ...options,
            useRelativeTime: false,
          });
          relativeType = 'recent';
        } else {
          result = formatDateTimeForUser(date, {
            ...options,
            useRelativeTime: false,
          });
          relativeType = 'full';
        }
      }
    } else {
      result = formatDateTimeForUser(date, {
        ...options,
        useRelativeTime: false,
      });
      relativeType = 'full';
    }

    return {
      formatted: result,
      isRelative:
        relativeType === 'today' ||
        relativeType === 'yesterday' ||
        relativeType === 'recent',
      relativeType,
      timezone: targetTimezone,
    };
  } catch (error) {
    const err = error as Error;
    console.error('Error formatting datetime with metadata:', err.message);

    return {
      formatted: formatDateTimeForUser(date, options),
      isRelative: false,
      relativeType: 'full',
      timezone:
        options.timezone ||
        (options.serverTimezone !== false ? getServerTimezone() : undefined),
    };
  }
}

/**
 * Get a short relative time string (e.g., "2h ago", "3d ago", "1w ago")
 * @param date - The date to get relative time for
 * @param options - Formatting options
 * @returns Short relative time string
 */
export function getShortRelativeTime(
  date: Date,
  options: { language?: SupportedLanguage } = {}
): string {
  try {
    const { language = 'en' } = options;
    const texts = languageTexts[language];

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffSeconds < 60) {
      return texts.justNow;
    } else if (diffMinutes < 60) {
      return `${diffMinutes}${texts.timeUnits.m} ${texts.ago}`;
    } else if (diffHours < 24) {
      return `${diffHours}${texts.timeUnits.h} ${texts.ago}`;
    } else if (diffDays < 7) {
      return `${diffDays}${texts.timeUnits.d} ${texts.ago}`;
    } else if (diffWeeks < 4) {
      return `${diffWeeks}${texts.timeUnits.w} ${texts.ago}`;
    } else if (diffMonths < 12) {
      return `${diffMonths}${texts.timeUnits.mo} ${texts.ago}`;
    } else {
      return `${diffYears}${texts.timeUnits.y} ${texts.ago}`;
    }
  } catch (error) {
    const err = error as Error;
    console.error('Error getting short relative time:', err.message);
    return 'unknown';
  }
}

/**
 * Check if a date is today
 * @param date - The date to check
 * @param options - Options including timezone
 * @returns True if the date is today
 */
export function isToday(
  date: Date,
  options: { timezone?: string; serverTimezone?: boolean } = {}
): boolean {
  try {
    const { timezone, serverTimezone = true } = options;

    let targetTimezone = timezone;
    if (serverTimezone && !timezone) {
      targetTimezone = getServerTimezone();
    }

    let targetDate = date;
    if (targetTimezone && targetTimezone !== 'UTC') {
      targetDate = convertToTimezone(date, targetTimezone);
    }

    const today = new Date();
    let todayInTargetTz = today;
    if (targetTimezone && targetTimezone !== 'UTC') {
      todayInTargetTz = convertToTimezone(today, targetTimezone);
    }

    return (
      targetDate.getDate() === todayInTargetTz.getDate() &&
      targetDate.getMonth() === todayInTargetTz.getMonth() &&
      targetDate.getFullYear() === todayInTargetTz.getFullYear()
    );
  } catch {
    // Fallback to simple comparison
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  }
}

/**
 * Check if a date is yesterday
 * @param date - The date to check
 * @param options - Options including timezone
 * @returns True if the date is yesterday
 */
export function isYesterday(
  date: Date,
  options: { timezone?: string; serverTimezone?: boolean } = {}
): boolean {
  try {
    const { timezone, serverTimezone = true } = options;

    let targetTimezone = timezone;
    if (serverTimezone && !timezone) {
      targetTimezone = getServerTimezone();
    }

    let targetDate = date;
    if (targetTimezone && targetTimezone !== 'UTC') {
      targetDate = convertToTimezone(date, targetTimezone);
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    let yesterdayInTargetTz = yesterday;
    if (targetTimezone && targetTimezone !== 'UTC') {
      yesterdayInTargetTz = convertToTimezone(yesterday, targetTimezone);
    }

    return (
      targetDate.getDate() === yesterdayInTargetTz.getDate() &&
      targetDate.getMonth() === yesterdayInTargetTz.getMonth() &&
      targetDate.getFullYear() === yesterdayInTargetTz.getFullYear()
    );
  } catch {
    // Fallback to simple comparison
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return (
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear()
    );
  }
}

/**
 * Check if a date is within the last N days
 * @param date - The date to check
 * @param days - Number of days to check against
 * @param options - Options including timezone
 * @returns True if the date is within the last N days
 */
export function isWithinLastDays(
  date: Date,
  days: number,
  options: { timezone?: string; serverTimezone?: boolean } = {}
): boolean {
  try {
    const { timezone, serverTimezone = true } = options;

    let targetTimezone = timezone;
    if (serverTimezone && !timezone) {
      targetTimezone = getServerTimezone();
    }

    let targetDate = date;
    if (targetTimezone && targetTimezone !== 'UTC') {
      targetDate = convertToTimezone(date, targetTimezone);
    }

    const now = new Date();
    let nowInTargetTz = now;
    if (targetTimezone && targetTimezone !== 'UTC') {
      nowInTargetTz = convertToTimezone(now, targetTimezone);
    }

    const cutoff = new Date(
      nowInTargetTz.getTime() - days * 24 * 60 * 60 * 1000
    );
    return targetDate >= cutoff;
  } catch {
    // Fallback to simple comparison
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return date >= cutoff;
  }
}

/**
 * Format a date range in a user-friendly way
 * @param startDate - Start date
 * @param endDate - End date
 * @param options - Formatting options
 * @returns Formatted date range string
 */
export function formatDateRange(
  startDate: Date,
  endDate: Date,
  options: DateTimeFormatOptions = {}
): string {
  try {
    if (isToday(startDate, options) && isToday(endDate, options)) {
      return languageTexts[options.language || 'en'].today;
    }

    if (isYesterday(startDate, options) && isYesterday(endDate, options)) {
      return languageTexts[options.language || 'en'].yesterday;
    }

    const startFormatted = formatDateTimeForUser(startDate, {
      ...options,
      includeTime: false,
    });
    const endFormatted = formatDateTimeForUser(endDate, {
      ...options,
      includeTime: false,
    });

    if (startFormatted === endFormatted) {
      return startFormatted;
    }

    return `${startFormatted} - ${endFormatted}`;
  } catch (error) {
    const err = error as Error;
    console.error('Error formatting date range:', err.message);
    return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
  }
}

/**
 * Get available timezones
 * @returns Array of common timezone identifiers
 */
export function getAvailableTimezones(): string[] {
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Rome',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
}

/**
 * Get the current time in a specific timezone
 * @param timezone - The timezone to get the time for
 * @returns The current time in the specified timezone
 */
export function getCurrentTimeInTimezone(timezone: string): Date {
  try {
    const now = new Date();
    return convertToTimezone(now, timezone);
  } catch {
    return new Date();
  }
}

/**
 * Checks if `value` is empty.
 * - For `null` or `undefined`, returns true.
 * - For strings and arrays, returns true if length is 0.
 * - For Maps, Sets, WeakMaps, WeakSets, returns true if size is 0.
 * - For plain objects, returns true if it has no own enumerable properties.
 * - For arguments objects, returns true if length is 0.
 * - For all other types, returns false.
 */
export function isEmpty(value: any): boolean {
  if (value == null) return true;

  // String, Array, Arguments
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }

  if (
    typeof value === 'object' &&
    Object.prototype.toString.call(value) === '[object Arguments]'
  ) {
    return value.length === 0;
  }

  // Map, Set, WeakMap, WeakSet
  if (value instanceof Map || value instanceof Set) {
    return value.size === 0;
  }

  // WeakMap, WeakSet (cannot enumerate, but treat as empty if no keys)
  if (value instanceof WeakMap || value instanceof WeakSet) {
    // WeakMap/WeakSet do not expose size or keys, so cannot determine emptiness reliably
    return false;
  }

  if (
    typeof Buffer !== 'undefined' &&
    typeof Buffer.isBuffer === 'function' &&
    Buffer.isBuffer(value)
  ) {
    return value.length === 0;
  }

  // TypedArray
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return (value as unknown as { length: number }).length === 0;
  }

  if (typeof value === 'object') {
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Deep merge function similar to lodash/merge
 * Recursively merges own and inherited enumerable string keyed properties of source objects into the destination object.
 * Source properties that resolve to undefined are skipped if a destination value exists.
 * Array and plain object properties are merged recursively.
 * Other objects and value types are overridden by assignment.
 * Source objects are applied from left to right.
 *
 * @param target - The destination object
 * @param sources - The source objects to merge
 * @returns The merged object
 */
export function deepMerge(target: any, ...sources: any[]): any {
  if (!isObject(target)) {
    target = {};
  }

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!isObject(source)) {
      continue;
    }

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        // Block prototype pollution vectors
        if (
          key === '__proto__' ||
          key === 'constructor' ||
          key === 'prototype'
        ) {
          continue;
        }

        const targetValue = target[key];
        const sourceValue = source[key];

        if (
          isObject(sourceValue) &&
          !isArray(sourceValue) &&
          !isDate(sourceValue) &&
          !isRegExp(sourceValue)
        ) {
          if (
            isObject(targetValue) &&
            !isArray(targetValue) &&
            !isDate(targetValue) &&
            !isRegExp(targetValue)
          ) {
            target[key] = deepMerge(targetValue, sourceValue);
          } else {
            target[key] = deepMerge({}, sourceValue);
          }
        } else {
          target[key] = sourceValue;
        }
      }
    }
  }

  return target;
}

/**
 * Check if value is a plain object (not array, date, regex, etc.)
 */
function isObject(value: any): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !isArray(value) &&
    !isDate(value) &&
    !isRegExp(value) &&
    !isBuffer(value) &&
    !isMap(value) &&
    !isSet(value) &&
    !isWeakMap(value) &&
    !isWeakSet(value)
  );
}

/**
 * Check if value is an array
 */
function isArray(value: any): boolean {
  return Array.isArray(value);
}

/**
 * Check if value is a Date
 */
function isDate(value: any): boolean {
  return value instanceof Date;
}

/**
 * Check if value is a RegExp
 */
function isRegExp(value: any): boolean {
  return value instanceof RegExp;
}

/**
 * Check if value is a Buffer (Node.js)
 */
function isBuffer(value: any): boolean {
  return (
    typeof Buffer !== 'undefined' &&
    typeof Buffer.isBuffer === 'function' &&
    Buffer.isBuffer(value)
  );
}

/**
 * Check if value is a Map
 */
function isMap(value: any): boolean {
  return value instanceof Map;
}

/**
 * Check if value is a Set
 */
function isSet(value: any): boolean {
  return value instanceof Set;
}

/**
 * Check if value is a WeakMap
 */
function isWeakMap(value: any): boolean {
  return value instanceof WeakMap;
}

/**
 * Check if value is a WeakSet
 */
function isWeakSet(value: any): boolean {
  return value instanceof WeakSet;
}
export const capitalizeFirstLetter = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Generates a cryptographically secure random string or token of the given length
 * (Use for secrets, tokens, etc.)
 */
export function generateSecureRandomString(length: number = 32): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}
