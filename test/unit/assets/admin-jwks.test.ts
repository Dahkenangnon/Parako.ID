import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminJwksManager,
  initializeAdminJwksPage,
  registerAdminJwksEntry,
} from '../../../src/assets/js/admin/jwks.js';

type DomListener = (event: {
  currentTarget?: unknown;
  preventDefault?: () => void;
  target?: unknown;
}) => void;

class ElementFixture {
  public readonly dataset: Record<string, string> = {};
  public readonly submit = vi.fn();
  public textContent = '';
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
    elementsById?: Record<string, ElementFixture>;
    pathname?: string;
    readyState?: DocumentReadyState;
  } = {}
) {
  const documentListeners = new Map<string, Set<DomListener>>();
  const querySelectorAll = vi.fn((selector: string) => {
    if (selector === '[data-jwks-confirm]') {
      return options.confirmationForms ?? [];
    }
    if (selector === '[data-jwks-copy], [data-jwks-copy-target]') {
      return options.copyTriggers ?? [];
    }
    return [];
  });
  const browserWindow: Record<string, unknown> = {
    location: { pathname: options.pathname ?? '/admin/jwks' },
  };

  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: DomListener) => {
      const listeners = documentListeners.get(name) ?? new Set<DomListener>();
      listeners.add(listener);
      documentListeners.set(name, listeners);
    }),
    getElementById: vi.fn((id: string) => options.elementsById?.[id] ?? null),
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

function createDependencies(confirmed = true) {
  return {
    clipboard: { copy: vi.fn().mockResolvedValue(true) },
    dialog: { showConfirm: vi.fn().mockResolvedValue(confirmed) },
  };
}

describe('admin JWKS controls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('initializes exact JWKS routes without publishing a manager global', () => {
    const preview = setupDom({ pathname: '/admin/jwks-preview' });
    const dependencies = createDependencies();

    expect(
      initializeAdminJwksPage(dependencies.dialog, dependencies.clipboard)
    ).toBeNull();
    expect(preview.querySelectorAll).not.toHaveBeenCalled();
    expect(preview.browserWindow).not.toHaveProperty('adminJwksManager');

    setupDom({ pathname: '/admin/jwks/key-1' });
    expect(
      initializeAdminJwksPage(dependencies.dialog, dependencies.clipboard)
    ).toBeInstanceOf(AdminJwksManager);
  });

  it('dispatches declarative confirmations and copies defined values', async () => {
    const rotate = new ElementFixture();
    rotate.dataset.jwksConfirm = 'rotate';
    const retire = new ElementFixture();
    retire.dataset.jwksConfirm = 'retire-expired';
    const unsupported = new ElementFixture();
    unsupported.dataset.jwksConfirm = 'archive';
    const inlineCopy = new ElementFixture();
    inlineCopy.dataset.jwksCopy = 'key-id';
    const targetCopy = new ElementFixture();
    targetCopy.dataset.jwksCopyTarget = 'public-jwk';
    const missingCopy = new ElementFixture();
    missingCopy.dataset.jwksCopyTarget = 'missing';
    const publicJwk = new ElementFixture();
    publicJwk.textContent = '{"kty":"RSA"}';
    setupDom({
      confirmationForms: [rotate, retire, unsupported],
      copyTriggers: [inlineCopy, targetCopy, missingCopy],
      elementsById: { 'public-jwk': publicJwk },
    });
    const dependencies = createDependencies(false);
    const manager = new AdminJwksManager(
      dependencies.dialog,
      dependencies.clipboard
    );
    manager.initialize();
    const preventDefault = vi.fn();

    for (const form of [rotate, retire, unsupported]) {
      form.trigger('submit', { preventDefault });
    }
    for (const trigger of [inlineCopy, targetCopy, missingCopy]) {
      trigger.trigger('click');
    }

    await vi.waitFor(() =>
      expect(dependencies.dialog.showConfirm).toHaveBeenCalledTimes(2)
    );
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(dependencies.clipboard.copy).toHaveBeenCalledTimes(2);
    expect(dependencies.clipboard.copy).toHaveBeenNthCalledWith(
      1,
      'key-id',
      inlineCopy
    );
    expect(dependencies.clipboard.copy).toHaveBeenNthCalledWith(
      2,
      '{"kty":"RSA"}',
      targetCopy
    );
    expect(rotate.submit).not.toHaveBeenCalled();
    expect(retire.submit).not.toHaveBeenCalled();
  });

  it('submits each destructive action only after confirmation', async () => {
    setupDom();
    const dependencies = createDependencies(true);
    const manager = new AdminJwksManager(
      dependencies.dialog,
      dependencies.clipboard
    );

    for (const [handler, title, confirmText] of [
      ['confirmRotateKeys', 'Rotate JWKS Keys', 'Yes, Rotate Keys'],
      ['confirmRetireExpired', 'Retire Expired Keys', 'Yes, Retire Expired'],
    ] as const) {
      const form = new ElementFixture();
      const preventDefault = vi.fn();
      await expect(
        manager[handler]({ preventDefault, target: form } as unknown as Event)
      ).resolves.toBe(true);

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(form.submit).toHaveBeenCalledOnce();
      expect(dependencies.dialog.showConfirm).toHaveBeenLastCalledWith(
        title,
        expect.any(String),
        {
          cancelText: 'Cancel',
          confirmText,
          variant: 'warning',
        }
      );
    }
  });

  it('uses currentTarget and does not submit after cancellation', async () => {
    setupDom();
    const dependencies = createDependencies(false);
    const manager = new AdminJwksManager(
      dependencies.dialog,
      dependencies.clipboard
    );
    const currentTarget = new ElementFixture();
    const target = new ElementFixture();
    const preventDefault = vi.fn();

    await expect(
      manager.confirmRotateKeys({
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
    registerAdminJwksEntry();
    expect(loading.documentListeners.get('DOMContentLoaded')?.size).toBe(1);
    loading.runReady();
    expect(loading.querySelectorAll).toHaveBeenCalledWith(
      '[data-jwks-confirm]'
    );

    const complete = setupDom({ readyState: 'complete' });
    registerAdminJwksEntry();
    expect(complete.querySelectorAll).toHaveBeenCalledWith(
      '[data-jwks-confirm]'
    );
  });
});
