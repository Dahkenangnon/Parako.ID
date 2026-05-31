import { describe, it, expect } from 'vitest';

import {
  emailSchema,
  limitSchema,
  pageSchema,
  redirectStringSchema,
  searchSchema,
  slugSchema,
  sortOrderSchema,
  stringBoolSchema,
  urlSchema,
  usernameSchema,
  uuidSchema,
} from '../../../src/validators/base-schemas.js';

describe('emailSchema', () => {
  it('accepts a valid email and trims surrounding whitespace', () => {
    expect(emailSchema.parse('  user@example.com  ')).toBe('user@example.com');
  });

  it('rejects a non-email string', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('rejects an email over 254 characters (RFC 3696 §3)', () => {
    const long = `${'a'.repeat(250)}@x.io`;
    expect(emailSchema.safeParse(long).success).toBe(false);
  });
});

describe('uuidSchema', () => {
  it('accepts a v4 UUID', () => {
    expect(
      uuidSchema.parse('00000000-0000-4000-8000-000000000000')
    ).toBeTruthy();
  });

  it('rejects garbage', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('slugSchema', () => {
  it('accepts a kebab/underscore slug', () => {
    expect(slugSchema.parse('my-tenant_42')).toBe('my-tenant_42');
  });

  it('rejects uppercase letters', () => {
    expect(slugSchema.safeParse('NotASlug').success).toBe(false);
  });

  it('rejects a leading hyphen', () => {
    expect(slugSchema.safeParse('-leading').success).toBe(false);
  });
});

describe('urlSchema', () => {
  it('accepts an https URL', () => {
    expect(urlSchema.parse('https://example.com/path')).toBe(
      'https://example.com/path'
    );
  });

  it('rejects a javascript: scheme (XSS sink)', () => {
    expect(urlSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('rejects an ftp scheme', () => {
    expect(urlSchema.safeParse('ftp://example.com').success).toBe(false);
  });
});

describe('pageSchema', () => {
  it('coerces a numeric string to a number', () => {
    expect(pageSchema.parse('5')).toBe(5);
  });

  it('returns the default 1 on undefined input', () => {
    expect(pageSchema.parse(undefined)).toBe(1);
  });

  it('rejects values below the minimum of 1', () => {
    expect(pageSchema.safeParse('0').success).toBe(false);
  });

  it('rejects values above the upper bound', () => {
    expect(pageSchema.safeParse('1000000').success).toBe(false);
  });
});

describe('limitSchema', () => {
  it('coerces and accepts 1..100', () => {
    expect(limitSchema.parse('20')).toBe(20);
    expect(limitSchema.parse('100')).toBe(100);
  });

  it('rejects values above 100', () => {
    expect(limitSchema.safeParse('500').success).toBe(false);
  });

  it('rejects values below 1', () => {
    expect(limitSchema.safeParse('0').success).toBe(false);
  });
});

describe('sortOrderSchema', () => {
  it('accepts asc and desc', () => {
    expect(sortOrderSchema.parse('asc')).toBe('asc');
    expect(sortOrderSchema.parse('desc')).toBe('desc');
  });

  it('rejects anything else', () => {
    expect(sortOrderSchema.safeParse('sideways').success).toBe(false);
    expect(sortOrderSchema.safeParse('ASC').success).toBe(false);
  });
});

describe('searchSchema', () => {
  it('accepts an empty/undefined value', () => {
    expect(searchSchema.parse(undefined)).toBeUndefined();
  });

  it('escapes regex metacharacters (ReDoS / NoSQL-injection guard)', () => {
    expect(searchSchema.parse('a.b*c')).toBe('a\\.b\\*c');
  });

  it('trims surrounding whitespace before escaping', () => {
    expect(searchSchema.parse('   hello   ')).toBe('hello');
  });

  it('rejects values over 200 characters', () => {
    expect(searchSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });
});

describe('usernameSchema', () => {
  it('trims and escapes regex metacharacters', () => {
    expect(usernameSchema.parse('  ad.min  ')).toBe('ad\\.min');
  });

  it('rejects an empty string', () => {
    expect(usernameSchema.safeParse('').success).toBe(false);
  });

  it('rejects values over 100 characters', () => {
    expect(usernameSchema.safeParse('x'.repeat(101)).success).toBe(false);
  });
});

describe('stringBoolSchema', () => {
  it("accepts the literal strings 'true' and 'false'", () => {
    expect(stringBoolSchema.parse('true')).toBe('true');
    expect(stringBoolSchema.parse('false')).toBe('false');
  });

  it('rejects boolean true / false (string contract must be preserved)', () => {
    expect(stringBoolSchema.safeParse(true).success).toBe(false);
    expect(stringBoolSchema.safeParse(false).success).toBe(false);
  });

  it("rejects 'TRUE', '1', '0', empty string", () => {
    expect(stringBoolSchema.safeParse('TRUE').success).toBe(false);
    expect(stringBoolSchema.safeParse('1').success).toBe(false);
    expect(stringBoolSchema.safeParse('0').success).toBe(false);
    expect(stringBoolSchema.safeParse('').success).toBe(false);
  });
});

describe('redirectStringSchema', () => {
  it('accepts an undefined value (optional)', () => {
    expect(redirectStringSchema.parse(undefined)).toBeUndefined();
  });

  it('accepts a same-origin path (trust check runs later in RedirectAuthority)', () => {
    expect(redirectStringSchema.parse('/account')).toBe('/account');
  });

  it('accepts an http(s) URL string (no trust check at this layer)', () => {
    expect(redirectStringSchema.parse('https://example.com/x')).toBe(
      'https://example.com/x'
    );
  });

  it('rejects values longer than 2048 characters', () => {
    expect(redirectStringSchema.safeParse(`/${'x'.repeat(2048)}`).success).toBe(
      false
    );
  });
});
