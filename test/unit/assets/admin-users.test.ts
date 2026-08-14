import { afterEach, describe, expect, it, vi } from 'vitest';

interface DomEvent {
  key?: string;
  target?: unknown;
}

type DomListener = (event: DomEvent) => void;

interface AdminUsersManagerFixture {
  anonymizeUser(userId: string, username: string): Promise<void>;
  toggleUserStatus(userId: string, action: 'enable' | 'disable'): Promise<void>;
}

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public className = '';
  public readonly dataset: Record<string, string> = {};
  public readonly focus = vi.fn();
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

  public trigger(name: string, event: DomEvent = { target: this }): void {
    this.listeners.get(name)?.forEach(listener => listener(event));
  }
}

function setupDom(
  options: {
    csrfToken?: string;
    activeElement?: ElementFixture;
    environment?: string;
    pathname?: string;
    stateText?: string;
    queryElements?: Record<string, ElementFixture[]>;
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
  const createIcons = vi.fn();
  if (options.withLucide !== false) {
    browserWindow.lucide = { createIcons };
  }
  const csrfInput = options.csrfToken ? new ElementFixture('input') : null;
  if (csrfInput) csrfInput.value = options.csrfToken!;
  const stateElement =
    options.stateText === undefined ? null : new ElementFixture('script');
  if (stateElement) stateElement.textContent = options.stateText!;

  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: DomListener) => {
      const listeners = documentListeners.get(name) ?? new Set<DomListener>();
      listeners.add(listener);
      documentListeners.set(name, listeners);
    }),
    activeElement: options.activeElement ?? null,
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
    querySelectorAll: vi.fn(
      (selector: string) => options.queryElements?.[selector] ?? []
    ),
    removeEventListener: vi.fn((name: string, listener: DomListener) => {
      documentListeners.get(name)?.delete(listener);
    }),
  });

  return {
    body,
    browserWindow,
    createIcons,
    created,
    dispatchDocument: (name: string, event: DomEvent) =>
      documentListeners.get(name)?.forEach(listener => listener(event)),
    documentListeners,
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

describe('admin users manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('removes the confirmation keyboard listener when Cancel is clicked', async () => {
    const launchButton = new ElementFixture('button');
    const { browserWindow, created, documentListeners, runReady } = setupDom({
      activeElement: launchButton,
    });
    await import('../../../src/assets/js/admin/users.js');
    runReady();

    const result = (
      browserWindow.toggleUserStatus as (
        userId: string,
        action: 'enable' | 'disable'
      ) => Promise<void>
    )('user-1', 'disable');
    const cancel = created.find(
      element =>
        element.tagName === 'button' && element.textContent === 'Cancel'
    );
    cancel?.trigger('click');

    await result;
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);
    expect(launchButton.focus).toHaveBeenCalledOnce();
  });

  it('does not expose admin handlers on a sibling path with the same prefix', async () => {
    const { browserWindow, runReady } = setupDom({
      pathname: '/admin/users-preview',
    });
    await import('../../../src/assets/js/admin/users.js');

    runReady();

    expect(browserWindow).not.toHaveProperty('toggleUserStatus');
    expect(browserWindow).not.toHaveProperty('anonymizeUser');
    expect(browserWindow).not.toHaveProperty('adminUsersManager');
  });

  it('exposes handlers on nested user routes', async () => {
    const { browserWindow, created, runReady } = setupDom({
      pathname: '/admin/users/user-1',
    });
    await import('../../../src/assets/js/admin/users.js');

    runReady();

    expect(browserWindow).toHaveProperty('toggleUserStatus');
    expect(browserWindow).toHaveProperty('anonymizeUser');
    expect(browserWindow).toHaveProperty('adminUsersManager');

    (browserWindow.anonymizeUser as (userId: string, username: string) => void)(
      '',
      ''
    );
    expect(
      created.some(element => element.textContent === 'Invalid parameters')
    ).toBe(true);
  });
  it('binds CSP-safe data attributes to user actions', async () => {
    const statusButton = new ElementFixture('button');
    statusButton.dataset.userId = 'user-1';
    statusButton.dataset.userStatusAction = 'disable';
    const anonymizeButton = new ElementFixture('button');
    anonymizeButton.dataset.userId = 'user-2';
    anonymizeButton.dataset.username = 'Maria';
    const { created, runReady } = setupDom({
      queryElements: {
        '[data-user-anonymize]': [anonymizeButton],
        '[data-user-status-action]': [statusButton],
      },
    });
    await import('../../../src/assets/js/admin/users.js');

    runReady();
    statusButton.trigger('click');

    expect(
      created.some(element => element.textContent === 'Disable User')
    ).toBe(true);
    created.find(element => element.textContent === 'Cancel')?.trigger('click');

    anonymizeButton.trigger('click');
    expect(
      created.some(
        element => element.textContent === 'Anonymize User - Permanent Action'
      )
    ).toBe(true);
    findLastCreated(
      created,
      element => element.textContent === 'Cancel'
    )?.trigger('click');
  });

  it('cancels dangerous confirmation through backdrop and Escape only', async () => {
    const {
      body,
      browserWindow,
      created,
      dispatchDocument,
      documentListeners,
      runReady,
    } = setupDom({ withLucide: false });
    await import('../../../src/assets/js/admin/users.js');
    runReady();
    const manager = browserWindow.adminUsersManager as AdminUsersManagerFixture;

    const backdropResult = manager.anonymizeUser('user-1', 'Maria');
    const backdrop = body.children[0];
    const modal = backdrop.children[0];
    const titleElement = findLastCreated(
      created,
      element => element.tagName === 'h3'
    );
    const messageElement = findLastCreated(
      created,
      element => element.tagName === 'p'
    );
    expect(modal.attributes.get('role')).toBe('dialog');
    expect(modal.attributes.get('aria-modal')).toBe('true');
    expect(modal.attributes.get('aria-labelledby')).toBe(
      titleElement?.attributes.get('id')
    );
    expect(modal.attributes.get('aria-describedby')).toBe(
      messageElement?.attributes.get('id')
    );
    const confirm = findLastCreated(
      created,
      element => element.textContent === 'Yes, Anonymize Permanently'
    );
    expect(confirm?.className).toContain('bg-red-600');
    expect(confirm?.focus).toHaveBeenCalledOnce();
    backdrop.trigger('click', { target: backdrop.children[0] });
    expect(body.children).toHaveLength(1);
    backdrop.trigger('click', { target: backdrop });
    await backdropResult;
    expect(body.children).toHaveLength(0);
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);

    const escapeResult = manager.anonymizeUser('user-1', 'Maria');
    dispatchDocument('keydown', { key: 'Enter' });
    expect(body.children).toHaveLength(1);
    dispatchDocument('keydown', { key: 'Escape' });
    await escapeResult;
    expect(body.children).toHaveLength(0);
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it('rejects invalid action parameters and dismisses error notifications', async () => {
    vi.useFakeTimers();
    const { body, browserWindow, created, runReady } = setupDom({
      withLucide: false,
    });
    await import('../../../src/assets/js/admin/users.js');
    runReady();
    const manager = browserWindow.adminUsersManager as AdminUsersManagerFixture;

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

    expect(
      created.filter(element => element.textContent === 'Invalid parameters')
    ).toHaveLength(8);
    expect(
      created.filter(element => element.className.includes('bg-red-500'))
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

  it('requires a CSRF token after either action is confirmed', async () => {
    const { browserWindow, created, runReady } = setupDom();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await import('../../../src/assets/js/admin/users.js');
    runReady();
    const manager = browserWindow.adminUsersManager as AdminUsersManagerFixture;

    const toggleResult = manager.toggleUserStatus('user-1', 'enable');
    findLastCreated(
      created,
      element => element.textContent === 'Yes, Enable User'
    )?.trigger('click');
    await toggleResult;

    const anonymizeResult = manager.anonymizeUser('user-1', 'Maria');
    findLastCreated(
      created,
      element => element.textContent === 'Yes, Anonymize Permanently'
    )?.trigger('click');
    await anonymizeResult;

    expect(fetch).not.toHaveBeenCalled();
    expect(
      created.filter(
        element =>
          element.textContent ===
          'CSRF token not found. Please refresh the page.'
      )
    ).toHaveLength(2);
  });

  it('enables and disables users, then reloads after successful responses', async () => {
    vi.useFakeTimers();
    const { browserWindow, created, runReady } = setupDom({
      csrfToken: 'csrf-token',
    });
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
    await import('../../../src/assets/js/admin/users.js');
    runReady();
    const manager = browserWindow.adminUsersManager as AdminUsersManagerFixture;

    for (const action of ['enable', 'disable'] as const) {
      const result = manager.toggleUserStatus('user-1', action);
      findLastCreated(
        created,
        element =>
          element.textContent ===
          `Yes, ${action === 'enable' ? 'Enable' : 'Disable'} User`
      )?.trigger('click');
      await result;
    }

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
    const { browserWindow, created, runReady } = setupDom({
      csrfToken: 'csrf-token',
      stateText: '{"debug":true}',
    });
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
    await import('../../../src/assets/js/admin/users.js');
    runReady();
    const manager = browserWindow.adminUsersManager as AdminUsersManagerFixture;

    for (const action of ['disable', 'enable', 'disable'] as const) {
      const result = manager.toggleUserStatus('user-1', action);
      findLastCreated(
        created,
        element =>
          element.textContent ===
          `Yes, ${action === 'enable' ? 'Enable' : 'Disable'} User`
      )?.trigger('click');
      await result;
    }

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
    expect(log).toHaveBeenCalledWith('[AdminUsers]', 'Toggling user status', {
      action: 'disable',
      userId: 'user-1',
    });
    expect(log).toHaveBeenCalledWith(
      '[AdminUsers]',
      'Error toggling user status',
      {
        error: failure,
      }
    );
  });

  it('anonymizes a user and handles rejected or failed anonymization', async () => {
    vi.useFakeTimers();
    const { browserWindow, created, runReady } = setupDom({
      csrfToken: 'csrf-token',
    });
    const failure = new Error('network unavailable');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ success: false }),
      })
      .mockRejectedValueOnce(failure);
    vi.stubGlobal('fetch', fetch);
    await import('../../../src/assets/js/admin/users.js');
    runReady();
    const manager = browserWindow.adminUsersManager as AdminUsersManagerFixture;

    for (let index = 0; index < 3; index += 1) {
      const result = manager.anonymizeUser(`user-${index}`, 'Maria');
      findLastCreated(
        created,
        element => element.textContent === 'Yes, Anonymize Permanently'
      )?.trigger('click');
      await result;
    }

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/users/user-0', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'DELETE',
    });
    expect(
      created.some(
        element => element.textContent === 'User anonymized successfully'
      )
    ).toBe(true);
    expect(
      created.some(
        element => element.textContent === 'Failed to anonymize user'
      )
    ).toBe(true);
    expect(
      created.some(
        element =>
          element.textContent === 'An error occurred while anonymizing user'
      )
    ).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(
      (browserWindow.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it('falls back to development debug mode for malformed embedded state', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { browserWindow, created, runReady } = setupDom({
      csrfToken: 'csrf-token',
      environment: 'development',
      stateText: '{invalid',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('failed')));
    await import('../../../src/assets/js/admin/users.js');
    runReady();
    const manager = browserWindow.adminUsersManager as AdminUsersManagerFixture;

    const result = manager.anonymizeUser('user-1', 'Maria');
    findLastCreated(
      created,
      element => element.textContent === 'Yes, Anonymize Permanently'
    )?.trigger('click');
    await result;

    expect(log).toHaveBeenCalledWith('[AdminUsers]', 'Anonymizing user', {
      userId: 'user-1',
      username: 'Maria',
    });
  });

  it('uses non-debug defaults when embedded state is empty', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { browserWindow, runReady } = setupDom({ stateText: '' });
    await import('../../../src/assets/js/admin/users.js');

    runReady();
    const manager = browserWindow.adminUsersManager as AdminUsersManagerFixture;
    await manager.toggleUserStatus('', 'enable');

    expect(log).not.toHaveBeenCalled();
  });
});
