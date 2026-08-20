import { afterEach, describe, expect, it, vi } from 'vitest';

const entryModules = [
  ['../../../src/assets/js/flash.js', true],
  ['../../../src/assets/js/main.js', true],
  ['../../../src/assets/js/user.js', true],
  ['../../../src/assets/js/account/apps.js', true],
  ['../../../src/assets/js/account/layout.js', true],
  ['../../../src/assets/js/account/recovery-codes.js', true],
  ['../../../src/assets/js/account/sessions.js', true],
  ['../../../src/assets/js/account/settings/index.js', true],
  ['../../../src/assets/js/admin/activities/index.js', true],
  ['../../../src/assets/js/admin/configuration/common.js', false],
  ['../../../src/assets/js/admin/data-transfer/data-transfer.js', false],
  ['../../../src/assets/js/admin/grants/index.js', true],
  ['../../../src/assets/js/admin/jwks.js', true],
  ['../../../src/assets/js/admin/layout.js', true],
  ['../../../src/assets/js/admin/oidc-clients.js', true],
  ['../../../src/assets/js/admin/oidc-clients/form.js', true],
  ['../../../src/assets/js/admin/sessions/index.js', true],
  ['../../../src/assets/js/admin/settings.js', true],
  ['../../../src/assets/js/admin/settings/application.js', true],
  ['../../../src/assets/js/admin/settings/branding.js', true],
  ['../../../src/assets/js/admin/settings/common.js', true],
  ['../../../src/assets/js/admin/settings/deployment.js', true],
  ['../../../src/assets/js/admin/settings/integrations.js', true],
  ['../../../src/assets/js/admin/settings/oidc.js', true],
  ['../../../src/assets/js/admin/settings/overview.js', true],
  ['../../../src/assets/js/admin/settings/security.js', true],
  ['../../../src/assets/js/admin/users.js', true],
  ['../../../src/assets/js/admin/users/data-mgmt.js', true],
  ['../../../src/assets/js/admin/users/form.js', true],
  ['../../../src/assets/js/auth/oidc/login.js', true],
  ['../../../src/assets/js/auth/register.js', true],
] as const;

const immediateEntryModules = [
  '../../../src/assets/js/flash.js',
  '../../../src/assets/js/admin/activities/index.js',
  '../../../src/assets/js/admin/grants/index.js',
  '../../../src/assets/js/admin/sessions/index.js',
  '../../../src/assets/js/admin/settings/application.js',
  '../../../src/assets/js/admin/settings/deployment.js',
  '../../../src/assets/js/admin/settings/oidc.js',
  '../../../src/assets/js/admin/settings/security.js',
  '../../../src/assets/js/admin/users/data-mgmt.js',
  '../../../src/assets/js/admin/users/form.js',
] as const;

const windowGuardedEntryModules = [
  '../../../src/assets/js/admin/configuration/common.js',
  '../../../src/assets/js/auth/oidc/login.js',
  '../../../src/assets/js/auth/register.js',
] as const;

function installBrowserGlobals(readyState: DocumentReadyState) {
  const addEventListener = vi.fn((name: string, listener: () => void) => {
    if (name === 'DOMContentLoaded') listener();
  });
  const rootElement = {
    classList: {
      add: vi.fn(),
      contains: vi.fn(() => false),
      remove: vi.fn(),
      toggle: vi.fn(),
    },
    getAttribute: vi.fn(() => null),
    setAttribute: vi.fn(),
  };
  vi.stubGlobal('document', {
    addEventListener,
    body: rootElement,
    documentElement: rootElement,
    getElementById: vi.fn(() => null),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    readyState,
  });
  vi.stubGlobal(
    'MutationObserver',
    class {
      public disconnect(): void {}
      public observe(): void {}
    }
  );
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    location: { hostname: 'example.test', pathname: '/not-the-entry-route' },
  });
  return addEventListener;
}

describe('browser entry registration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(entryModules)(
    'registers %s while the document is loading',
    async (modulePath, registersReadyListener) => {
      const addEventListener = installBrowserGlobals('loading');

      await expect(import(modulePath)).resolves.toBeDefined();
      if (registersReadyListener) {
        expect(addEventListener).toHaveBeenCalled();
      }
    }
  );

  it.each(immediateEntryModules)(
    'initializes %s when the document is ready',
    async modulePath => {
      installBrowserGlobals('complete');

      await expect(import(modulePath)).resolves.toBeDefined();
    }
  );

  it.each(windowGuardedEntryModules)(
    'does not initialize %s without a window',
    async modulePath => {
      vi.stubGlobal('document', {});
      vi.stubGlobal('window', undefined);

      await expect(import(modulePath)).resolves.toBeDefined();
    }
  );
});
