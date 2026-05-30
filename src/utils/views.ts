import nunjucks from 'nunjucks';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatDateTimeForUser,
  getShortRelativeTime,
  formatDateTimeWithMetadata,
  getAvailableTimezones,
  type DateTimeFormatOptions,
  type SupportedLanguage,
} from './misc.js';

type AssetManifest = Readonly<Record<string, string>>;

const MANIFEST_PATH = resolve(process.cwd(), 'public/manifest.json');
let cachedManifest: AssetManifest | null = null;

function loadManifest(): AssetManifest {
  if (cachedManifest !== null) return cachedManifest;

  if (!existsSync(MANIFEST_PATH)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Asset manifest not found at ${MANIFEST_PATH}. ` +
          'Run `pnpm build` to generate it.'
      );
    }
    cachedManifest = {};
    return cachedManifest;
  }

  try {
    cachedManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    return cachedManifest as AssetManifest;
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Asset manifest at ${MANIFEST_PATH} is malformed: ${(err as Error).message}`
      );
    }
    cachedManifest = {};
    return cachedManifest;
  }
}

/**
 * Resolve a logical asset path to its content-hashed URL.
 *
 * Logical paths are written without a leading slash and match the keys in
 * `public/manifest.json`. When the manifest is absent (development without a
 * build) the helper returns the logical path with a leading slash so the
 * static middleware can serve the unhashed source.
 */
export function resolveAssetPath(logicalPath: string): string {
  const normalized = logicalPath.replace(/^\/+/, '');
  const manifest = loadManifest();
  const resolved = manifest[normalized];
  return `/${resolved ?? normalized}`;
}

/**
 * Format time using native Intl.DateTimeFormat
 * @param date - Date to format
 * @param format24h - Whether to use 24-hour format
 * @param includeSeconds - Whether to include seconds
 * @returns Formatted time string
 */
function formatTime(
  date: Date,
  format24h = true,
  includeSeconds = false
): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !format24h,
  };
  if (includeSeconds) {
    options.second = '2-digit';
  }
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

/**
 * Format date with a custom format string (simplified version)
 * Supports common patterns like YYYY-MM-DD, HH:mm:ss, etc.
 * @param date - Date to format
 * @param format - Format string
 * @returns Formatted date string
 */
function formatWithPattern(date: Date, format: string): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const hours12 = hours % 12 || 12;
  const ampm = hours >= 12 ? 'PM' : 'AM';

  return format
    .replace('YYYY', year.toString())
    .replace('YY', year.toString().slice(-2))
    .replace('MM', pad(month))
    .replace('M', month.toString())
    .replace('DD', pad(day))
    .replace('D', day.toString())
    .replace('HH', pad(hours))
    .replace('H', hours.toString())
    .replace('hh', pad(hours12))
    .replace('h', hours12.toString())
    .replace('mm', pad(minutes))
    .replace('m', minutes.toString())
    .replace('ss', pad(seconds))
    .replace('s', seconds.toString())
    .replace('A', ampm)
    .replace('a', ampm.toLowerCase());
}

/**
 * HTML escape map for preventing XSS
 */
const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
};

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param str - String to escape
 * @returns Escaped string safe for HTML output
 */
