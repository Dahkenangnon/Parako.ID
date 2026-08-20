import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminUsersManager,
  initializeAdminUsersPage,
  registerAdminUsersEntry,
} from '../../../src/assets/js/admin/users.js';

type DomListener = (event: { target?: unknown }) => void;

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public className = '';
  public readonly dataset: Record<string, string> = {};
  public parentNode: ElementFixture | null = null;
  public textContent = '';
  public type = '';
  public value = '';
  private readonly listeners = new Map<string, DomListener[]>();

  constructor(public readonly tagName: string) {}

  public addEventListener(name: string, listener: DomListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  public remove(): void {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string): void {
    this.listeners.get(name)?.forEach(listener => listener({ target: this }));
  }
}

function setupDom(
  options: {
    csrfToken?: string;
    environment?: string;
    pathname?: string;
    queryElements?: Record<string, ElementFixture[]>;
    readyState?: DocumentReadyState;
    stateText?: string;
    withLucide?: boolean;
  } = {}
) {
  const body = new ElementFixture('body');
  const created: ElementFixture[] = [];
  const documentListeners = new Map<string, Set<DomListener>>();
  const browserWindow: Record<string, unknown> = {
    location: {
      pathname: options.pathname ?? '/admin/users',
      reload: vi.fn(),
    },
  };
  if (options.withLucide !== false) {
    browserWindow.lucide = { createIcons: vi.fn() };
  }

  const csrfToken = options.csrfToken;
  let csrfInput: ElementFixture | null = null;
  if (csrfToken) {
    csrfInput = new ElementFixture('input');
    csrfInput.value = csrfToken;
  }
  const stateText = options.stateText;
  let stateElement: ElementFixture | null = null;
  if (stateText !== undefined) {
    stateElement = new ElementFixture('script');
    stateElement.textContent = stateText;
  }
  const querySelectorAll = vi.fn(
    (selector: string) => options.queryElements?.[selector] ?? []
  );

  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: DomListener) => {
      const listeners = documentListeners.get(name) ?? new Set<DomListener>();
      listeners.add(listener);
      documentListeners.set(name, listeners);
    }),
    body,
    createElement: vi.fn((tagName: string) => {
      const element = new ElementFixture(tagName);
      created.push(element);
      return element;
    }),
    documentElement: {
      getAttribute: vi.fn().mockReturnValue(options.environment ?? null),
    },
    getElementById: vi.fn((id: string) =>
      id === '___MAIN_STATE___' ? stateElement : null
    ),
    querySelector: vi.fn().mockReturnValue(csrfInput),
    querySelectorAll,
    readyState: options.readyState ?? 'complete',
  });

  return {
    body,
    browserWindow,
    created,
    documentListeners,
    querySelectorAll,
    runReady: () =>
      documentListeners
        .get('DOMContentLoaded')
        ?.forEach(listener => listener({})),
  };
}

function findLastCreated(
  created: ElementFixture[],
  predicate: (element: ElementFixture) => boolean
): ElementFixture | undefined {
  return [...created].reverse().find(predicate);
}

function createDialog(confirmed: boolean = true) {
  const showConfirm = vi.fn().mockResolvedValue(confirmed);
  return { dialog: { showConfirm }, showConfirm };
}

