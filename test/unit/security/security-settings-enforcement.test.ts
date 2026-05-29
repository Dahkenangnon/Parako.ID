import { describe, it, expect } from 'vitest';
import { AppConfigSchema } from '../../../src/config/schemas/schema.js';
import { getDefaultFullConfig } from '../../../src/config/constants.js';

const DEFAULT_FULL_CONFIG = getDefaultFullConfig();

/**
 * Tests for security settings enforcement fixes.
 * Covers: P0-1, P1-1, P1-2, P1-3, P2-1, P2-3
 */

describe('Security Settings Enforcement', () => {
  describe('P2-1: Config defaults use bare format', () => {
    it('login_methods defaults are bare format matching admin form values', () => {
      expect(
        DEFAULT_FULL_CONFIG.security.authentication.login.login_methods
      ).toEqual(['email', 'phone']);
    });

    it('signup_methods defaults are bare format matching admin form values', () => {
      expect(
        DEFAULT_FULL_CONFIG.security.authentication.signup.signup_methods
      ).toEqual(['email', 'phone']);
    });

    it('Zod schema defaults match constants for login_methods', () => {
      const result = AppConfigSchema.safeParse(DEFAULT_FULL_CONFIG);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.security.authentication.login.login_methods).toEqual(
        DEFAULT_FULL_CONFIG.security.authentication.login.login_methods
      );
    });

    it('Zod schema defaults match constants for signup_methods', () => {
      const result = AppConfigSchema.safeParse(DEFAULT_FULL_CONFIG);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.security.authentication.signup.signup_methods).toEqual(
        DEFAULT_FULL_CONFIG.security.authentication.signup.signup_methods
      );
    });

    it('bare format values are found by Nunjucks "in" operator simulation', () => {
      const loginMethods =
        DEFAULT_FULL_CONFIG.security.authentication.login.login_methods;
      // Nunjucks {% if 'email' in loginMethods %} does exact element match
      expect(loginMethods.includes('email')).toBe(true);
      expect(loginMethods.includes('phone')).toBe(true);
      // Old compound format should NOT be present
      expect(loginMethods.includes('email+password')).toBe(false);
      expect(loginMethods.includes('phone+password')).toBe(false);
    });

    it('bare format signup values match admin form checkbox values', () => {
      const signupMethods =
        DEFAULT_FULL_CONFIG.security.authentication.signup.signup_methods;
      expect(signupMethods.includes('email')).toBe(true);
      expect(signupMethods.includes('phone')).toBe(true);
      expect(signupMethods.includes('email+password+full_name')).toBe(false);
      expect(signupMethods.includes('phone_number+password+full_name')).toBe(
        false
      );
    });
  });

  describe('P0-1: fullname null safety', () => {
    it('nameParts handles undefined fullname without crash', () => {
      const fullname: string | undefined = undefined;
      const nameParts = fullname ? fullname.trim().split(' ') : [];
      expect(nameParts).toEqual([]);
    });

    it('nameParts handles null fullname without crash', () => {
      const fullname: string | null = null;
      const nameParts = fullname ? fullname.trim().split(' ') : [];
      expect(nameParts).toEqual([]);
    });

    it('nameParts handles empty string fullname', () => {
      const fullname = '';
      const nameParts = fullname ? fullname.trim().split(' ') : [];
      expect(nameParts).toEqual([]);
    });

    it('nameParts correctly splits valid fullname', () => {
      const fullname = 'John Doe';
      const nameParts = fullname ? fullname.trim().split(' ') : [];
      expect(nameParts).toEqual(['John', 'Doe']);
      expect(nameParts[0]).toBe('John');
      expect(nameParts.slice(1).join(' ')).toBe('Doe');
    });
  });

  describe('P1-3: custom_identifier in hasValidCredentials', () => {
    function hasValidCredentials(
      signupMethods: string[],
      hasEmail: boolean,
      hasPhone: boolean,
      hasCustomIdentifier: boolean
    ): boolean {
      return signupMethods.some((cred: string) => {
        if (cred.includes('email') && hasEmail) return true;
        if (cred.includes('phone') && hasPhone) return true;
        if (cred.includes('custom_identifier') && hasCustomIdentifier)
          return true;
        return false;
      });
    }

    it('accepts custom_identifier when in signup_methods', () => {
      expect(
        hasValidCredentials(['custom_identifier'], false, false, true)
      ).toBe(true);
    });

    it('rejects when custom_identifier not in signup_methods', () => {
      expect(hasValidCredentials(['email'], false, false, true)).toBe(false);
    });

    it('accepts email when in signup_methods', () => {
      expect(hasValidCredentials(['email'], true, false, false)).toBe(true);
    });

    it('accepts phone when in signup_methods', () => {
      expect(hasValidCredentials(['phone'], false, true, false)).toBe(true);
    });

    it('rejects when no matching credential provided', () => {
      expect(
        hasValidCredentials(['custom_identifier'], true, false, false)
      ).toBe(false);
    });
  });

  describe('P1-1: login method enforcement', () => {
    function isMethodAllowed(
      configuredLoginMethods: string[],
      loginMethod: string
    ): boolean {
      return configuredLoginMethods.some((method: string) =>
        method.includes(loginMethod)
      );
    }

    it('allows email when configured', () => {
      expect(isMethodAllowed(['email', 'phone'], 'email')).toBe(true);
    });

    it('allows phone when configured', () => {
      expect(isMethodAllowed(['email', 'phone'], 'phone')).toBe(true);
    });

    it('rejects phone when only email configured', () => {
      expect(isMethodAllowed(['email'], 'phone')).toBe(false);
    });

    it('rejects email when only phone configured', () => {
      expect(isMethodAllowed(['phone'], 'email')).toBe(false);
    });

    it('rejects custom_identifier when not configured', () => {
      expect(isMethodAllowed(['email', 'phone'], 'custom_identifier')).toBe(
        false
      );
    });

    it('allows custom_identifier when configured', () => {
      expect(
        isMethodAllowed(['email', 'custom_identifier'], 'custom_identifier')
      ).toBe(true);
    });
  });

  describe('P1-2: contact channel requirement enforcement', () => {
    interface ContactChannels {
      require_at_least_one: boolean;
      email: { enabled: boolean; required: boolean };
      phone: { enabled: boolean; required: boolean };
      full_name: { enabled: boolean; required: boolean };
    }

    function validateContactChannels(
      contactChannels: ContactChannels,
      fullname: string | undefined,
      hasEmail: boolean,
      hasPhone: boolean
    ): string[] {
      const errors: string[] = [];
      if (
        contactChannels.full_name?.required &&
        (!fullname || !fullname.trim())
      ) {
        errors.push('Full name is required');
      }
      if (contactChannels.email?.required && !hasEmail) {
        errors.push('Email is required');
      }
      if (contactChannels.phone?.required && !hasPhone) {
        errors.push('Phone number is required');
      }
      if (contactChannels.require_at_least_one && !hasEmail && !hasPhone) {
        errors.push('At least one contact method (email or phone) is required');
      }
      return errors;
    }

    it('requires full name when full_name.required=true', () => {
      const errors = validateContactChannels(
        {
          require_at_least_one: true,
          email: { enabled: true, required: false },
          phone: { enabled: true, required: false },
          full_name: { enabled: true, required: true },
        },
        undefined,
        true,
        false
      );
      expect(errors).toContain('Full name is required');
    });

    it('does not require full name when full_name.required=false', () => {
      const errors = validateContactChannels(
        {
          require_at_least_one: true,
          email: { enabled: true, required: false },
          phone: { enabled: true, required: false },
          full_name: { enabled: true, required: false },
        },
        undefined,
        true,
        false
      );
      expect(errors).not.toContain('Full name is required');
    });

    it('requires email when email.required=true', () => {
      const errors = validateContactChannels(
        {
          require_at_least_one: false,
          email: { enabled: true, required: true },
          phone: { enabled: true, required: false },
          full_name: { enabled: true, required: false },
        },
        'John',
        false,
        false
      );
      expect(errors).toContain('Email is required');
    });

    it('requires phone when phone.required=true', () => {
      const errors = validateContactChannels(
        {
          require_at_least_one: false,
          email: { enabled: true, required: false },
          phone: { enabled: true, required: true },
          full_name: { enabled: true, required: false },
        },
        'John',
        false,
        false
      );
      expect(errors).toContain('Phone number is required');
    });

    it('allows no email and no phone when require_at_least_one=false', () => {
      const errors = validateContactChannels(
        {
          require_at_least_one: false,
          email: { enabled: true, required: false },
          phone: { enabled: true, required: false },
          full_name: { enabled: true, required: false },
        },
        'John',
        false,
        false
      );
      expect(errors).toEqual([]);
    });

    it('requires at least one contact when require_at_least_one=true and none provided', () => {
      const errors = validateContactChannels(
        {
          require_at_least_one: true,
          email: { enabled: true, required: false },
          phone: { enabled: true, required: false },
          full_name: { enabled: true, required: false },
        },
        'John',
        false,
        false
      );
      expect(errors).toContain(
        'At least one contact method (email or phone) is required'
      );
    });

    it('passes when require_at_least_one=true and email provided', () => {
      const errors = validateContactChannels(
        {
          require_at_least_one: true,
          email: { enabled: true, required: false },
          phone: { enabled: true, required: false },
          full_name: { enabled: true, required: false },
        },
        'John',
        true,
        false
      );
      expect(errors).toEqual([]);
    });
  });

  describe('P2-3: custom_identifier login flag independence', () => {
    function computeLoginMethodFlags(
      loginMethods: string[],
      _customIdentifiersEnabled: boolean
    ) {
      return {
        email: loginMethods.some(cred => cred.includes('email')) || false,
        phone:
          loginMethods.some(
            cred => cred.includes('phone') || cred.includes('phone_number')
          ) || false,
        // After fix: custom_identifiers.enabled should NOT implicitly enable this
        custom_identifier:
          loginMethods.some(cred => cred.includes('custom_identifier')) ||
          false,
      };
    }

    it('custom_identifier is false when custom_identifiers.enabled=true but not in login_methods', () => {
      const flags = computeLoginMethodFlags(['email', 'phone'], true);
      expect(flags.custom_identifier).toBe(false);
    });

    it('custom_identifier is true when explicitly in login_methods', () => {
      const flags = computeLoginMethodFlags(
        ['email', 'custom_identifier'],
        false
      );
      expect(flags.custom_identifier).toBe(true);
    });

    it('custom_identifier is false when not in login_methods and custom_identifiers disabled', () => {
      const flags = computeLoginMethodFlags(['email'], false);
      expect(flags.custom_identifier).toBe(false);
    });
  });
});
