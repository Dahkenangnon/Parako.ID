import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventFixture {
  key?: string;
  target?: ElementFixture;
}

class ClassListFixture {
  private readonly values = new Set<string>();
  public readonly add = vi.fn((...tokens: string[]) => {
    tokens.forEach(token => this.values.add(token));
  });
  public readonly remove = vi.fn((...tokens: string[]) => {
    tokens.forEach(token => this.values.delete(token));
  });
  public readonly toggle = vi.fn((token: string, force?: boolean) => {
    const enabled = force ?? !this.values.has(token);
    if (enabled) this.values.add(token);
    else this.values.delete(token);
    return enabled;
  });

  public contains(token: string): boolean {
    return this.values.has(token);
  }
}

class ElementFixture {
  public readonly children: ElementFixture[] = [];
  public readonly classList = new ClassListFixture();
  public readonly listeners = new Map<
    string,
    Array<(event: EventFixture) => void>
  >();
  public readonly style: Record<string, string> = {};
  public className = '';
  public textContent = '';
  public type = '';
  public value = '';
  public readonly focus = vi.fn();
  public readonly remove = vi.fn();
  private readonly attributes = new Map<string, string>();

  public addEventListener(
    name: string,
    listener: (event: EventFixture) => void
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    this.children.push(child);
    return child;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string, event: EventFixture = {}): void {
    this.listeners.get(name)?.forEach(listener => listener(event));
  }
}

interface SetupOptions {
  activeElement?: ElementFixture;
  bodyTheme?: string;
  debugStorage?: string | null;
  documentEnvironment?: string;
  elements?: Record<string, ElementFixture>;
  hasState?: boolean;
  hostname?: string;
  lucideError?: Error;
  rawState?: string;
  state?: Record<string, unknown>;
  withLucide?: boolean;
}

function setupDom(options: SetupOptions = {}) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  let mutationCallback: MutationCallback | undefined;
  const created: ElementFixture[] = [];
  const documentListeners = new Map<
    string,
    Array<(event: EventFixture) => void>
  >();
  const windowListeners = new Map<
    string,
    Array<(event: Record<string, unknown>) => void>
  >();
  const body = new ElementFixture();
  const documentElement = new ElementFixture();
  const state = new ElementFixture();
  const elements = new Map(Object.entries(options.elements ?? {}));
  const lightPaths = [new ElementFixture()];
  const darkPaths = [new ElementFixture()];
  const createIcons = options.lucideError
    ? vi.fn(() => {
        throw options.lucideError;
      })
    : vi.fn();
  const reload = vi.fn();
  const disconnect = vi.fn();
  const observe = vi.fn();
  state.textContent =
    options.rawState ??
    JSON.stringify(
      options.state ?? {
        availableLocales: [],
        debug: false,
        environment: 'test',
        theme: 'light',
      }
    );
  body.setAttribute('data-theme', options.bodyTheme ?? 'light');
  if (options.documentEnvironment) {
    documentElement.setAttribute('data-env', options.documentEnvironment);
  }

  const addDocumentListener = (
    name: string,
    listener: (event: EventFixture) => void
  ) => {
    if (name === 'DOMContentLoaded') {
      ready = listener as () => void;
      return;
    }
    const listeners = documentListeners.get(name) ?? [];
    listeners.push(listener);
    documentListeners.set(name, listeners);
  };
  const removeDocumentListener = (
    name: string,
    listener: (event: EventFixture) => void
  ) => {
    const listeners = documentListeners.get(name) ?? [];
    documentListeners.set(
      name,
      listeners.filter(candidate => candidate !== listener)
    );
  };

  const windowFixture: Record<string, unknown> = {
    addEventListener: vi.fn(
      (name: string, listener: (event: Record<string, unknown>) => void) => {
        const listeners = windowListeners.get(name) ?? [];
        listeners.push(listener);
        windowListeners.set(name, listeners);
      }
    ),
    location: { hostname: options.hostname ?? 'id.example.test', reload },
  };
  if (options.withLucide !== false) {
    windowFixture.lucide = { createIcons };
  }

  vi.stubGlobal('window', windowFixture);
  vi.stubGlobal('document', {
    activeElement: options.activeElement ?? null,
    addEventListener: vi.fn(addDocumentListener),
    removeEventListener: vi.fn(removeDocumentListener),
    body,
    createElement: vi.fn(() => {
      const element = new ElementFixture();
      created.push(element);
      return element;
    }),
    documentElement,
    getElementById: vi.fn((id: string) => {
      if (id === '___MAIN_STATE___') {
        return options.hasState === false ? null : state;
      }
      return elements.get(id) ?? null;
    }),
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === '.light-mode-path') return lightPaths;
      if (selector === '.dark-mode-path') return darkPaths;
      return [];
    }),
  });
  const localStorageFixture = {
    getItem: vi.fn((key: string) =>
      key === 'debug' ? (options.debugStorage ?? null) : null
    ),
    setItem: vi.fn(),
  };
  vi.stubGlobal('localStorage', localStorageFixture);
  vi.stubGlobal(
    'MutationObserver',
    class {
      public constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }
      public disconnect = disconnect;
      public observe = observe;
    }
  );

  return {
    created,
    createIcons,
    darkPaths,
    disconnect,
    documentListeners,
    documentElement,
    elements,
    lightPaths,
    localStorage: localStorageFixture,
    mutation: (records: Array<{ attributeName: string | null }>) =>
      mutationCallback?.(records as MutationRecord[], {} as MutationObserver),
    observe,
    reload,
    runReady: () => ready?.(),
    triggerWindow: (name: string, event: Record<string, unknown> = {}) => {
      windowListeners.get(name)?.forEach(listener => listener(event));
    },
    windowFixture,
  };
}

