import { describe, expect, it, vi } from 'vitest';

import RedirectAuthority from '../../../src/utils/redirect-authority.js';

function createRedirectAuthority({
  deploymentUrl = 'https://idp.example',
  includeOidcAdapter = true,
  oidcClients = [],
  staticClients,
  trustedDomains = [],
}: {
  deploymentUrl?: string;
  includeOidcAdapter?: boolean;
  oidcClients?: unknown[];
  staticClients?: unknown[];
  trustedDomains?: string[];
} = {}) {
  const configManager = {
    getConfig: vi.fn().mockReturnValue({
      deployment: { url: deploymentUrl },
      security: { protection: { trusted_domains: trustedDomains } },
    }),
  };
  const sessionManager = {
    get: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const oidcAdapter = {
    client: {
      findAllClients: vi.fn().mockResolvedValue(oidcClients),
    },
  };
  const oidcClientMerger = staticClients
    ? { loadClients: vi.fn().mockReturnValue(staticClients) }
    : undefined;

  return {
    authority: new RedirectAuthority(
      configManager as never,
      sessionManager as never,
      logger as never,
      includeOidcAdapter ? (oidcAdapter as never) : undefined,
      oidcClientMerger as never
    ),
    logger,
    oidcAdapter,
    oidcClientMerger,
    sessionManager,
  };
}

describe('RedirectAuthority', () => {
  it.each([
    ['', {}, 'URL is required and must be a string'],
    [42, {}, 'URL is required and must be a string'],
    ['   ', {}, 'URL cannot be empty'],
    ['abcd', { maxLength: 3 }, 'URL exceeds maximum length of 3 characters'],
    ['//evil.example/path', {}, 'Protocol-relative URLs are not allowed'],
    ['/local', { allowLocal: false }, 'Local paths are not allowed'],
    ['/safe//evil', {}, 'Invalid characters in local path'],
    ['/safe\\evil', {}, 'Invalid characters in local path'],
    [
      'http://trusted.example/path',
      { requireHttps: true },
      'HTTPS is required for external URLs',
    ],
    ['javascript:alert(1)', {}, 'Only HTTP and HTTPS protocols are allowed'],
  ])('rejects unsafe redirect URL %j', (url, options, reason) => {
    const { authority } = createRedirectAuthority({
      trustedDomains: ['trusted.example'],
    });

    expect(authority.validateUrl(url as never, options)).toEqual({
      isValid: false,
      reason,
      url: null,
    });
  });

  it.each(['', 'not a valid deployment URL'])(
    'falls back to trusted domains when deployment URL is %j',
    deploymentUrl => {
      const { authority } = createRedirectAuthority({
        deploymentUrl,
        trustedDomains: ['trusted.example'],
      });

      expect(authority.validateUrl('https://trusted.example/path')).toEqual({
        isValid: true,
        url: 'https://trusted.example/path',
      });
    }
  );

  it('returns a safe validation result for a malformed absolute URL', () => {
    const { authority } = createRedirectAuthority();

    const result = authority.validateUrl('not an absolute URL');

    expect(result).toEqual({
      isValid: false,
      reason: expect.stringContaining('Invalid URL format:'),
      url: null,
    });
  });

  it('does not leak a non-Error custom-validator exception', () => {
    const { authority } = createRedirectAuthority();

    expect(
      authority.validateUrl('/local', {
        customValidator: () => {
          throw 'validator failure';
        },
      })
    ).toEqual({
      isValid: false,
      reason: 'Invalid URL format: Unknown error',
      url: null,
    });
  });

  it.each([
    ['/safe?next=1', []],
    ['https://idp.example/account', []],
    ['https://trusted.example/path', ['*.other.example', 'trusted.example']],
    ['https://trusted.example/path', ['*.trusted.example']],
    ['https://sub.trusted.example/path', ['*.trusted.example']],
  ])('accepts an authorized redirect URL %s', (url, trustedDomains) => {
    const { authority } = createRedirectAuthority({ trustedDomains });

    expect(authority.validateUrl(`  ${url}  `)).toEqual({
      isValid: true,
      url,
    });
  });

  it.each([
    [
      [],
      "No trusted domains configured. Add 'evil.example' to trusted domains or register it as an OIDC client redirect URI.",
    ],
    [
      [' ', 'trusted.example'],
      "Domain 'evil.example' is not in the list of trusted domains:  , trusted.example. You can also register it as an OIDC client redirect URI.",
    ],
  ])(
    'rejects an external domain outside the trust policy',
    (trustedDomains, reason) => {
      const { authority } = createRedirectAuthority({ trustedDomains });

      expect(authority.validateUrl('https://evil.example/path')).toEqual({
        isValid: false,
        reason,
        url: null,
      });
    }
  );

  it.each([
    ['/local', []],
    ['https://idp.example/account', []],
    ['https://trusted.example/path', ['trusted.example']],
  ])(
    'applies the custom validator to authorized URL %s',
    (url, trustedDomains) => {
      const { authority } = createRedirectAuthority({ trustedDomains });
      const customValidator = vi.fn().mockReturnValue(false);

      expect(authority.validateUrl(url, { customValidator })).toEqual({
        isValid: false,
        reason: 'URL failed custom validation',
        url: null,
      });
      expect(customValidator).toHaveBeenCalledWith(url);
    }
  );

  it('stores a validated redirect intent with normalized intent and metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    try {
      const { authority, sessionManager } = createRedirectAuthority();
      const request = { session: { id: 'session-123' } } as never;
      const metadata = { source: 'authorization' };

      await expect(
        authority.storeIntent(request, '/after-login', '  LOGIN  ', metadata)
      ).resolves.toBe(true);

      expect(sessionManager.set).toHaveBeenCalledWith(
        request,
        'redirectIntent',
        {
          intent: 'login',
          metadata,
          timestamp: Date.now(),
          url: '/after-login',
        }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['', undefined, 42])(
    'does not store an invalid redirect intent (%j)',
    async intent => {
      const { authority, sessionManager } = createRedirectAuthority();

      await expect(
        authority.storeIntent({} as never, '/after-login', intent as never)
      ).resolves.toBe(false);
      expect(sessionManager.set).not.toHaveBeenCalled();
    }
  );

  it('fails closed when the session store cannot persist an intent', async () => {
    const { authority, logger, sessionManager } = createRedirectAuthority();
    const error = new Error('session store unavailable');
    sessionManager.set.mockImplementation(() => {
      throw error;
    });

    await expect(
      authority.storeIntent({} as never, '/after-login', 'login')
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'REDIRECT_AUTHORITY: Error storing redirect intent',
      {
        error,
        intent: 'login',
        url: '/after-login',
      }
    );
  });

  it('loads OIDC client domains and retries the first redirect intent when no manual domains exist', async () => {
    const { authority, oidcAdapter, sessionManager } = createRedirectAuthority({
      oidcClients: [
        {
          client_id: 'rp-client',
          redirect_uris: ['https://rp.example/callback'],
        },
      ],
    });
    const request = { session: { id: 'session-123' } } as never;

    await expect(
      authority.storeIntent(request, 'https://rp.example/after-login', 'login')
    ).resolves.toBe(true);

    expect(oidcAdapter.client.findAllClients).toHaveBeenCalledWith({
      active: true,
    });
    expect(oidcAdapter.client.findAllClients).toHaveBeenCalledOnce();
    expect(sessionManager.set).toHaveBeenCalledWith(
      request,
      'redirectIntent',
      expect.objectContaining({
        intent: 'login',
        url: 'https://rp.example/after-login',
      })
    );
  });

  it('loads and caches redirect domains from static OIDC clients', async () => {
    const { authority, logger, oidcClientMerger, sessionManager } =
      createRedirectAuthority({
        includeOidcAdapter: false,
        staticClients: [
          {
            client_id: 'static-rp',
            redirect_uris: [
              'https://static-rp.example/callback',
              'com.example.app:/callback',
            ],
          },
          { client_id: 'no-redirects' },
        ],
      });

    await expect(
      authority.storeIntent(
        {} as never,
        'https://static-rp.example/first',
        'login'
      )
    ).resolves.toBe(true);
    await expect(
      authority.storeIntent(
        {} as never,
        'https://static-rp.example/second',
        'login'
      )
    ).resolves.toBe(true);
    await expect(
      authority.storeIntent(
        {} as never,
        'https://uncached.example/after-login',
        'login'
      )
    ).resolves.toBe(false);

    expect(oidcClientMerger?.loadClients).toHaveBeenCalledOnce();
    expect(sessionManager.set).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      'OIDC client domains loaded and cached',
      expect.objectContaining({ domains: ['static-rp.example'] })
    );
  });

  it('reloads OIDC client domains after the cache expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    try {
      const { authority, oidcAdapter } = createRedirectAuthority({
        oidcClients: [
          {
            client_id: 'rp-client',
            redirect_uris: ['https://rp.example/callback'],
          },
        ],
      });

      await authority.storeIntent(
        {} as never,
        'https://rp.example/first',
        'login'
      );
      vi.advanceTimersByTime(300_001);
      await authority.storeIntent(
        {} as never,
        'https://rp.example/second',
        'login'
      );

      expect(oidcAdapter.client.findAllClients).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores and reports non-web redirect URIs from database clients', async () => {
    const { authority, logger } = createRedirectAuthority({
      oidcClients: [
        {
          client_id: 'native-client',
          redirect_uris: ['com.example.app:/callback'],
        },
        { client_id: 'no-redirects' },
      ],
    });

    await expect(
      authority.storeIntent(
        {} as never,
        'https://native-client.example/after-login',
        'login'
      )
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'Invalid redirect URI in OIDC client',
      expect.objectContaining({
        client_id: 'native-client',
        uri: 'com.example.app:/callback',
      })
    );
  });

  it('fails closed when the OIDC client store cannot load redirect domains', async () => {
    const { authority, logger, oidcAdapter } = createRedirectAuthority();
    oidcAdapter.client.findAllClients.mockRejectedValue(
      new Error('client store unavailable')
    );

    await expect(
      authority.storeIntent(
        {} as never,
        'https://rp.example/after-login',
        'login'
      )
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to fetch OIDC client domains, using empty set',
      { error: 'client store unavailable' }
    );
  });

  it('fails closed when static OIDC clients cannot be loaded', async () => {
    const { authority, logger, oidcClientMerger } = createRedirectAuthority({
      includeOidcAdapter: false,
      staticClients: [],
    });
    oidcClientMerger?.loadClients.mockImplementation(() => {
      throw new Error('static client config unavailable');
    });

    await expect(
      authority.storeIntent(
        {} as never,
        'https://rp.example/after-login',
        'login'
      )
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to load static OIDC clients',
      { error: 'static client config unavailable' }
    );
  });

  it('does not persist an intent when OIDC client discovery cannot authorize its domain', async () => {
    const { authority, oidcAdapter, sessionManager } = createRedirectAuthority({
      trustedDomains: ['trusted.example'],
    });

    await expect(
      authority.storeIntent(
        {} as never,
        'https://evil.example/after-login',
        'login'
      )
    ).resolves.toBe(false);

    expect(oidcAdapter.client.findAllClients).toHaveBeenCalledOnce();
    expect(sessionManager.set).not.toHaveBeenCalled();
  });

  it('rejects an untrusted intent directly when no OIDC domain source exists', async () => {
    const { authority, sessionManager } = createRedirectAuthority({
      includeOidcAdapter: false,
    });

    await expect(
      authority.storeIntent(
        {} as never,
        'https://evil.example/after-login',
        'login'
      )
    ).resolves.toBe(false);
    expect(sessionManager.set).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'retrieves a matching redirect intent with consume=%s',
    consume => {
      const { authority, sessionManager } = createRedirectAuthority();
      const request = {} as never;
      sessionManager.get.mockReturnValue({
        intent: 'login',
        metadata: {},
        timestamp: Date.now(),
        url: '/after-login',
      });

      expect(authority.getIntent(request, '  LOGIN  ', consume)).toBe(
        '/after-login'
      );
      if (consume) {
        expect(sessionManager.remove).toHaveBeenCalledWith(
          request,
          'redirectIntent'
        );
      } else {
        expect(sessionManager.remove).not.toHaveBeenCalled();
      }
    }
  );

  it.each(['', undefined, 42])(
    'rejects an invalid expected redirect intent (%j)',
    expectedIntent => {
      const { authority, sessionManager } = createRedirectAuthority();

      expect(authority.getIntent({} as never, expectedIntent as never)).toBe(
        null
      );
      expect(sessionManager.get).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['missing', undefined],
    [
      'mismatched',
      {
        intent: 'registration',
        metadata: {},
        timestamp: Date.now(),
        url: '/after-registration',
      },
    ],
  ])('returns null for a %s redirect intent', (_case, storedIntent) => {
    const { authority, sessionManager } = createRedirectAuthority();
    sessionManager.get.mockReturnValue(storedIntent);

    expect(authority.getIntent({} as never, 'login')).toBe(null);
    expect(sessionManager.remove).not.toHaveBeenCalled();
  });

  it('removes an expired redirect intent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    try {
      const { authority, sessionManager } = createRedirectAuthority();
      const request = {} as never;
      sessionManager.get.mockReturnValue({
        intent: 'login',
        metadata: {},
        timestamp: Date.now() - 1_001,
        url: '/after-login',
      });

      expect(authority.getIntent(request, 'login', true, 1_000)).toBe(null);
      expect(sessionManager.remove).toHaveBeenCalledWith(
        request,
        'redirectIntent'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when redirect-intent retrieval throws', () => {
    const { authority, logger, sessionManager } = createRedirectAuthority();
    const error = new Error('session store unavailable');
    sessionManager.get.mockImplementation(() => {
      throw error;
    });

    expect(authority.getIntent({} as never, 'login')).toBe(null);
    expect(logger.error).toHaveBeenCalledWith(
      'REDIRECT_AUTHORITY: Error retrieving redirect intent',
      { error, expectedIntent: 'login' }
    );
  });

  it.each([true, false])(
    'retrieves redirect intent metadata with consume=%s',
    consume => {
      const { authority, sessionManager } = createRedirectAuthority();
      const request = {} as never;
      const redirectIntent = {
        intent: 'login',
        metadata: { source: 'authorization' },
        timestamp: Date.now(),
        url: '/after-login',
      };
      sessionManager.get.mockReturnValue(redirectIntent);

      expect(authority.getIntentWithMetadata(request, 'LOGIN', consume)).toBe(
        redirectIntent
      );
      expect(sessionManager.remove).toHaveBeenCalledTimes(consume ? 1 : 0);
    }
  );

  it.each(['', undefined, 42])(
    'rejects invalid metadata-intent lookup %j',
    expectedIntent => {
      const { authority, sessionManager } = createRedirectAuthority();

      expect(
        authority.getIntentWithMetadata({} as never, expectedIntent as never)
      ).toBe(null);
      expect(sessionManager.get).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['missing', undefined],
    [
      'mismatched',
      {
        intent: 'registration',
        metadata: {},
        timestamp: Date.now(),
        url: '/after-registration',
      },
    ],
  ])('returns no metadata for a %s redirect intent', (_case, storedIntent) => {
    const { authority, sessionManager } = createRedirectAuthority();
    sessionManager.get.mockReturnValue(storedIntent);

    expect(authority.getIntentWithMetadata({} as never, 'login')).toBe(null);
    expect(sessionManager.remove).not.toHaveBeenCalled();
  });

  it('removes expired redirect-intent metadata', () => {
    const { authority, sessionManager } = createRedirectAuthority();
    const request = {} as never;
    sessionManager.get.mockReturnValue({
      intent: 'login',
      metadata: { source: 'authorization' },
      timestamp: Date.now() - 1_001,
      url: '/after-login',
    });

    expect(authority.getIntentWithMetadata(request, 'login', true, 1_000)).toBe(
      null
    );
    expect(sessionManager.remove).toHaveBeenCalledWith(
      request,
      'redirectIntent'
    );
  });

  it('fails closed when metadata-intent retrieval throws', () => {
    const { authority, logger, sessionManager } = createRedirectAuthority();
    const error = new Error('session store unavailable');
    sessionManager.get.mockImplementation(() => {
      throw error;
    });

    expect(authority.getIntentWithMetadata({} as never, 'login')).toBe(null);
    expect(logger.error).toHaveBeenCalledWith(
      'Error retrieving redirect intent with metadata',
      { error, expectedIntent: 'login' }
    );
  });

  it.each([
    ['missing', undefined, undefined, false],
    [
      'expired',
      {
        intent: 'login',
        timestamp: Date.now() - 3_600_001,
        url: '/after-login',
      },
      undefined,
      false,
    ],
    [
      'present',
      { intent: 'login', timestamp: Date.now(), url: '/after-login' },
      undefined,
      true,
    ],
    [
      'matching',
      { intent: 'login', timestamp: Date.now(), url: '/after-login' },
      '  LOGIN  ',
      true,
    ],
    [
      'mismatched',
      { intent: 'login', timestamp: Date.now(), url: '/after-login' },
      'registration',
      false,
    ],
  ])(
    'reports a %s redirect intent as %s',
    (_case, storedIntent, expectedIntent, expected) => {
      const { authority, sessionManager } = createRedirectAuthority();
      sessionManager.get.mockReturnValue(storedIntent);

      expect(authority.hasIntent({} as never, expectedIntent as string)).toBe(
        expected
      );
    }
  );

  it('fails closed when checking redirect-intent presence throws', () => {
    const { authority, logger, sessionManager } = createRedirectAuthority();
    const error = new Error('session store unavailable');
    sessionManager.get.mockImplementation(() => {
      throw error;
    });

    expect(authority.hasIntent({} as never, 'login')).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Error checking redirect intent',
      { error, expectedIntent: 'login' }
    );
  });

  it('clears a redirect intent from the session', () => {
    const { authority, sessionManager } = createRedirectAuthority();
    const request = {} as never;

    expect(authority.clearIntent(request)).toBe(true);
    expect(sessionManager.remove).toHaveBeenCalledWith(
      request,
      'redirectIntent'
    );
  });

  it('reports failure when clearing a redirect intent throws', () => {
    const { authority, logger, sessionManager } = createRedirectAuthority();
    const error = new Error('session store unavailable');
    sessionManager.remove.mockImplementation(() => {
      throw error;
    });

    expect(authority.clearIntent({} as never)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Error clearing redirect intent',
      { error }
    );
  });

  it('builds an absolute redirect URL with encoded query parameters', () => {
    const { authority } = createRedirectAuthority();

    expect(
      authority.buildRedirectUrl('https://rp.example/callback?existing=1', {
        '': 'ignored',
        existing: 'updated',
        next: '/account settings',
        nullable: null as never,
      })
    ).toBe(
      'https://rp.example/callback?existing=updated&next=%2Faccount+settings'
    );
    expect(authority.buildRedirectUrl('')).toBe('');
  });

  it.each([
    ['/local', '/local?next=%2Faccount%20settings'],
    ['/local?existing=1', '/local?existing=1&next=%2Faccount%20settings'],
  ])('falls back safely for non-absolute base URL %s', (baseUrl, expected) => {
    const { authority } = createRedirectAuthority();

    expect(
      authority.buildRedirectUrl(baseUrl, {
        '': 'ignored',
        next: '/account settings',
        nullable: null as never,
        optional: undefined as never,
      })
    ).toBe(expected);
  });

  it('preserves a non-absolute base URL when no fallback query is present', () => {
    const { authority } = createRedirectAuthority();

    expect(authority.buildRedirectUrl('/local')).toBe('/local');
  });

  it('builds only validated secure redirect URLs', () => {
    const { authority } = createRedirectAuthority({
      trustedDomains: ['rp.example'],
    });

    expect(
      authority.buildSecureRedirectUrl(
        'https://rp.example/callback',
        { state: 'state value' },
        { requireHttps: true }
      )
    ).toBe('https://rp.example/callback?state=state+value');
    expect(
      authority.buildSecureRedirectUrl('https://evil.example/callback')
    ).toBe(null);
  });

  it('uses the fluent redirect fallback when validation fails', () => {
    const { authority } = createRedirectAuthority();
    const response = {
      headersSent: false,
      redirect: vi.fn(),
    };

    const builder = authority
      .redirect(response as never)
      .withOptions({ allowLocal: false })
      .to(undefined)
      .to('/local')
      .or('/fallback');

    expect(builder).toBeDefined();
    expect(response.redirect).toHaveBeenCalledOnce();
    expect(response.redirect).toHaveBeenCalledWith('/fallback');
  });

  it('does not send a fallback after a validated redirect', () => {
    const { authority } = createRedirectAuthority();
    const response = {
      headersSent: false,
      redirect: vi.fn(function redirect(this: { headersSent: boolean }) {
        this.headersSent = true;
      }),
    };

    authority
      .redirect(response as never)
      .to('/account')
      .or('/fallback');

    expect(response.redirect).toHaveBeenCalledOnce();
    expect(response.redirect).toHaveBeenCalledWith('/account');
  });
});
