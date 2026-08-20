import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminOidcClientsManager,
  initializeAdminOidcClientsPage,
  registerAdminOidcClientsEntry,
} from '../../../src/assets/js/admin/oidc-clients.js';

type DomListener = (event: {
  currentTarget?: unknown;
  preventDefault?: () => void;
  target?: unknown;
}) => void;

class ElementFixture {
  public readonly dataset: Record<string, string> = {};
  public readonly submit = vi.fn();
  private readonly listeners = new Map<string, DomListener[]>();

  public addEventListener(name: string, listener: DomListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public trigger(name: string, event: Parameters<DomListener>[0] = {}): void {
    this.listeners.get(name)?.forEach(listener =>
      listener({
        currentTarget: this,
        target: this,
        ...event,
      })
    );
  }
}

function setupDom(
  options: {
    confirmationForms?: ElementFixture[];
    copyTriggers?: ElementFixture[];
    pathname?: string;
    readyState?: DocumentReadyState;
  } = {}
) {
  const documentListeners = new Map<string, Set<DomListener>>();
  const querySelectorAll = vi.fn((selector: string) => {
    if (selector === '[data-oidc-client-confirm]') {
      return options.confirmationForms ?? [];
    }
    if (selector === '[data-oidc-copy]') {
      return options.copyTriggers ?? [];
    }
    return [];
  });
  const browserWindow: Record<string, unknown> = {
    location: { pathname: options.pathname ?? '/admin/oidc-clients' },
  };

  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: DomListener) => {
      const listeners = documentListeners.get(name) ?? new Set<DomListener>();
      listeners.add(listener);
      documentListeners.set(name, listeners);
    }),
    querySelectorAll,
    readyState: options.readyState ?? 'complete',
  });

  return {
    browserWindow,
    documentListeners,
    querySelectorAll,
    runReady: () =>
      documentListeners
        .get('DOMContentLoaded')
        ?.forEach(listener => listener({})),
  };
}

function createDependencies(confirmed: boolean = true) {
  return {
    clipboard: { copy: vi.fn().mockResolvedValue(true) },
    dialog: { showConfirm: vi.fn().mockResolvedValue(confirmed) },
  };
}

describe('admin OIDC clients manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('initializes exact client routes without publishing a manager global', () => {
    const { browserWindow } = setupDom({
      pathname: '/admin/oidc-clients-preview',
    });
    const dependencies = createDependencies();

    expect(
      initializeAdminOidcClientsPage(
        dependencies.dialog,
        dependencies.clipboard
      )
    ).toBeNull();
    expect(browserWindow).not.toHaveProperty('adminOidcClientsManager');

    setupDom({ pathname: '/admin/oidc-clients/client-1' });
    expect(
      initializeAdminOidcClientsPage(
        dependencies.dialog,
        dependencies.clipboard
      )
    ).toBeInstanceOf(AdminOidcClientsManager);
  });

  it('dispatches declarative actions and copies only defined values', async () => {
    const deactivate = new ElementFixture();
    deactivate.dataset.oidcClientConfirm = 'deactivate';
    const remove = new ElementFixture();
    remove.dataset.oidcClientConfirm = 'delete';
    const regenerate = new ElementFixture();
    regenerate.dataset.oidcClientConfirm = 'regenerate-secret';
    const unsupported = new ElementFixture();
    unsupported.dataset.oidcClientConfirm = 'archive';
    const copy = new ElementFixture();
    copy.dataset.oidcCopy = 'client-id';
    const missingCopy = new ElementFixture();
    setupDom({
      confirmationForms: [deactivate, remove, regenerate, unsupported],
      copyTriggers: [copy, missingCopy],
    });
    const dependencies = createDependencies(false);
    const manager = new AdminOidcClientsManager(
      dependencies.dialog,
      dependencies.clipboard
    );
    manager.initialize();
    const preventDefault = vi.fn();

    for (const form of [deactivate, remove, regenerate, unsupported]) {
      form.trigger('submit', { preventDefault });
    }
    copy.trigger('click');
    missingCopy.trigger('click');
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledTimes(3);
    expect(dependencies.dialog.showConfirm).toHaveBeenCalledTimes(3);
    expect(dependencies.clipboard.copy).toHaveBeenCalledOnce();
    expect(dependencies.clipboard.copy).toHaveBeenCalledWith('client-id', copy);
    expect(deactivate.submit).not.toHaveBeenCalled();
    expect(remove.submit).not.toHaveBeenCalled();
    expect(regenerate.submit).not.toHaveBeenCalled();
  });

  it('submits each action only after confirmation', async () => {
    setupDom();
    const dependencies = createDependencies(true);
    const manager = new AdminOidcClientsManager(
      dependencies.dialog,
      dependencies.clipboard
    );

    for (const [handler, title, confirmText, variant] of [
      [
        'confirmDeactivateClient',
        'Deactivate OIDC Client',
        'Yes, Deactivate',
        'warning',
      ],
      [
        'confirmDeleteClient',
        'Delete OIDC Client - Permanent Action',
        'Yes, Delete Permanently',
        'danger',
      ],
      [
        'confirmRegenerateSecret',
        'Regenerate Client Secret',
        'Yes, Regenerate Secret',
        'danger',
      ],
    ] as const) {
      const form = new ElementFixture();
      const preventDefault = vi.fn();
      await expect(
        manager[handler]({
          preventDefault,
          target: form,
        } as unknown as Event)
      ).resolves.toBe(true);

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(form.submit).toHaveBeenCalledOnce();
      expect(dependencies.dialog.showConfirm).toHaveBeenLastCalledWith(
        title,
        expect.any(String),
        {
          cancelText: 'Cancel',
          confirmText,
          variant,
        }
      );
    }
  });

  it('uses currentTarget and leaves the form untouched after cancellation', async () => {
    setupDom();
    const dependencies = createDependencies(false);
    const manager = new AdminOidcClientsManager(
      dependencies.dialog,
      dependencies.clipboard
    );
    const currentTarget = new ElementFixture();
    const target = new ElementFixture();
    const preventDefault = vi.fn();

    await expect(
      manager.confirmDeactivateClient({
        currentTarget,
        preventDefault,
        target,
      } as unknown as Event)
    ).resolves.toBe(false);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(currentTarget.submit).not.toHaveBeenCalled();
    expect(target.submit).not.toHaveBeenCalled();
  });

  it('registers immediately or once after DOM readiness', () => {
    const loading = setupDom({ readyState: 'loading' });
    registerAdminOidcClientsEntry();
    expect(loading.documentListeners.get('DOMContentLoaded')?.size).toBe(1);
    loading.runReady();
    expect(loading.querySelectorAll).toHaveBeenCalledWith(
      '[data-oidc-client-confirm]'
    );

    const ready = setupDom({ readyState: 'complete' });
    registerAdminOidcClientsEntry();
    expect(ready.querySelectorAll).toHaveBeenCalledWith(
      '[data-oidc-client-confirm]'
    );
  });
});
