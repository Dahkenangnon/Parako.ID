import { describe, expect, it, vi } from 'vitest';

import RpInitiatedLogout from '../../../src/oidc/specs/feature/rp-initiated-logout.js';

describe('RP-Initiated Logout', () => {
  const createFeature = () =>
    RpInitiatedLogout(
      {
        getConfig: () => ({
          features: { oidc: { rp_initiated_logout: { enabled: true } } },
        }),
      } as never,
      { getLocale: vi.fn().mockReturnValue('en') } as never,
      {
        views: {
          auth: {
            oidc: {
              logout: 'auth/oidc/logout',
              logout_success: 'auth/oidc/logout-success',
            },
          },
        },
      } as never
    );

  it('allows the validated post-logout redirect origin on the confirmation form', async () => {
    const contentSecurityPolicy =
      "default-src 'self';form-action 'self';object-src 'none'";
    const feature = createFeature();
    const context = {
      oidc: {
        client: { clientName: 'Example RP' },
        params: {
          post_logout_redirect_uri: 'https://rp.example/logged-out',
        },
      },
      render: vi.fn(),
      response: {
        get: vi.fn().mockReturnValue(contentSecurityPolicy),
      },
      set: vi.fn(),
      t: vi.fn().mockReturnValue('Confirm Logout'),
    };

    await feature.logoutSource(context as never, '<form></form>');

    expect(context.render).toHaveBeenCalledWith(
      'auth/oidc/logout',
      expect.objectContaining({ form: '<form></form>' })
    );
    expect(context.set).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'self';form-action 'self' https://rp.example;object-src 'none'"
    );
  });

  it('renders safe confirmation defaults without a client or CSP header', async () => {
    const feature = createFeature();
    const context = {
      oidc: {},
      render: vi.fn(),
      response: { get: vi.fn().mockReturnValue('') },
      set: vi.fn(),
    };

    await feature.logoutSource(context as never, '<form></form>');

    expect(feature.enabled).toBe(true);
    expect(context.set).not.toHaveBeenCalled();
    expect(context.render).toHaveBeenCalledWith('auth/oidc/logout', {
      form: '<form></form>',
      clientName: undefined,
      logoUri: undefined,
      policyUri: undefined,
      tosUri: undefined,
      locale: 'en',
      currentYear: new Date().getFullYear(),
      title: 'Confirm Logout',
    });
  });

  it('keeps an existing CSP when no post-logout redirect was requested', async () => {
    const feature = createFeature();
    const contentSecurityPolicy = "default-src 'self';form-action 'self'";
    const context = {
      oidc: { client: undefined, params: undefined },
      render: vi.fn(),
      response: { get: vi.fn().mockReturnValue(contentSecurityPolicy) },
      set: vi.fn(),
    };

    await feature.logoutSource(context as never, '<form></form>');

    expect(context.set).toHaveBeenCalledWith(
      'Content-Security-Policy',
      contentSecurityPolicy
    );
  });

  it('renders RP metadata after logout when no redirect URI is available', async () => {
    const feature = createFeature();
    const context = {
      oidc: {
        client: {
          clientName: 'Example RP',
          clientUri: 'https://rp.example',
          initiateLoginUri: 'https://rp.example/login',
          logoUri: 'https://rp.example/logo.svg',
          policyUri: 'https://rp.example/policy',
          tosUri: 'https://rp.example/terms',
        },
      },
      render: vi.fn(),
      t: vi.fn().mockReturnValue('Signed out'),
    };

    await feature.postLogoutSuccessSource(context as never);

    expect(context.render).toHaveBeenCalledWith('auth/oidc/logout-success', {
      clientName: 'Example RP',
      clientUri: 'https://rp.example',
      initiateLoginUri: 'https://rp.example/login',
      logoUri: 'https://rp.example/logo.svg',
      policyUri: 'https://rp.example/policy',
      tosUri: 'https://rp.example/terms',
      locale: 'en',
      currentYear: new Date().getFullYear(),
      title: 'Signed out',
    });
  });

  it('renders safe success defaults when the logout request has no client', async () => {
    const feature = createFeature();
    const context = { oidc: {}, render: vi.fn() };

    await feature.postLogoutSuccessSource(context as never);

    expect(context.render).toHaveBeenCalledWith(
      'auth/oidc/logout-success',
      expect.objectContaining({
        clientName: undefined,
        clientUri: undefined,
        initiateLoginUri: undefined,
        title: 'Logged Out',
      })
    );
  });
});
