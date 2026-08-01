import { describe, expect, it, vi } from 'vitest';

import { OIDCInteractionHandler } from '../../../src/oidc/flows/handlers/interaction.js';

describe('OIDCInteractionHandler content security policy', () => {
  it('allows the validated client redirect origin for interaction form redirects', async () => {
    const contentSecurityPolicy =
      "default-src 'self';form-action 'self';object-src 'none'";
    const response = {
      getHeader: vi.fn().mockReturnValue(contentSecurityPolicy),
      locals: {},
      render: vi.fn(),
      setHeader: vi.fn(),
    };
    const provider = {
      Client: {
        find: vi.fn().mockResolvedValue({
          clientId: 'client-id',
          clientName: 'Example RP',
        }),
      },
      interactionDetails: vi.fn().mockResolvedValue({
        params: {
          client_id: 'client-id',
          redirect_uri: 'https://rp.example/callback',
        },
        prompt: { details: {}, name: 'login' },
        session: undefined,
        uid: 'interaction-id',
      }),
    };
    const sessionManager = {
      generateCsrfToken: vi.fn(),
      get: vi.fn().mockReturnValue('csrf-token'),
      isAuthenticated: vi.fn().mockResolvedValue(false),
    };
    const handler = new (OIDCInteractionHandler as any)(
      /* logger */ {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
      /* userService */ {},
      /* configManager */ {
        getConfig: () => ({
          application: { title: 'Parako.ID' },
          oidc: { path: '/oidc/v1' },
        }),
      },
      /* viewResolver */ {
        views: { auth: { oidc: { login: 'auth/oidc/login' } } },
      },
      sessionManager,
      /* notificationService */ {},
      /* mfaUtils */ {},
      /* oidcUtils */ {
        prepareTemplateVariables: vi.fn().mockReturnValue({}),
      }
    );

    await handler.handle({} as never, response as never, vi.fn(), provider);

    expect(response.render).toHaveBeenCalledWith(
      'auth/oidc/login',
      expect.objectContaining({ uid: 'interaction-id' })
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'self';form-action 'self' https://rp.example;object-src 'none'"
    );
  });
});
