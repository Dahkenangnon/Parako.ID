import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  initializeMainPage,
  MainManager,
} from '../../../src/assets/js/main.js';

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
  public readonly classList = new ClassListFixture();
  public readonly listeners = new Map<
    string,
    Array<(event: EventFixture) => void>
  >();
  public readonly style: Record<string, string> = {};
  public className = '';
  public textContent = '';
  public value = '';
  private readonly attributes = new Map<string, string>();

  public addEventListener(
    name: string,
    listener: (event: EventFixture) => void
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
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
  let mutationCallback: MutationCallback | undefined;
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
    body,
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
    createIcons,
    darkPaths,
    disconnect,
    documentElement,
    elements,
    lightPaths,
    localStorage: localStorageFixture,
    mutation: (records: Array<{ attributeName: string | null }>) =>
      mutationCallback?.(records as MutationRecord[], {} as MutationObserver),
    observe,
    reload,
    triggerWindow: (name: string, event: Record<string, unknown> = {}) => {
      windowListeners.get(name)?.forEach(listener => listener(event));
    },
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

    const manager = initializeMainPage();
    expect(manager).toBeInstanceOf(MainManager);

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

      initializeMainPage();
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

    initializeMainPage();
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
    setupDom({ lucideError });

    initializeMainPage();

    expect(error).toHaveBeenCalledWith(
      '[MainManager]',
      'Failed to initialize Lucide icons',
      { error: lucideError }
    );
  });

  it('tolerates configured locale and timezone controls missing from the page', async () => {
    const debug = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setupDom({
      state: {
        availableLocales: ['en', 'fr'],
        debug: true,
        environment: 'development',
        routes: { updateTimezone: '/settings/timezone' },
        theme: 'light',
      },
    });

    initializeMainPage();

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

    initializeMainPage();
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

    initializeMainPage();
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

      initializeMainPage();
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

    initializeMainPage();
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

    initializeMainPage();
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

  it('falls back after malformed bootstrap state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = setupDom({
      bodyTheme: 'dark',
      documentEnvironment: 'development',
      rawState: '{malformed',
    });

    initializeMainPage();
    expect(context.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses safe constructor defaults for an empty bootstrap state', async () => {
    const context = setupDom({ rawState: '' });

    initializeMainPage();
    expect(context.documentElement.classList.contains('dark')).toBe(false);
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });

  it('enables malformed-state diagnostics on localhost with no body theme', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setupDom({
      bodyTheme: '',
      hostname: 'localhost',
      rawState: '{malformed',
    });

    initializeMainPage();
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });

  it('uses fallback configuration when bootstrap state is missing', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const context = setupDom({
      bodyTheme: 'dark',
      debugStorage: 'true',
      hasState: false,
    });

    initializeMainPage();

    expect(error).toHaveBeenCalledWith(
      '[MainManager] No configuration data found in DOM'
    );
    expect(context.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses localhost and light-theme fallbacks when bootstrap state is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setupDom({
      bodyTheme: '',
      hasState: false,
      hostname: 'localhost',
    });

    initializeMainPage();
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });
});