async function settleAsyncUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('main browser entrypoint', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('removes the global Escape listener when an alert closes', async () => {
    const context = setupDom();
    await import('../../../src/assets/js/main.js');
    context.runReady();

    const dialog = (context.windowFixture as any).dialog;
    const result = dialog.showAlert('Notice', 'Done');
    const backdrop = context.created[0]!;
    const modal = context.created[1]!;
    const title = context.created[5]!;
    const message = context.created[7]!;
    const button = context.created[9]!;
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-labelledby')).toBe(
      title.getAttribute('id')
    );
    expect(modal.getAttribute('aria-describedby')).toBe(
      message.getAttribute('id')
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(button.focus).toHaveBeenCalledOnce();
    button.trigger('click');

    await expect(result).resolves.toBeUndefined();
    expect(backdrop.remove).toHaveBeenCalledOnce();
    expect(document.removeEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function)
    );
    expect(context.documentListeners.get('keydown')).toEqual([]);
  });

  it('dismisses a custom-icon alert only when its backdrop is clicked', async () => {
    const context = setupDom({ withLucide: false });
    await import('../../../src/assets/js/main.js');
    context.runReady();

    const result = (context.windowFixture as any).dialog.showAlert(
      'Security notice',
      'Review this message',
      { buttonText: 'Understood', icon: 'shield', variant: 'danger' }
    );
    const backdrop = context.created[0]!;
    const modal = context.created[1]!;
    const icon = context.created[4]!;
    const button = context.created[9]!;
    expect(icon.getAttribute('data-lucide')).toBe('shield');
    expect(button.textContent).toBe('Understood');

    backdrop.trigger('click', { target: modal });
    expect(backdrop.remove).not.toHaveBeenCalled();
    backdrop.trigger('click', { target: backdrop });

    await expect(result).resolves.toBeUndefined();
    expect(backdrop.remove).toHaveBeenCalledOnce();
  });

  it('resolves a custom confirmation when the user accepts it', async () => {
    const context = setupDom();
    await import('../../../src/assets/js/main.js');
    context.runReady();

    const result = (context.windowFixture as any).dialog.showConfirm(
      'Delete session',
      'This cannot be undone',
      {
        cancelText: 'Keep it',
        confirmText: 'Delete',
        icon: 'shield-alert',
        variant: 'danger',
      }
    );
    const icon = context.created[4]!;
    const modal = context.created[1]!;
    const title = context.created[5]!;
    const message = context.created[7]!;
    const cancelButton = context.created[9]!;
    const confirmButton = context.created[10]!;
    expect(icon.getAttribute('data-lucide')).toBe('shield-alert');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-labelledby')).toBe(
      title.getAttribute('id')
    );
    expect(modal.getAttribute('aria-describedby')).toBe(
      message.getAttribute('id')
    );
    expect(cancelButton.textContent).toBe('Keep it');
    expect(confirmButton.textContent).toBe('Delete');
    await vi.advanceTimersByTimeAsync(100);
    expect(confirmButton.focus).toHaveBeenCalledOnce();

    confirmButton.trigger('click');

    await expect(result).resolves.toBe(true);
    expect(document.removeEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function)
    );
  });

  it('restores focus after a confirmation is cancelled', async () => {
    const trigger = new ElementFixture();
    const context = setupDom({ activeElement: trigger });
    await import('../../../src/assets/js/main.js');
    context.runReady();

    const result = (context.windowFixture as any).dialog.showConfirm(
      'Revoke sessions',
      'This cannot be undone'
    );
    const cancelButton = context.created[9]!;
    cancelButton.trigger('click');

    await expect(result).resolves.toBe(false);
    expect(trigger.focus).toHaveBeenCalledOnce();
  });

  it('supports keyboard and backdrop confirmation cancellation without Lucide', async () => {
    const context = setupDom({ withLucide: false });
    await import('../../../src/assets/js/main.js');
    context.runReady();
    const dialog = (context.windowFixture as any).dialog;

    const keyboardResult = dialog.showConfirm('Continue?', 'Review first');
    const keydown = context.documentListeners.get('keydown')!.at(-1)!;
    keydown({ key: 'Enter' });
    expect(context.created[0]?.remove).not.toHaveBeenCalled();
    keydown({ key: 'Escape' });
    await expect(keyboardResult).resolves.toBe(false);

    context.created.length = 0;
    const backdropResult = dialog.showConfirm('Continue?', 'Review first');
    const backdrop = context.created[0]!;
    const modal = context.created[1]!;
    backdrop.trigger('click', { target: modal });
    expect(backdrop.remove).not.toHaveBeenCalled();
    backdrop.trigger('click', { target: backdrop });
    await expect(backdropResult).resolves.toBe(false);
  });

  it('supports legacy dialogs and Escape dismissal', async () => {
    const context = setupDom();
    await import('../../../src/assets/js/main.js');
    context.runReady();
    const dialog = (context.windowFixture as any).dialog;

    const confirmResult = dialog.confirm('Continue?');
    expect(context.created[5]?.textContent).toBe('Confirm');
    context.created[9]!.trigger('click');
    await expect(confirmResult).resolves.toBe(false);

    context.created.length = 0;
    const alertResult = dialog.alert('Saved');
    expect(context.created[5]?.textContent).toBe('Notice');
    const keydown = context.documentListeners.get('keydown')!.at(-1)!;
    keydown({ key: 'Enter' });
    expect(context.created[0]?.remove).not.toHaveBeenCalled();
    keydown({ key: 'Escape' });
    await expect(alertResult).resolves.toBeUndefined();
  });

  it('reconciles the server theme and toggles it locally', async () => {
    const themeToggle = new ElementFixture();
    const lightIcon = new ElementFixture();
    const darkIcon = new ElementFixture();
    const context = setupDom({
      elements: {
        'theme-toggle': themeToggle,
        'theme-toggle-dark-icon': darkIcon,
        'theme-toggle-light-icon': lightIcon,
      },
      state: {
        availableLocales: [],
        debug: false,
        environment: 'production',
        theme: 'dark',
      },
    });

    await import('../../../src/assets/js/main.js');
    context.runReady();

    expect(context.documentElement.classList.contains('dark')).toBe(true);
    expect(document.body.classList.contains('dark')).toBe(true);
    expect(document.body.getAttribute('data-theme')).toBe('dark');
    expect(lightIcon.classList.contains('hidden')).toBe(true);
    expect(darkIcon.classList.contains('hidden')).toBe(false);
    expect(context.lightPaths[0]?.classList.toggle).toHaveBeenCalledWith(
      'hidden',
      true
    );
    expect(context.darkPaths[0]?.classList.toggle).toHaveBeenCalledWith(
      'hidden',
      false
    );

    themeToggle.trigger('click');

    expect(context.localStorage.setItem).toHaveBeenCalledWith('theme', 'light');
    expect(context.documentElement.classList.contains('dark')).toBe(false);
    expect(document.body.getAttribute('data-theme')).toBe('light');
    expect(lightIcon.classList.contains('hidden')).toBe(false);
    expect(darkIcon.classList.contains('hidden')).toBe(true);
    expect(context.createIcons).toHaveBeenCalledOnce();
    expect(context.observe).toHaveBeenCalledWith(context.documentElement, {
      attributeFilter: ['class'],
      attributes: true,
    });
  });

  it.each([
    'success',
    'reported-failure',
    'http-error',
    'network-error',
  ] as const)(
    'applies the selected theme after a %s server outcome',
    async outcome => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const themeToggle = new ElementFixture();
      const fetch = vi.fn();
      if (outcome === 'network-error') {
        fetch.mockRejectedValue(new Error('network unavailable'));
      } else if (outcome === 'http-error') {
        fetch.mockResolvedValue({ ok: false, status: 503 });
      } else {
        fetch.mockResolvedValue({
          json: vi.fn().mockResolvedValue({ success: outcome === 'success' }),
          ok: true,
          status: 200,
        });
      }
      const context = setupDom({
        elements: { 'theme-toggle': themeToggle },
        state: {
          availableLocales: [],
          csrfToken: 'csrf-token',
          debug: false,
          environment: 'production',
          routes: { updateTheme: '/settings/theme' },
          theme: 'light',
        },
      });
      vi.stubGlobal('fetch', fetch);

      await import('../../../src/assets/js/main.js');
      context.runReady();
      themeToggle.trigger('click');
      await settleAsyncUpdates();

      expect(fetch).toHaveBeenCalledWith('/settings/theme', {
        body: JSON.stringify({ theme: 'dark' }),
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        },
        method: 'POST',
      });
      expect(context.localStorage.setItem).toHaveBeenCalledWith(
        'theme',
        'dark'
      );
      expect(context.documentElement.classList.contains('dark')).toBe(true);
      expect(document.body.getAttribute('data-theme')).toBe('dark');
    }
  );

  it('reports global runtime failures and disconnects its theme observer', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const context = setupDom({
      state: {
        availableLocales: [],
        debug: true,
        environment: 'development',
        theme: 'light',
      },
      withLucide: false,
    });

    await import('../../../src/assets/js/main.js');
    context.runReady();
    const rejection = new Error('async failure');
    context.triggerWindow('unhandledrejection', { reason: rejection });
    context.triggerWindow('error', {
      filename: 'bundle.js',
      lineno: 42,
      message: 'sync failure',
    });
    context.documentElement.classList.add('dark');
    context.mutation([{ attributeName: 'id' }, { attributeName: 'class' }]);
    context.triggerWindow('beforeunload');

    expect(warn).toHaveBeenCalledWith(
      '[MainManager]',
      'Lucide not available or createIcons method not found'
    );
    expect(error).toHaveBeenCalledWith(
      '[MainManager]',
      'Unhandled promise rejection',
      { reason: rejection }
    );
    expect(error).toHaveBeenCalledWith('[MainManager]', 'Uncaught error', {
      filename: 'bundle.js',
      lineno: 42,
      message: 'sync failure',
    });
    expect(context.lightPaths[0]?.classList.toggle).toHaveBeenLastCalledWith(
      'hidden',
      true
    );
    expect(context.disconnect).toHaveBeenCalledOnce();
  });

  it('reports a Lucide initialization exception without aborting startup', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const lucideError = new Error('invalid icon markup');
    const context = setupDom({ lucideError });

    await import('../../../src/assets/js/main.js');
    context.runReady();

    expect(error).toHaveBeenCalledWith(
      '[MainManager]',
      'Failed to initialize Lucide icons',
      { error: lucideError }
    );
    expect((context.windowFixture as any).mainManager).toBeDefined();
  });

  it('tolerates configured locale and timezone controls missing from the page', async () => {
    const debug = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const context = setupDom({
      state: {
        availableLocales: ['en', 'fr'],
        debug: true,
        environment: 'development',
        routes: { updateTimezone: '/settings/timezone' },
        theme: 'light',
      },
    });

    await import('../../../src/assets/js/main.js');
    context.runReady();

    expect(warn).toHaveBeenCalledWith(
      '[MainManager]',
      'Language selector not found in DOM'
    );
    expect(debug).toHaveBeenCalledWith(
      '[MainManager]',
      'Timezone selector not found in DOM'
    );
  });

  it('persists a language change locally when server synchronization is unavailable', async () => {
    const languageSelector = new ElementFixture();
    const context = setupDom({
      elements: { 'language-selector': languageSelector },
      state: {
        availableLocales: ['en', 'fr'],
        debug: false,
        environment: 'production',
        locale: 'fr',
        theme: 'light',
      },
    });

    await import('../../../src/assets/js/main.js');
    context.runReady();
    expect(languageSelector.value).toBe('fr');

    languageSelector.value = 'en';
    languageSelector.trigger('change', { target: languageSelector });

    expect(context.localStorage.setItem).toHaveBeenCalledWith('locale', 'en');
    expect(context.reload).toHaveBeenCalledOnce();
  });

  it('synchronizes a language change with the server before reloading', async () => {
    const languageSelector = new ElementFixture();
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
      ok: true,
      status: 200,
    });
    const context = setupDom({
      elements: { 'language-selector': languageSelector },
      state: {
        availableLocales: ['en', 'fr'],
        csrfToken: 'csrf-token',
        debug: false,
        environment: 'production',
        locale: 'en',
        routes: { updateLocale: '/settings/locale' },
        theme: 'light',
      },
    });
    vi.stubGlobal('fetch', fetch);

    await import('../../../src/assets/js/main.js');
    context.runReady();
    languageSelector.value = 'fr';
    languageSelector.trigger('change', { target: languageSelector });
    await settleAsyncUpdates();

    expect(fetch).toHaveBeenCalledWith('/settings/locale', {
      body: JSON.stringify({ locale: 'fr' }),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'POST',
    });
    expect(context.reload).toHaveBeenCalledOnce();
  });

  it.each(['reported-failure', 'http-error', 'network-error'] as const)(
    'reloads from local locale state after a %s server outcome',
    async outcome => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const languageSelector = new ElementFixture();
      const fetch = vi.fn();
      if (outcome === 'network-error') {
        fetch.mockRejectedValue(new Error('network unavailable'));
      } else if (outcome === 'http-error') {
        fetch.mockResolvedValue({ ok: false, status: 503 });
      } else {
        fetch.mockResolvedValue({
          json: vi.fn().mockResolvedValue({ success: false }),
          ok: true,
          status: 200,
        });
      }
      const context = setupDom({
        elements: { 'language-selector': languageSelector },
        state: {
          availableLocales: ['en', 'fr'],
          csrfToken: 'csrf-token',
          debug: false,
          environment: 'production',
          locale: 'en',
          routes: { updateLocale: '/settings/locale' },
          theme: 'light',
        },
      });
      vi.stubGlobal('fetch', fetch);

      await import('../../../src/assets/js/main.js');
      context.runReady();
      languageSelector.value = 'fr';
      languageSelector.trigger('change', { target: languageSelector });
      await settleAsyncUpdates();

      expect(context.localStorage.setItem).toHaveBeenCalledWith('locale', 'fr');
      expect(context.reload).toHaveBeenCalledOnce();
    }
  );

  it('does not send a timezone change without a CSRF token', async () => {
    const timezoneSelector = new ElementFixture();
    const fetch = vi.fn();
    const context = setupDom({
      elements: { 'timezone-selector-settings': timezoneSelector },
      state: {
        availableLocales: [],
        debug: false,
        environment: 'production',
        routes: { updateTimezone: '/settings/timezone' },
        theme: 'light',
      },
    });
    vi.stubGlobal('fetch', fetch);

    await import('../../../src/assets/js/main.js');
    context.runReady();
    timezoneSelector.value = 'Africa/Porto-Novo';
    timezoneSelector.trigger('change', { target: timezoneSelector });

    expect(fetch).not.toHaveBeenCalled();
    expect(context.reload).not.toHaveBeenCalled();
  });

  it.each([
    'success',
    'reported-failure',
    'http-error',
    'network-error',
  ] as const)('handles a %s timezone server outcome', async outcome => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const timezoneSelector = new ElementFixture();
    const fetch = vi.fn();
    if (outcome === 'network-error') {
      fetch.mockRejectedValue(new Error('network unavailable'));
    } else if (outcome === 'http-error') {
      fetch.mockResolvedValue({ ok: false, status: 503 });
    } else {
      fetch.mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: outcome === 'success' }),
        ok: true,
        status: 200,
      });
    }
    const context = setupDom({
      elements: { 'timezone-selector-settings': timezoneSelector },
      state: {
        availableLocales: [],
        csrfToken: 'csrf-token',
        debug: false,
        environment: 'production',
        routes: { updateTimezone: '/settings/timezone' },
        theme: 'light',
      },
    });
    vi.stubGlobal('fetch', fetch);

    await import('../../../src/assets/js/main.js');
    context.runReady();
    timezoneSelector.value = 'Africa/Porto-Novo';
    timezoneSelector.trigger('change', { target: timezoneSelector });
    await settleAsyncUpdates();

    expect(fetch).toHaveBeenCalledWith('/settings/timezone', {
      body: JSON.stringify({ timezone: 'Africa/Porto-Novo' }),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'POST',
    });
    expect(context.reload).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
  });

  it('publishes a usable global manager after malformed bootstrap state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = setupDom({
      bodyTheme: 'dark',
      documentEnvironment: 'development',
      rawState: '{malformed',
    });

    await import('../../../src/assets/js/main.js');
    context.runReady();

    expect((context.windowFixture as any).mainManager).toBeDefined();
    expect((context.windowFixture as any).dialog).toBeDefined();
    expect(context.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses safe constructor defaults for an empty bootstrap state', async () => {
    const context = setupDom({ rawState: '' });

    await import('../../../src/assets/js/main.js');
    context.runReady();

    expect((context.windowFixture as any).mainManager).toBeDefined();
    expect((context.windowFixture as any).dialog).toBeDefined();
    expect(context.documentElement.classList.contains('dark')).toBe(false);
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });

  it('enables malformed-state diagnostics on localhost with no body theme', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = setupDom({
      bodyTheme: '',
      hostname: 'localhost',
      rawState: '{malformed',
    });

    await import('../../../src/assets/js/main.js');
    context.runReady();

    expect((context.windowFixture as any).mainManager).toBeDefined();
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });

  it('publishes fallback globals when bootstrap state is missing', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const context = setupDom({
      bodyTheme: 'dark',
      debugStorage: 'true',
      hasState: false,
    });

    await import('../../../src/assets/js/main.js');
    context.runReady();

    expect(error).toHaveBeenCalledWith(
      '[MainManager] No configuration data found in DOM'
    );
    expect((context.windowFixture as any).mainManager).toBeDefined();
    expect((context.windowFixture as any).dialog).toBeDefined();
    expect(context.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses localhost and light-theme fallbacks when bootstrap state is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = setupDom({
      bodyTheme: '',
      hasState: false,
      hostname: 'localhost',
    });

    await import('../../../src/assets/js/main.js');
    context.runReady();

    expect((context.windowFixture as any).mainManager).toBeDefined();
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });
});
