import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import { OIDCUtils } from '../../../src/oidc/utils.js';

describe('OIDCUtils', () => {
  let config: ReturnType<typeof getDefaultFullConfig>;
  let configManager: Record<string, ReturnType<typeof vi.fn>>;
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let sessionManager: Record<string, ReturnType<typeof vi.fn>>;
  let userService: Record<string, ReturnType<typeof vi.fn>>;
  let activityService: Record<string, ReturnType<typeof vi.fn>>;
  let oidcAdapter: { client: { find: ReturnType<typeof vi.fn> } };
  let utils: OIDCUtils;
  let req: Request;

  const account = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.test',
      email_verified: true,
      given_name: 'Alice',
      family_name: 'Doe',
      full_name: 'Alice Doe',
      roles: ['user'],
      is_admin: false,
      last_used: 1,
      ...overrides,
    }) as any;

  beforeEach(() => {
    config = getDefaultFullConfig();
    configManager = { getConfig: vi.fn(() => config) };
    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    sessionManager = {
      get: vi.fn(),
      set: vi.fn(),
      getAuthenticatedUsers: vi.fn(),
      getActiveUser: vi.fn(),
      setAuthenticated: vi.fn(),
      addAuthenticatedUser: vi.fn(() => ({ success: true })),
      switchUser: vi.fn(() => ({ success: true })),
    };
    userService = { findByUsername: vi.fn() };
    activityService = {
      findActivitiesAroundTime: vi.fn().mockResolvedValue([]),
    };
    oidcAdapter = { client: { find: vi.fn() } };
    utils = new OIDCUtils(
      configManager as any,
      logger as any,
      sessionManager as any,
      userService as any,
      activityService as any,
      oidcAdapter as any
    );
    req = { body: {} } as Request;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('locale and cookie handling', () => {
    const ctx = (overrides: Record<string, unknown> = {}) =>
      ({ query: {}, request: { header: {} }, ...overrides }) as any;

    it('uses the caller default when no context exists', () => {
      expect(utils.getLocale(null as any, 'fr')).toBe('fr');
      expect(configManager.getConfig).not.toHaveBeenCalled();
    });

    it('uses the first supported space-separated ui_locales preference', () => {
      expect(
        utils.getLocale(ctx({ query: { ui_locales: 'xx fr-CA en' } }))
      ).toBe('fr');
    });

    it('continues to accept comma-separated ui_locales for compatibility', () => {
      expect(utils.getLocale(ctx({ query: { ui_locales: 'xx, de-DE' } }))).toBe(
        'de'
      );
    });

    it('reads ui_locales from the original URL when query metadata is absent', () => {
      expect(
        utils.getLocale(
          ctx({ originalUrl: '/authorize?client_id=rp&ui_locales=xx%20pt-BR' })
        )
      ).toBe('pt');
    });

    it('reads supported lang from query and original URL', () => {
      expect(utils.getLocale(ctx({ query: { lang: 'FR' } }))).toBe('fr');
      expect(utils.getLocale(ctx({ originalUrl: '/authorize?lang=ES' }))).toBe(
        'es'
      );
    });

    it('ignores unsupported query preferences before checking cookies', () => {
      const context = ctx({
        query: { ui_locales: 'xx-YY', lang: 'xx' },
        originalUrl: '/authorize?ui_locales=zz&lang=zz',
        request: { header: { cookie: 'locale=it' } },
      });

      expect(utils.getLocale(context)).toBe('it');
    });

    it('uses the primary supported Accept-Language value', () => {
      expect(
        utils.getLocale(
          ctx({ request: { header: { 'accept-language': 'DE-de,fr;q=0.8' } } })
        )
      ).toBe('de');
    });

    it('falls back when cookie and language headers are unsupported', () => {
      expect(
        utils.getLocale(
          ctx({
            request: {
              header: { cookie: 'locale=xx', 'accept-language': 'zz-ZZ' },
            },
          }),
          'ja'
        )
      ).toBe('ja');
    });

    it('falls back when request headers are unavailable', () => {
      expect(utils.getLocale({ query: {} } as any, 'ko')).toBe('ko');
    });

    it('parses cookie values containing equals signs and skips malformed entries', () => {
      expect(
        utils.parseCookies(
          ctx({
            request: { header: { cookie: 'locale=fr; token=a=b=c; bad' } },
          })
        )
      ).toEqual({ locale: 'fr', token: 'a=b=c' });
    });

    it.each([
      {},
      { request: {} },
      { request: { header: {} } },
      { request: { header: { cookie: 42 } } },
    ])('returns no cookies for unusable context %#', context => {
      expect(utils.parseCookies(context as any)).toEqual({});
    });
  });

  describe('session account management', () => {
    it('creates authentication state when the session has no account collection', () => {
      expect(utils.addOrUpdateAccountInSession(req, account())).toBe(true);
      expect(sessionManager.setAuthenticated).toHaveBeenCalledWith(req, {
        currentActiveLoggedUser: account(),
      });
    });

    it('adds a new account and preserves the requested active state', () => {
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: account(),
        others: [],
      });
      sessionManager.addAuthenticatedUser.mockReturnValue({ success: false });

      expect(
        utils.addOrUpdateAccountInSession(
          req,
          account({ id: 'user-2', username: 'bob' }),
          false
        )
      ).toBe(false);
      expect(sessionManager.addAuthenticatedUser).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ id: 'user-2' }),
        false
      );
    });

    it('refreshes the timestamp of an already-active account', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1234);
      const authenticatedUsers = { active: account(), others: [] };
      sessionManager.getAuthenticatedUsers.mockReturnValue(authenticatedUsers);

      expect(utils.addOrUpdateAccountInSession(req, account())).toBe(true);
      expect(authenticatedUsers.active.last_used).toBe(1234);
      expect(sessionManager.set).toHaveBeenCalledWith(
        req,
        'authenticatedUsers',
        authenticatedUsers
      );
    });

    it.each([
      [{ success: true }, true],
      [{ success: false, reason: 'reauth_required' }, true],
      [{ success: false, reason: 'not_found' }, false],
    ])('returns the account-switch result %#', (switchResult, expected) => {
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: account(),
        others: [account({ id: 'user-2', username: 'bob' })],
      });
      sessionManager.switchUser.mockReturnValue(switchResult);

      expect(
        utils.addOrUpdateAccountInSession(
          req,
          account({ id: 'user-2', username: 'bob' })
        )
      ).toBe(expected);
      expect(sessionManager.switchUser).toHaveBeenCalledWith(req, 'user-2');
    });

    it('does not switch an existing account when makeActive is false', () => {
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: account(),
        others: [account({ id: 'user-2', username: 'bob' })],
      });

      expect(
        utils.addOrUpdateAccountInSession(
          req,
          account({ id: 'user-2', username: 'bob' }),
          false
        )
      ).toBe(true);
      expect(sessionManager.switchUser).not.toHaveBeenCalled();
    });

    it('recognizes another account by username when its ID changed', () => {
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: account(),
        others: [account({ id: 'old-user-2', username: 'bob' })],
      });

      expect(
        utils.addOrUpdateAccountInSession(
          req,
          account({ id: 'new-user-2', username: 'bob' })
        )
      ).toBe(true);
      expect(sessionManager.switchUser).toHaveBeenCalledWith(req, 'new-user-2');
    });

    it('logs session-management failures and returns false', () => {
      const error = new Error('session unavailable');
      sessionManager.getAuthenticatedUsers.mockImplementation(() => {
        throw error;
      });

      expect(utils.addOrUpdateAccountInSession(req, account())).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(error, {
        context: 'Error managing account in session',
        username: 'alice',
      });
    });
  });

  describe('session synchronization after consent', () => {
    it('does nothing without an account ID', async () => {
      await utils.syncSessionAfterConsent(req, '');
      expect(sessionManager.getActiveUser).not.toHaveBeenCalled();
    });

    it.each([
      [account(), 'alice'],
      [account(), 'user-1'],
    ])(
      'does not sync an already-active account %#',
      async (active, accountId) => {
        sessionManager.getActiveUser.mockReturnValue(active);

        await utils.syncSessionAfterConsent(req, accountId);

        expect(logger.debug).toHaveBeenCalledWith(
          'Account already active, no session sync needed',
          { username: accountId }
        );
      }
    );

    it.each([
      [{ success: true }, 'Switched to existing account during OIDC consent'],
      [
        { success: false, reason: 'reauth_required' },
        'Account switch requires re-authentication during OIDC consent',
      ],
    ])('recognizes an existing session account %#', async (result, message) => {
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: account(),
        others: [account({ id: 'user-2', username: 'bob' })],
      });
      sessionManager.switchUser.mockReturnValue(result);

      await utils.syncSessionAfterConsent(req, 'bob');

      expect(logger.debug).toHaveBeenCalledWith(message, { switchedTo: 'bob' });
      expect(userService.findByUsername).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      'loads a missing account and records session update result %s',
      async success => {
        userService.findByUsername.mockResolvedValue({
          _id: { toString: () => 'db-user' },
          username: 'bob',
          email: 'bob@example.test',
          email_verified: undefined,
          given_name: 'Bob',
          family_name: undefined,
          roles: ['admin'],
        });
        vi.spyOn(utils, 'addOrUpdateAccountInSession').mockReturnValue(success);

        await utils.syncSessionAfterConsent(req, 'bob');

        expect(utils.addOrUpdateAccountInSession).toHaveBeenCalledWith(
          req,
          expect.objectContaining({
            id: 'db-user',
            username: 'bob',
            full_name: 'Bob',
            email_verified: false,
            roles: ['admin'],
            is_admin: true,
          }),
          true
        );
        expect(logger[success ? 'debug' : 'warn']).toHaveBeenCalledWith(
          success
            ? 'Successfully managed account in OIDC consent session'
            : 'Failed to manage account in consent session',
          { username: 'bob' }
        );
      }
    );

    it('does nothing when a missing account cannot be loaded', async () => {
      sessionManager.getAuthenticatedUsers.mockReturnValue(undefined);
      userService.findByUsername.mockResolvedValue(null);

      await utils.syncSessionAfterConsent(req, 'missing');

      expect(sessionManager.addAuthenticatedUser).not.toHaveBeenCalled();
    });

    it('queries storage when the session collection has no matching account', async () => {
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: account(),
        others: [],
      });
      userService.findByUsername.mockResolvedValue(null);

      await utils.syncSessionAfterConsent(req, 'missing');

      expect(userService.findByUsername).toHaveBeenCalledWith('missing');
      expect(sessionManager.switchUser).not.toHaveBeenCalled();
    });

    it('falls back to the database after an unsuccessful session switch', async () => {
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: account(),
        others: [account({ id: 'user-2', username: 'bob' })],
      });
      sessionManager.switchUser.mockReturnValue({
        success: false,
        reason: 'not_found',
      });
      userService.findByUsername.mockResolvedValue(null);

      await utils.syncSessionAfterConsent(req, 'bob');

      expect(userService.findByUsername).toHaveBeenCalledWith('bob');
    });

    it('finds another session account by ID', async () => {
      sessionManager.getAuthenticatedUsers.mockReturnValue({
        active: account(),
        others: [account({ id: 'user-2', username: 'bob' })],
      });

      await utils.syncSessionAfterConsent(req, 'user-2');

      expect(sessionManager.switchUser).toHaveBeenCalledWith(req, 'user-2');
      expect(userService.findByUsername).not.toHaveBeenCalled();
    });

    it.each([
      [
        {
          username: 'super',
          email: 'super@example.test',
          email_verified: true,
          given_name: '',
          family_name: 'Admin',
          roles: ['superadmin'],
        },
        expect.objectContaining({
          id: '',
          email_verified: true,
          full_name: 'Admin',
          roles: ['superadmin'],
          is_admin: true,
        }),
      ],
      [
        { username: 'member', email: 'member@example.test' },
        expect.objectContaining({
          id: '',
          full_name: '',
          roles: ['user'],
          is_admin: undefined,
        }),
      ],
    ])('applies database account defaults %#', async (dbUser, expected) => {
      userService.findByUsername.mockResolvedValue(dbUser);
      vi.spyOn(utils, 'addOrUpdateAccountInSession').mockReturnValue(true);

      await utils.syncSessionAfterConsent(req, dbUser.username);

      expect(utils.addOrUpdateAccountInSession).toHaveBeenCalledWith(
        req,
        expected,
        true
      );
    });

    it('contains synchronization failures', async () => {
      const error = new Error('session read failed');
      sessionManager.getActiveUser.mockImplementation(() => {
        throw error;
      });

      await expect(utils.syncSessionAfterConsent(req, 'alice')).resolves.toBe(
        undefined
      );
      expect(logger.error).toHaveBeenCalledWith(error, {
        context: 'Error syncing session after OIDC consent',
      });
    });
  });

  describe('interaction template data', () => {
    it('filters protocol-managed scopes and claims and preserves optional details', () => {
      sessionManager.get.mockReturnValue('csrf');

      expect(
        utils.prepareTemplateVariables(
          {
            details: {
              missingOIDCScope: ['openid', 'email', 'offline_access'],
              missingOIDCClaims: [
                'sub',
                'name',
                'sid',
                'auth_time',
                'acr',
                'amr',
                'iss',
              ],
              missingResourceScopes: { api: ['read'] },
              rar: [{ type: 'payment' }],
            },
          },
          {},
          req
        )
      ).toEqual({
        missingOIDCScope: ['email'],
        missingOIDCClaims: ['name'],
        missingResourceScopes: { api: ['read'] },
        rar: [{ type: 'payment' }],
        csrfToken: 'csrf',
      });
    });

    it('normalizes absent or malformed optional interaction details', () => {
      expect(
        utils.prepareTemplateVariables(
          { details: { missingOIDCScope: 'email', missingOIDCClaims: null } },
          {},
          req
        )
      ).toEqual({
        missingOIDCScope: [],
        missingOIDCClaims: [],
        missingResourceScopes: {},
        rar: [],
        csrfToken: undefined,
      });
    });

    it.each([
      [null, null],
      [
        { username: 'alice', given_name: 'Alice', family_name: 'Doe' },
        { displayName: 'alice', initials: 'AD' },
      ],
      [
        {
          username: 'alice',
          full_name: 'Alice D',
          given_name: '',
          family_name: '',
        },
        { displayName: 'Alice D', initials: 'AL' },
      ],
      [{}, { displayName: undefined, initials: 'U' }],
    ])('formats user template data %#', (input, expected) => {
      const result = utils.formatUserForTemplate(input);
      if (expected === null) expect(result).toBeNull();
      else expect(result).toEqual(expect.objectContaining(expected));
    });

    it('maps known and custom scopes to readable descriptions', () => {
      expect(
        utils.transformScopesForTemplate(
          new Set(['email', 'profile', 'phone', 'address', 'payments'])
        )
      ).toEqual([
        'Read your email address',
        'Access your basic profile information',
        'Access your phone number',
        'Access your address information',
        'Access to payments',
      ]);
      expect(utils.transformScopesForTemplate(new Set())).toEqual([
        'Access your basic account information',
      ]);
    });

    it('prepares active and other accounts with safe display fallbacks', () => {
      expect(
        utils.prepareAccountsList({
          active: account({ picture: '/alice.png' }),
          others: [
            account({
              id: 'user-2',
              username: 'bob',
              full_name: '',
              email: undefined,
              picture: undefined,
              given_name: '',
              family_name: '',
            }),
            account({
              id: 'user-3',
              username: '',
              full_name: '',
              given_name: '',
              family_name: '',
            }),
          ],
        })
      ).toEqual([
        expect.objectContaining({
          id: 'user-1',
          name: 'Alice Doe',
          avatar: '/alice.png',
          initials: 'AD',
          is_active: true,
        }),
        expect.objectContaining({
          id: 'user-2',
          name: 'bob',
          email: '',
          avatar: '',
          initials: 'BO',
          is_active: false,
        }),
        expect.objectContaining({ id: 'user-3', initials: 'U' }),
      ]);
    });

    it('uses username and initial fallbacks for the active account and names for others', () => {
      const result = utils.prepareAccountsList({
        active: {
          id: 'active',
          username: 'carol',
          full_name: '',
          given_name: '',
          family_name: '',
        },
        others: [
          {
            id: 'other',
            username: 'dan',
            given_name: 'Dan',
            family_name: 'Smith',
          },
        ],
      });

      expect(result).toEqual([
        expect.objectContaining({ name: 'carol', initials: 'CA' }),
        expect.objectContaining({ name: 'dan', initials: 'DS' }),
      ]);
    });

    it('uses U when the active account has no usable name', () => {
      expect(
        utils.prepareAccountsList({
          active: { id: 'active', username: '', full_name: '' },
          others: [],
        })
      ).toEqual([expect.objectContaining({ initials: 'U' })]);
    });

    it('supports account lists without an active account', () => {
      expect(utils.prepareAccountsList({ others: [] })).toEqual([]);
    });
  });

  describe('input validation and identifier detection', () => {
    it.each([
      [{}, { isValid: false }],
      [{ login: 'alice' }, { isValid: false }],
      [{ password: 'secret' }, { isValid: false }],
      [
        { login: 'alice', password: 'secret' },
        { isValid: true, identifier: 'alice', password: 'secret' },
      ],
    ])('validates login body %#', (body, expected) => {
      req.body = body;
      expect(utils.validateLoginCredentials(req)).toEqual(expected);
    });

    it.each([
      [undefined, 'email'],
      [null, 'email'],
      [42, 'email'],
      [' alice@example.test ', 'email'],
      ['+1 (555) 123-4567', 'phone'],
      ['123-45', 'email'],
    ])('detects identifier %# as %j', (identifier, expected) => {
      expect(utils.detectIdentifierType(identifier as any)).toEqual(expected);
    });

    it('matches configured regex and charset-mask identifiers', () => {
      config.security.authentication.custom_identifiers = {
        enabled: true,
        fields: [
          {
            slot: 1,
            key: 'employee_id',
            usable_for_login: true,
            validation_type: 'regex',
            pattern: 'EMP-[0-9]{4}',
          },
          {
            slot: 2,
            key: 'member_id',
            usable_for_login: true,
            validation_type: 'charset_mask',
            charset: 'digits',
            mask: '***-***',
          },
        ],
      } as any;

      expect(utils.detectIdentifierType('EMP-1234')).toEqual({
        type: 'custom_identifier',
        slot: 1,
        key: 'employee_id',
      });
      expect(utils.detectIdentifierType('123-456')).toEqual({
        type: 'custom_identifier',
        slot: 2,
        key: 'member_id',
      });
    });

    it('uses a sole patternless field after configured patterns fail', () => {
      config.security.authentication.custom_identifiers = {
        enabled: true,
        fields: [
          {
            slot: 1,
            key: 'employee_id',
            usable_for_login: true,
            validation_type: 'regex',
            pattern: 'EMP-[0-9]+',
          },
          {
            slot: 3,
            key: 'handle',
            usable_for_login: true,
            validation_type: 'none',
          },
        ],
      } as any;

      expect(utils.detectIdentifierType('plain-handle')).toEqual({
        type: 'custom_identifier',
        slot: 3,
        key: 'handle',
      });
    });

    it('falls through a non-matching charset mask to a patternless field', () => {
      config.security.authentication.custom_identifiers = {
        enabled: true,
        fields: [
          {
            slot: 2,
            key: 'member_id',
            usable_for_login: true,
            validation_type: 'charset_mask',
            charset: 'digits',
            mask: '***-***',
          },
          {
            slot: 3,
            key: 'handle',
            usable_for_login: true,
            validation_type: 'none',
          },
        ],
      } as any;

      expect(utils.detectIdentifierType('not-a-mask')).toEqual({
        type: 'custom_identifier',
        slot: 3,
        key: 'handle',
      });
    });

    it('falls back to the first loginable field when matching is ambiguous', () => {
      config.security.authentication.custom_identifiers = {
        enabled: true,
        fields: [
          {
            slot: 1,
            key: 'first',
            usable_for_login: true,
            validation_type: 'none',
          },
          {
            slot: 2,
            key: 'second',
            usable_for_login: true,
            validation_type: 'none',
          },
          {
            slot: 3,
            key: 'ignored',
            usable_for_login: false,
            validation_type: 'none',
          },
        ],
      } as any;

      expect(utils.detectIdentifierType('value')).toEqual({
        type: 'custom_identifier',
        slot: 1,
        key: 'first',
      });
    });

    it.each([false, true])(
      'falls back to email with no loginable custom fields (enabled=%s)',
      enabled => {
        config.security.authentication.custom_identifiers = {
          enabled,
          fields: enabled
            ? [
                {
                  slot: 1,
                  key: 'hidden',
                  usable_for_login: false,
                  validation_type: 'none',
                },
              ]
            : [],
        } as any;
        expect(utils.detectIdentifierType('plain-value')).toBe('email');
      }
    );

    it('treats an absent custom field array as empty', () => {
      config.security.authentication.custom_identifiers = {
        enabled: true,
        fields: undefined,
      } as any;
      expect(utils.detectIdentifierType('plain-value')).toBe('email');
    });

    it.each([
      [{ code: ' 123456 ' }, { isValid: true, code: '123456' }],
      [{ code: '   ' }, { isValid: false }],
      [{}, { isValid: false }],
    ])('validates MFA input %#', (body, expected) => {
      req.body = body;
      expect(utils.validateMfaCode(req)).toEqual(expected);
    });

    it.each([
      [{ account_id: 'user-1' }, { isValid: true, accountId: 'user-1' }],
      [{}, { isValid: false }],
    ])('validates account selection %#', (body, expected) => {
      req.body = body;
      expect(utils.validateAccountSelection(req)).toEqual(expected);
    });
  });

  describe('MFA, application, user-agent, and time helpers', () => {
    it.each([null, {}, { mfa: { enabled: false } }])(
      'reports no MFA for %#',
      user => {
        expect(utils.validateMfaSetup(user)).toEqual({ hasMfa: false });
      }
    );

    it('reports no MFA when enabled methods are incomplete', () => {
      expect(
        utils.validateMfaSetup({
          mfa: {
            enabled: true,
            methods: {
              totp: { enabled: true },
              webauthn: { enabled: true, credentials: [] },
            },
          },
        })
      ).toEqual({ hasMfa: false });
    });

    it('returns enabled methods and honors a valid preferred method', () => {
      expect(
        utils.validateMfaSetup({
          mfa: {
            enabled: true,
            preferred_method: 'webauthn',
            methods: {
              totp: { enabled: true, secret: 'secret' },
              email: { enabled: true },
              webauthn: { enabled: true, credentials: [{}] },
            },
          },
        })
      ).toEqual({
        hasMfa: true,
        method: 'webauthn',
        methods: ['totp', 'email', 'webauthn'],
      });
    });

    it('falls back to the first enabled MFA method', () => {
      expect(
        utils.validateMfaSetup({
          mfa: {
            enabled: true,
            preferred_method: 'webauthn',
            methods: { email: { enabled: true } },
          },
        })
      ).toEqual({ hasMfa: true, method: 'email', methods: ['email'] });
    });

    it('returns the configured application title', () => {
      config.application.title = 'Identity Demo';
      expect(utils.getAppTitle()).toBe('Identity Demo');
    });

    it('returns explicit unknowns for an absent user agent', () => {
      expect(utils.parseUserAgent('')).toEqual({
        browser: 'Unknown',
        os: 'Unknown',
        device: 'Unknown',
      });
    });

    it('parses desktop and mobile user agents', () => {
      expect(
        utils.parseUserAgent(
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36'
        )
      ).toEqual({ browser: 'Chrome', os: 'Linux', device: 'desktop' });
      expect(
        utils.parseUserAgent(
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
        )
      ).toEqual(expect.objectContaining({ device: 'mobile' }));
    });

    it('uses unknown fallbacks for an unrecognized user agent', () => {
      expect(utils.parseUserAgent('unrecognized')).toEqual({
        browser: 'Unknown',
        os: 'Unknown',
        device: 'desktop',
      });
    });

    it.each([
      [1, false, '1 day ago'],
      [2, false, '2 days ago'],
      [1 / 24, false, '1 hour ago'],
      [2 / 24, false, '2 hours ago'],
      [1 / 1440, false, '1 minute ago'],
      [2 / 1440, false, '2 minutes ago'],
      [0, false, 'Just now'],
      [1, true, '1 day from now'],
      [1 / 24, true, '1 hour from now'],
      [2 / 24, true, '2 hours from now'],
      [1 / 1440, true, '1 minute from now'],
      [2 / 1440, true, '2 minutes from now'],
      [0, true, 'Just now'],
    ])(
      'formats relative offset %s days (future=%s)',
      (days, future, expected) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
        const delta = days * 24 * 60 * 60;
        const now = Date.now() / 1000;
        expect(
          utils.formatTimeAgo(now + (future ? delta : -delta), future)
        ).toBe(expected);
      }
    );

    it('formats a timestamp as a localized date and time', () => {
      const result = utils.formatDate(1_700_000_000);
      expect(result).toContain(
        new Date(1_700_000_000_000).toLocaleDateString()
      );
      expect(result.length).toBeGreaterThan(10);
    });
  });

  describe('client and session enrichment', () => {
    it('returns no client metadata for an empty list', async () => {
      await expect(utils.getClientInfo([])).resolves.toEqual([]);
      expect(oidcAdapter.client.find).not.toHaveBeenCalled();
    });

    it('uses registered client metadata and fallback values', async () => {
      oidcAdapter.client.find
        .mockResolvedValueOnce({
          clientName: 'Demo RP',
          clientId: 'rp-1',
          clientUri: 'https://demo.example.test/app',
        })
        .mockResolvedValueOnce({ clientId: 'rp-2', clientUri: 42 })
        .mockResolvedValueOnce(null);

      await expect(
        utils.getClientInfo(['rp-1', 'rp-2', 'missing'])
      ).resolves.toEqual([
        { id: 'rp-1', name: 'Demo RP', developer: 'demo.example.test' },
        { id: 'rp-2', name: 'rp-2', developer: 'Unknown Developer' },
        {
          id: 'missing',
          name: 'Connected Application',
          developer: 'Unknown Developer',
        },
      ]);
    });

    it('contains per-client lookup and metadata URL failures', async () => {
      const error = new Error('registry unavailable');
      oidcAdapter.client.find
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({
          clientName: '',
          clientId: '',
          clientUri: 'not a URL',
        });

      await expect(
        utils.getClientInfo(['broken', 'invalid-uri'])
      ).resolves.toEqual([
        {
          id: 'broken',
          name: 'Connected Application',
          developer: 'Unknown Developer',
        },
        {
          id: 'invalid-uri',
          name: 'Connected Application',
          developer: 'Unknown Developer',
        },
      ]);
      expect(logger.error).toHaveBeenCalledTimes(2);
    });

    it('returns fallback metadata when client-list processing fails', async () => {
      const error = new Error('client list unavailable');
      const clientIds = ['rp-1'] as string[] & {
        map: ReturnType<typeof vi.fn>;
      };
      const originalMap = Array.prototype.map.bind(clientIds);
      clientIds.map = vi
        .fn()
        .mockImplementationOnce(() => {
          throw error;
        })
        .mockImplementation((callback: any) => originalMap(callback));

      await expect(utils.getClientInfo(clientIds)).resolves.toEqual([
        {
          id: 'rp-1',
          name: 'Connected Application',
          developer: 'Unknown Developer',
        },
      ]);
      expect(logger.error).toHaveBeenCalledWith(error, {
        context: 'Failed to get client info',
      });
    });

    it('enriches an active session with activity, client, and device data', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const now = Math.floor(Date.now() / 1000);
      activityService.findActivitiesAroundTime.mockResolvedValue([
        {
          actor: {
            email: 'alice@example.test',
            full_name: 'Alice Doe',
            given_name: 'Alice',
            family_name: 'Doe',
          },
        },
      ]);
      vi.spyOn(utils, 'parseUserAgent').mockReturnValue({
        browser: 'Browser',
        os: 'OS',
        device: 'desktop',
      });
      vi.spyOn(utils, 'getClientInfo').mockResolvedValue([{ id: 'rp-1' }]);
      vi.spyOn(utils, 'formatDate').mockReturnValue('formatted date');
      vi.spyOn(utils, 'formatTimeAgo')
        .mockReturnValueOnce('5 minutes ago')
        .mockReturnValueOnce('1 hour from now')
        .mockReturnValueOnce('5 minutes ago');

      const result = await utils.processSessionData({
        _id: 'db-session',
        payload: {
          jti: 'session-1',
          accountId: 'alice',
          loginTs: now - 300,
          exp: now + 3600,
          userAgent: 'ua',
          ip_address: '203.0.113.4',
          authorizations: { 'rp-1': {} },
          amr: ['pwd'],
          acr: 'urn:acr:1',
          user_agent: 'raw ua',
        },
      });

      expect(activityService.findActivitiesAroundTime).toHaveBeenCalledWith(
        'alice',
        now - 300,
        300
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: 'session-1',
          accountId: 'alice',
          userInfo: expect.objectContaining({ full_name: 'Alice Doe' }),
          device: 'Browser on OS',
          ip: '203.0.113.4',
          startTime: 'formatted date',
          expiresIn: '1 hour from now',
          isExpired: false,
          status: 'active',
          clients: [{ id: 'rp-1' }],
          amr: ['pwd'],
          acr: 'urn:acr:1',
          user_agent: 'raw ua',
        })
      );
    });

    it('uses stable defaults for a session without optional expiry or activity', async () => {
      vi.spyOn(utils, 'parseUserAgent').mockReturnValue({
        browser: 'Unknown',
        os: 'Unknown',
        device: 'Unknown',
      });
      vi.spyOn(utils, 'getClientInfo').mockResolvedValue([]);
      vi.spyOn(utils, 'formatDate').mockReturnValue('date');
      vi.spyOn(utils, 'formatTimeAgo').mockReturnValue('age');

      const result = await utils.processSessionData({
        _id: 'db-session',
        payload: { accountId: 'missing', iat: 100 },
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'db-session',
          userInfo: expect.objectContaining({ email: 'Unknown' }),
          ip: 'Unknown',
          expiresAt: null,
          expiresIn: 'Unknown',
          isExpired: false,
          status: 'active',
          amr: [],
          acr: '',
          user_agent: 'Unknown',
        })
      );
    });

    it('enriches session identity from the user when no matching activity exists', async () => {
      userService.findByUsername.mockResolvedValue(
        account({
          username: 'alice',
          email: 'alice@example.test',
          full_name: 'Alice Doe',
          given_name: 'Alice',
          family_name: 'Doe',
        })
      );
      vi.spyOn(utils, 'getClientInfo').mockResolvedValue([]);

      const result = await utils.processSessionData({
        _id: 'session-1',
        payload: { accountId: 'alice', iat: 100 },
      });

      expect(userService.findByUsername).toHaveBeenCalledWith('alice');
      expect(result.userInfo).toEqual({
        username: 'alice',
        email: 'alice@example.test',
        full_name: 'Alice Doe',
        given_name: 'Alice',
        family_name: 'Doe',
      });
    });

    it('logs activity lookup failures while still returning session data', async () => {
      const error = new Error('activity unavailable');
      activityService.findActivitiesAroundTime.mockRejectedValue(error);
      vi.spyOn(utils, 'getClientInfo').mockResolvedValue([]);

      await utils.processSessionData({
        _id: 'session',
        payload: { accountId: 'alice', iat: 100, exp: 1 },
      });

      expect(logger.error).toHaveBeenCalledWith(error, {
        context: 'Could not get user info for alice',
      });
    });

    it('contains current-user lookup failures while still returning session data', async () => {
      const error = new Error('user repository unavailable');
      userService.findByUsername.mockRejectedValue(error);
      vi.spyOn(utils, 'getClientInfo').mockResolvedValue([]);

      const result = await utils.processSessionData({
        _id: 'session',
        payload: { accountId: 'alice', iat: 100 },
      });

      expect(result.userInfo).toEqual(
        expect.objectContaining({ username: 'alice', email: 'Unknown' })
      );
      expect(logger.error).toHaveBeenCalledWith(error, {
        context: 'Could not get current user info for alice',
      });
    });

    it('uses activity identity fallbacks when actor details are absent', async () => {
      activityService.findActivitiesAroundTime.mockResolvedValue([
        { actor: {} },
      ]);
      vi.spyOn(utils, 'getClientInfo').mockResolvedValue([]);

      const result = await utils.processSessionData({
        _id: 'session',
        payload: { accountId: 'alice', iat: 100 },
      });

      expect(result.userInfo).toEqual({
        username: 'alice',
        email: 'Unknown',
        full_name: 'Unknown User',
        given_name: '',
        family_name: '',
      });
    });

    it('uses stable identity fallbacks when the current user has no profile fields', async () => {
      userService.findByUsername.mockResolvedValue(
        account({
          email: undefined,
          name: undefined,
          given_name: undefined,
          family_name: undefined,
        })
      );
      vi.spyOn(utils, 'getClientInfo').mockResolvedValue([]);

      const result = await utils.processSessionData({
        _id: 'session',
        payload: { accountId: 'alice', iat: 100 },
      });

      expect(result.userInfo).toEqual({
        username: 'alice',
        email: 'Unknown',
        full_name: 'Unknown User',
        given_name: '',
        family_name: '',
      });
    });

    it.each([
      [new Error('activity unavailable'), 'activity unavailable'],
      ['offline', 'offline'],
    ])(
      'exports a session with contained activity failure %#',
      async (error, message) => {
        activityService.findActivitiesAroundTime.mockRejectedValue(error);
        vi.spyOn(utils, 'parseUserAgent').mockReturnValue({
          browser: 'Browser',
          os: 'OS',
          device: 'desktop',
        });
        vi.spyOn(utils, 'formatDate').mockReturnValue('date');
        vi.spyOn(utils, 'formatTimeAgo').mockReturnValue('age');

        const result = await utils.processSessionForExport({
          _id: 'db-session',
          payload: { accountId: 'alice', iat: 100, amr: ['pwd'] },
        });

        expect(logger.debug).toHaveBeenCalledWith(
          'Error getting user info for export, using defaults',
          { error: message }
        );
        expect(result).toEqual(
          expect.objectContaining({
            'Session ID': 'db-session',
            Username: 'alice',
            Email: 'Unknown',
            'Full Name': 'Unknown User',
            'Expires At': 'Unknown',
            Status: 'Active',
            AMR: 'pwd',
            ACR: 'Unknown',
          })
        );
      }
    );

    it('exports activity identity and expired-session details', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      activityService.findActivitiesAroundTime.mockResolvedValue([
        { actor: { email: '', full_name: '' } },
      ]);
      vi.spyOn(utils, 'parseUserAgent').mockReturnValue({
        browser: 'Browser',
        os: 'OS',
        device: 'desktop',
      });
      vi.spyOn(utils, 'formatDate').mockReturnValue('date');
      vi.spyOn(utils, 'formatTimeAgo').mockReturnValue('age');

      const result = await utils.processSessionForExport({
        payload: {
          jti: 'session-1',
          accountId: 'alice',
          loginTs: 100,
          exp: 1,
          ip_address: '203.0.113.4',
          acr: 'acr',
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          Email: 'Unknown',
          'Full Name': 'Unknown User',
          'IP Address': '203.0.113.4',
          'Expires At': 'date',
          Status: 'Expired',
          AMR: '',
          ACR: 'acr',
        })
      );
    });

    it('keeps export identity defaults when no matching activity exists', async () => {
      activityService.findActivitiesAroundTime.mockResolvedValue([]);
      vi.spyOn(utils, 'parseUserAgent').mockReturnValue({
        browser: 'Unknown',
        os: 'Unknown',
        device: 'Unknown',
      });

      const result = await utils.processSessionForExport({
        _id: 'session',
        payload: { accountId: 'missing', iat: 100 },
      });

      expect(result.Email).toBe('Unknown');
      expect(result['Full Name']).toBe('Unknown User');
    });
  });
});