describe('admin users manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('initializes only exact admin-user routes without publishing globals', () => {
    const { browserWindow } = setupDom({ pathname: '/admin/users-preview' });
    const { dialog } = createDialog();

    expect(initializeAdminUsersPage(dialog)).toBeNull();
    expect(browserWindow).not.toHaveProperty('toggleUserStatus');
    expect(browserWindow).not.toHaveProperty('anonymizeUser');
    expect(browserWindow).not.toHaveProperty('adminUsersManager');

    setupDom({ pathname: '/admin/users/user-1' });
    expect(initializeAdminUsersPage(dialog)).toBeInstanceOf(AdminUsersManager);
  });

  it('binds CSP-safe data attributes to supported user actions', async () => {
    const statusButton = new ElementFixture('button');
    statusButton.dataset.userId = 'user-1';
    statusButton.dataset.userStatusAction = 'disable';
    const anonymizeButton = new ElementFixture('button');
    anonymizeButton.dataset.userId = 'user-2';
    anonymizeButton.dataset.username = 'Maria';
    const invalidStatusButton = new ElementFixture('button');
    invalidStatusButton.dataset.userId = 'user-3';
    invalidStatusButton.dataset.userStatusAction = 'archive';
    const invalidAnonymizeButton = new ElementFixture('button');
    invalidAnonymizeButton.dataset.userId = 'user-4';
    setupDom({
      queryElements: {
        '[data-user-anonymize]': [anonymizeButton, invalidAnonymizeButton],
        '[data-user-status-action]': [statusButton, invalidStatusButton],
      },
    });
    const { dialog, showConfirm } = createDialog(false);

    initializeAdminUsersPage(dialog);
    invalidStatusButton.trigger('click');
    invalidAnonymizeButton.trigger('click');
    statusButton.trigger('click');
    anonymizeButton.trigger('click');
    await Promise.resolve();

    expect(showConfirm).toHaveBeenCalledTimes(2);
    expect(showConfirm).toHaveBeenNthCalledWith(
      1,
      'Disable User',
      expect.stringContaining('disable this user account'),
      {
        cancelText: 'Cancel',
        confirmText: 'Yes, Disable User',
        variant: 'warning',
      }
    );
    expect(showConfirm).toHaveBeenNthCalledWith(
      2,
      'Anonymize User - Permanent Action',
      expect.stringContaining('Maria'),
      {
        cancelText: 'Cancel',
        confirmText: 'Yes, Anonymize Permanently',
        variant: 'danger',
      }
    );
  });

  it('rejects invalid parameters and dismisses error notifications', async () => {
    vi.useFakeTimers();
    const { body, created } = setupDom({ withLucide: false });
    const { dialog, showConfirm } = createDialog();
    const manager = new AdminUsersManager(false, dialog);

    for (const [userId, action] of [
      ['', 'enable'],
      [42, 'enable'],
      ['user-1', ''],
      ['user-1', 'archive'],
    ] as Array<[unknown, unknown]>) {
      await manager.toggleUserStatus(userId as string, action as 'enable');
    }
    for (const [userId, username] of [
      ['', 'Maria'],
      [42, 'Maria'],
      ['user-1', ''],
      ['user-1', 42],
    ] as Array<[unknown, unknown]>) {
      await manager.anonymizeUser(userId as string, username as string);
    }

    expect(showConfirm).not.toHaveBeenCalled();
    expect(
      created.filter(element => element.textContent === 'Invalid parameters')
    ).toHaveLength(8);
    const close = findLastCreated(
      created,
      element =>
        element.tagName === 'button' &&
        element.children.some(
          child => child.attributes.get('data-lucide') === 'x'
        )
    );
    close?.trigger('click');
    expect(body.children).toHaveLength(7);
    vi.advanceTimersByTime(5000);
    expect(body.children).toHaveLength(0);
  });

  it('stops both actions when confirmation is declined', async () => {
    setupDom();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { dialog, showConfirm } = createDialog(false);
    const manager = new AdminUsersManager(false, dialog);

    await manager.toggleUserStatus('user-1', 'enable');
    await manager.anonymizeUser('user-1', 'Maria');

    expect(showConfirm).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a CSRF token after either action is confirmed', async () => {
    const { created } = setupDom();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { dialog } = createDialog();
    const manager = new AdminUsersManager(false, dialog);

    await manager.toggleUserStatus('user-1', 'enable');
    await manager.anonymizeUser('user-1', 'Maria');

    expect(fetch).not.toHaveBeenCalled();
    expect(
      created.filter(
        element =>
          element.textContent ===
          'CSRF token not found. Please refresh the page.'
      )
    ).toHaveLength(2);
  });

  it('enables and disables users, then reloads after success', async () => {
    vi.useFakeTimers();
    const { browserWindow, created } = setupDom({ csrfToken: 'csrf-token' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          message: 'Enabled by administrator',
          success: true,
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ success: true }),
      });
    vi.stubGlobal('fetch', fetch);
    const { dialog } = createDialog();
    const manager = new AdminUsersManager(false, dialog);

    await manager.toggleUserStatus('user-1', 'enable');
    await manager.toggleUserStatus('user-1', 'disable');

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/users/user-1/enable', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'POST',
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/admin/users/user-1/disable', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'POST',
    });
    expect(
      created.some(
        element => element.textContent === 'Enabled by administrator'
      )
    ).toBe(true);
    expect(
      created.some(
        element => element.textContent === 'User disabled successfully'
      )
    ).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(
      (browserWindow.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledTimes(2);
  });

  it('reports rejected and failed status changes without reloading', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { browserWindow, created } = setupDom({ csrfToken: 'csrf-token' });
    const failure = new Error('network unavailable');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          error: 'User cannot be disabled',
          success: false,
        }),
      })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ success: false }),
      });
    vi.stubGlobal('fetch', fetch);
    const { dialog } = createDialog();
    const manager = new AdminUsersManager(true, dialog);

    await manager.toggleUserStatus('user-1', 'disable');
    await manager.toggleUserStatus('user-1', 'enable');
    await manager.toggleUserStatus('user-1', 'disable');

    expect(
      created.some(element => element.textContent === 'User cannot be disabled')
    ).toBe(true);
    expect(
      created.some(
        element =>
          element.textContent === 'An error occurred while updating user status'
      )
    ).toBe(true);
    expect(
      created.some(
        element => element.textContent === 'Failed to update user status'
      )
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(
      '[AdminUsers]',
      'Error toggling user status',
      { error: failure }
    );
    expect(
      (browserWindow.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).not.toHaveBeenCalled();
  });

  it('anonymizes a user and handles rejected or failed requests', async () => {
    vi.useFakeTimers();
    const { browserWindow, created } = setupDom({ csrfToken: 'csrf-token' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ success: false }),
      })
      .mockRejectedValueOnce(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetch);
    const { dialog } = createDialog();
    const manager = new AdminUsersManager(false, dialog);

    await manager.anonymizeUser('user-0', 'Maria');
    await manager.anonymizeUser('user-1', 'Maria');
    await manager.anonymizeUser('user-2', 'Maria');

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/users/user-0', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'DELETE',
    });
    for (const message of [
      'User anonymized successfully',
      'Failed to anonymize user',
      'An error occurred while anonymizing user',
    ]) {
      expect(created.some(element => element.textContent === message)).toBe(
        true
      );
    }

    vi.advanceTimersByTime(1500);
    expect(
      (browserWindow.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it('derives debug mode from state or the development fallback', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { dialog } = createDialog();

    setupDom({ csrfToken: 'csrf-token', stateText: '{"debug":true}' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('failed')));
    await initializeAdminUsersPage(dialog)?.anonymizeUser('user-1', 'Maria');
    expect(log).toHaveBeenCalledWith('[AdminUsers]', 'Anonymizing user', {
      userId: 'user-1',
      username: 'Maria',
    });

    log.mockClear();
    setupDom({
      csrfToken: 'csrf-token',
      environment: 'development',
      stateText: '{invalid',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('failed')));
    await initializeAdminUsersPage(dialog)?.toggleUserStatus(
      'user-1',
      'enable'
    );
    expect(log).toHaveBeenCalledWith('[AdminUsers]', 'Toggling user status', {
      action: 'enable',
      userId: 'user-1',
    });

    log.mockClear();
    setupDom({ stateText: '' });
    await initializeAdminUsersPage(dialog)?.toggleUserStatus('', 'enable');
    expect(log).not.toHaveBeenCalled();
  });

  it('registers immediately or once after DOM readiness', () => {
    const loading = setupDom({ readyState: 'loading' });
    registerAdminUsersEntry();
    expect(loading.documentListeners.get('DOMContentLoaded')?.size).toBe(1);
    loading.runReady();
    expect(loading.querySelectorAll).toHaveBeenCalledWith(
      '[data-user-status-action]'
    );

    const ready = setupDom({ readyState: 'complete' });
    registerAdminUsersEntry();
    expect(ready.querySelectorAll).toHaveBeenCalledWith(
      '[data-user-status-action]'
    );
  });
});
