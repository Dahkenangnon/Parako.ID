import { describe, expect, it } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import ExpiresWithSession from '../../../src/oidc/specs/expires-with-session.js';

describe('OIDC artifact session binding policy', () => {
  function createPolicy(enabled = true) {
    const config = getDefaultFullConfig();
    config.features.oidc.expires_with_session = enabled;
    return ExpiresWithSession({ getConfig: () => config } as never);
  }

  const expiresWithSession = createPolicy();

  it('does not bind artifacts when session expiration is disabled', async () => {
    const disabled = createPolicy(false);

    await expect(disabled({} as never, {} as never)).resolves.toBe(false);
  });

  it('does not bind an offline authorization code to the browser session', async () => {
    await expect(
      expiresWithSession(
        {} as never,
        {
          scopes: new Set(['openid', 'offline_access']),
        } as never
      )
    ).resolves.toBe(false);
  });

  it('binds an online authorization code to the browser session', async () => {
    await expect(
      expiresWithSession(
        {} as never,
        {
          scopes: new Set(['openid', 'profile']),
        } as never
      )
    ).resolves.toBe(true);
  });

  it('binds artifacts without authorization-code scopes to the session', async () => {
    await expect(expiresWithSession({} as never, {} as never)).resolves.toBe(
      true
    );
  });
});