export function escapeHtml(str: any): string {
  if (!str || typeof str !== 'string') return str ?? '';
  return str.replace(/[&<>"'/]/g, match => htmlEscapes[match]);
}

/**
 * Validate that a URL uses HTTP or HTTPS protocol
 * Blocks dangerous schemes like javascript:, data:, vbscript:
 * @param url - URL string to validate
 * @returns true if URL is valid HTTP/HTTPS, false otherwise
 */
export function isValidHttpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validate that a value is a safe picture URL — either an absolute HTTP(S) URL
 * (e.g. social login avatars from Google/GitHub) or a relative path starting
 * with "/" (local uploads or signed media URLs).
 *
 * Blocks dangerous schemes: javascript:, data:, vbscript:, etc.
 *
 * @param url - URL string to validate
 * @returns true if URL is safe for use as an image src
 */
export function isValidPictureUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  // Accept absolute HTTP(S) URLs (e.g. social login avatars)
  if (isValidHttpUrl(url)) return true;
  // Block dangerous schemes by rejecting anything containing ":"
  if (url.includes(':')) return false;
  // Accept relative paths with or without leading /
  // Storage keys like "tid/avatars/img.png" and legacy "/uploads/..." both valid
  return true;
}

/**
 * Configure Nunjucks environment with custom filters and globals
 * @param env - The Nunjucks environment to configure
 */
export function configureNunjucks(env: nunjucks.Environment): void {
  addGlobalFunctions(env);

  addCustomFilters(env);
}

/**
 * Add global functions to Nunjucks environment
 * @param env - The Nunjucks environment
 */
function addGlobalFunctions(env: nunjucks.Environment): void {
  env.addGlobal('hasFlash', function (this: any) {
    return (
      this.ctx &&
      this.ctx.flash &&
      (this.ctx.flash.success.length ||
        this.ctx.flash.error.length ||
        this.ctx.flash.info.length ||
        this.ctx.flash.warning.length)
    );
  });

  env.addGlobal('currentYear', new Date().getFullYear());

  env.addGlobal('isDevelopment', process.env.NODE_ENV === 'development');
  env.addGlobal('isProduction', process.env.NODE_ENV === 'production');

  env.addGlobal('availableTimezones', getAvailableTimezones());

  env.addGlobal('asset', (logicalPath: string) =>
    resolveAssetPath(logicalPath)
  );
}

/**
 * Add custom filters to Nunjucks environment
 * @param env - The Nunjucks environment
 */
function addCustomFilters(env: nunjucks.Environment): void {
  // Enhanced date formatting filter using our datetime utility
  // Usage: {{ date | date("format", displayTimezone) }} or {{ date | date(options) }}
  env.addFilter(
    'date',
    function (
      date: any,
      options: string | DateTimeFormatOptions = {},
      timezone?: string
    ) {
      if (!date) return '';

      const d = new Date(date);
      if (isNaN(d.getTime())) return date;

      // Handle legacy string format for backward compatibility
      // When a string format is passed, timezone can be provided as second argument
      if (typeof options === 'string') {
        const format = options;
        const tzOptions: DateTimeFormatOptions = {
          serverTimezone: false, // Disable server timezone when explicit timezone provided
          timezone: timezone || undefined,
        };

        if (format === 'MMM DD, YYYY') {
          return formatDateTimeForUser(d, {
            ...tzOptions,
            includeTime: false,
            includeYear: true,
          });
        } else if (
          format === 'MMM DD, YYYY HH:mm' ||
          format === 'MMM DD, YYYY HH:mm:ss'
        ) {
          return formatDateTimeForUser(d, {
            ...tzOptions,
            includeTime: true,
            includeYear: true,
          });
        } else if (format === 'DD/MM/YYYY HH:mm') {
          return formatDateTimeForUser(d, {
            ...tzOptions,
            includeTime: true,
            includeYear: true,
          });
        }
        // Use native format pattern for custom formats
        // Note: For custom patterns, we convert to timezone first if provided
        if (timezone) {
          const tzDate = new Date(
            d.toLocaleString('en-US', { timeZone: timezone })
          );
          return formatWithPattern(tzDate, format);
        }
        return formatWithPattern(d, format);
      }

      // Use our enhanced datetime utility with provided options
      return formatDateTimeForUser(d, options);
    }
  );

  // User-friendly datetime filter with full options
  env.addFilter(
    'datetime',
    function (date: any, options: DateTimeFormatOptions = {}) {
      if (!date) return '';

      const d = new Date(date);
      if (isNaN(d.getTime())) return date;

      return formatDateTimeForUser(d, options);
    }
  );

  // Short relative time filter using our utility
  env.addFilter(
    'relativeTime',
    function (date: any, options: { language?: SupportedLanguage } = {}) {
      if (!date) return '';

      const d = new Date(date);
      if (isNaN(d.getTime())) return date;

      return getShortRelativeTime(d, options);
    }
  );

  // Detailed datetime with metadata
  env.addFilter(
    'datetimeWithMetadata',
    function (date: any, options: DateTimeFormatOptions = {}) {
      if (!date) return '';

      const d = new Date(date);
      if (isNaN(d.getTime())) return date;

      return formatDateTimeWithMetadata(d, options);
    }
  );

  env.addFilter('time', function (date: any) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    return formatTime(d, true, true);
  });

  // Date only filter (without time)
  env.addFilter(
    'dateOnly',
    function (
      date: any,
      options: { language?: SupportedLanguage; timezone?: string } = {}
    ) {
      if (!date) return '';

      const d = new Date(date);
      if (isNaN(d.getTime())) return date;

      return formatDateTimeForUser(d, { ...options, includeTime: false });
    }
  );

  env.addFilter('timeOnly', function (date: any, format24h = false) {
    if (!date) return '';

    const d = new Date(date);
    if (isNaN(d.getTime())) return date;

    return formatTime(d, format24h, false);
  });

  env.addFilter('numberFormat', function (number: any) {
    if (number === undefined || number === null) return '';
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  });

  // JSON stringify filter
  env.addFilter('tojson', function (obj: any) {
    if (obj === undefined || obj === null) return 'null';
    try {
      return JSON.stringify(obj);
    } catch (error) {
      console.error(error as Error, { filter: 'tojson', obj });
      return 'null';
    }
  });

  env.addFilter('truncate', function (str: any, length = 30) {
    if (!str || typeof str !== 'string') return str;
    if (str.length <= length) return str;
    return `${str.substring(0, length)}...`;
  });

  // Capitalize first letter filter
  env.addFilter('capitalize', function (str: any) {
    if (!str || typeof str !== 'string') return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  });

  env.addFilter('lowercase', function (str: any) {
    if (!str || typeof str !== 'string') return str;
    return str.toLowerCase();
  });

  env.addFilter('uppercase', function (str: any) {
    if (!str || typeof str !== 'string') return str;
    return str.toUpperCase();
  });

  // URL safe filter
  env.addFilter('urlSafe', function (str: any) {
    if (!str || typeof str !== 'string') return str;
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  });

  env.addFilter('fileSize', function (bytes: any) {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 B';

    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    if (i === 0) return `${bytes} ${sizes[i]}`;
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  });

  env.addFilter(
    'pluralize',
    function (count: any, singular: string, plural?: string) {
      if (count === undefined || count === null) return '';

      const pluralForm = plural || `${singular}s`;
      return count === 1 ? singular : pluralForm;
    }
  );

  env.addFilter('default', function (value: any, defaultValue: any) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    return value;
  });

  // Escape HTML filter - uses exported escapeHtml function
  env.addFilter('escapeHtml', escapeHtml);

  // Markdown-like bold filter (XSS-safe: escapes input)
  env.addFilter('bold', function (str: any) {
    if (!str || typeof str !== 'string') return str;
    return `<strong>${escapeHtml(str)}</strong>`;
  });

  // Markdown-like italic filter (XSS-safe: escapes input)
  env.addFilter('italic', function (str: any) {
    if (!str || typeof str !== 'string') return str;
    return `<em>${escapeHtml(str)}</em>`;
  });

  // Link filter (XSS-safe: validates URL scheme and escapes all parameters)
  env.addFilter('link', function (text: any, url: string, className?: string) {
    if (!text || !url) return escapeHtml(text) || '';

    // Block dangerous URL schemes (javascript:, data:, vbscript:, etc.)
    if (!isValidHttpUrl(url)) {
      return escapeHtml(text);
    }

    const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
    return `<a href="${escapeHtml(url)}"${classAttr}>${escapeHtml(text)}</a>`;
  });

  // Status badge filter (XSS-safe: escapes status text and validates type)
  env.addFilter('statusBadge', function (status: any, type?: string) {
    if (!status) return '';

    // Validate type against allowed values to prevent class injection
    const allowedTypes = [
      'info',
      'success',
      'warning',
      'error',
      'primary',
      'secondary',
    ];
    const statusType = type && allowedTypes.includes(type) ? type : 'info';
    const statusClass = `badge badge-${statusType}`;
    return `<span class="${statusClass}">${escapeHtml(status)}</span>`;
  });

  env.addFilter(
    'currency',
    function (amount: any, currency = 'USD', locale = 'en-US') {
      if (amount === undefined || amount === null || isNaN(amount)) return '';

      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
        }).format(amount);
      } catch (error) {
        console.error(error as Error, {
          filter: 'currency',
          amount,
          currency,
          locale,
        });
        return `${currency} ${amount}`;
      }
    }
  );

  env.addFilter('percentage', function (value: any, decimals = 2) {
    if (value === undefined || value === null || isNaN(value)) return '';

    try {
      return `${(value * 100).toFixed(decimals)}%`;
    } catch (error) {
      console.error(error as Error, { filter: 'percentage', value, decimals });
      return `${value}%`;
    }
  });

  env.addFilter('age', function (birthDate: any) {
    if (!birthDate) return '';

    const birth = new Date(birthDate);
    if (isNaN(birth.getTime())) return '';

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }

    return age;
  });

  env.addFilter('daysAgo', function (date: any) {
    if (!date) return '';

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) return '';

    const today = new Date();
    const diffTime = Math.abs(today.getTime() - targetDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  });

  env.addFilter('isToday', function (date: any) {
    if (!date) return false;

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) return false;

    const today = new Date();
    return targetDate.toDateString() === today.toDateString();
  });

  env.addFilter('isYesterday', function (date: any) {
    if (!date) return false;

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) return false;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    return targetDate.toDateString() === yesterday.toDateString();
  });

  env.addFilter('mask_email', function (email: any) {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return email;
    }

    const [localPart, domain] = email.split('@');
    if (localPart.length <= 1) {
      return email;
    }

    return `${localPart.charAt(0) + '*'.repeat(localPart.length - 1)}@${domain}`;
  });

  env.addFilter('mask_phone', function (phone: any) {
    if (!phone || typeof phone !== 'string' || phone.length < 4) {
      return phone;
    }

    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 4) {
      return phone;
    }

    return '*'.repeat(cleaned.length - 4) + cleaned.slice(-4);
  });

  env.addFilter('hash', function (str: any) {
    if (!str || typeof str !== 'string') return '';

    // Simple hash function for generating short identifiers
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(16).substring(0, 8);
  });

  env.addFilter('join', function (arr: any, separator = ',') {
    if (!Array.isArray(arr)) return '';
    return arr.join(separator);
  });

  env.addFilter('length', function (arr: any) {
    if (!Array.isArray(arr)) return 0;
    return arr.length;
  });

  env.addFilter('includes', function (arr: any, value: any) {
    if (!Array.isArray(arr)) return false;
    return arr.includes(value);
  });

  env.addFilter('slice', function (str: any, start: number, end?: number) {
    if (!str || typeof str !== 'string') return '';
    if (end === undefined) {
      return str.slice(start);
    }
    return str.slice(start, end);
  });

  // Usage: {{ "primaryForeground" | kebabCase }} => "primary-foreground"
  env.addFilter('kebabCase', function (str: any) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  });

  // Math.max for arrays — returns the largest element
  // Usage: {{ [8, platformMin] | max }}
  env.addFilter('max', function (arr: any) {
    if (!Array.isArray(arr)) return arr;
    const nums = arr.filter((v: any) => typeof v === 'number' && !isNaN(v));
    return nums.length > 0 ? Math.max(...nums) : 0;
  });

  // Math.min for arrays — returns the smallest element
  // Usage: {{ [100, platformMax] | min }}
  env.addFilter('min', function (arr: any) {
    if (!Array.isArray(arr)) return arr;
    const nums = arr.filter((v: any) => typeof v === 'number' && !isNaN(v));
    return nums.length > 0 ? Math.min(...nums) : 0;
  });

  // Human-readable duration from seconds
  // Usage: {{ 3600 | duration }} → "1 hour", {{ 86400 | duration }} → "1 day"
  env.addFilter('duration', function (seconds: any) {
    if (!seconds || typeof seconds !== 'number') return 'unlimited';
    if (seconds >= 86400 && seconds % 86400 === 0) {
      const d = seconds / 86400;
      return `${d} day${d !== 1 ? 's' : ''}`;
    }
    if (seconds >= 3600 && seconds % 3600 === 0) {
      const h = seconds / 3600;
      return `${h} hour${h !== 1 ? 's' : ''}`;
    }
    if (seconds >= 60 && seconds % 60 === 0) {
      const m = seconds / 60;
      return `${m} minute${m !== 1 ? 's' : ''}`;
    }
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  });

  // Usage: {{ value | displayList }} → "en, fr, de"
  // Handles: arrays (joins), strings (pass-through), undefined/null (empty)
  env.addFilter('displayList', function (value: any) {
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'string') return value;
    return '';
  });
}
/**
 * Resolve a branding URL through the storage provider if it's a storage key.
 * Static asset paths (/images/*, /favicon.*) and external HTTP(S) URLs pass through unchanged.
 *
 * @param urlOrKey - A URL, static path, or storage key to resolve
 * @param getFileUrl - Callback that resolves a storage key to a signed/public URL
 * @returns The resolved URL string
 */
export function resolveBrandingUrl(
  urlOrKey: string | undefined | null,
  getFileUrl: (key: string) => string | Promise<string>
): string {
  if (!urlOrKey) return '';

  // External URLs pass through
  if (isValidHttpUrl(urlOrKey)) return urlOrKey;

  // Default static assets (served by express.static) pass through
  if (urlOrKey.startsWith('/images/') || urlOrKey.startsWith('/favicon')) {
    return urlOrKey;
  }

  // Anything else is either an old absolute `/uploads/...` path written
  // before the storage-provider abstraction, or a new storage key (the
  // provider-agnostic identifier). Both are resolved through the same
  // injected getFileUrl helper, which returns a string for local storage
  // and a Promise for S3-style providers — Nunjucks filters are sync,
  // so we fall through to the raw key when the resolver is async.
  const resolved = getFileUrl(urlOrKey);
  return typeof resolved === 'string' ? resolved : urlOrKey;
}

export default {
  configureNunjucks,
};
