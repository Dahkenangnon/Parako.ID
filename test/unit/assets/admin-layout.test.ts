import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventFixture {
  key?: string;
  stopPropagation: ReturnType<typeof vi.fn>;
  target?: ElementFixture;
}

class ClassListFixture {
  private readonly values = new Set<string>();
  public readonly add = vi.fn((...names: string[]) => {
    names.forEach(name => this.values.add(name));
  });
  public readonly remove = vi.fn((...names: string[]) => {
    names.forEach(name => this.values.delete(name));
  });

  public contains(name: string): boolean {
    return this.values.has(name);
  }
}

class ElementFixture {
  public readonly classList = new ClassListFixture();
  public readonly dataset: Record<string, string> = {};
  public src = '';
  public textContent = '';
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<
    string,
    Array<(event: EventFixture) => void>
  >();
  private readonly queryResults = new Map<string, ElementFixture[]>();

  public addEventListener(
    name: string,
    listener: (event: EventFixture) => void
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public contains(target: ElementFixture | undefined): boolean {
    return target === this;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public querySelectorAll(selector: string): ElementFixture[] {
    return this.queryResults.get(selector) ?? [];
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public setQueryResults(selector: string, results: ElementFixture[]): void {
    this.queryResults.set(selector, results);
  }

  public trigger(
    name: string,
    event: EventFixture = eventFixture(this)
  ): EventFixture {
    this.listeners.get(name)?.forEach(listener => listener.call(this, event));
    return event;
  }
}

function eventFixture(target?: ElementFixture): EventFixture {
  return { stopPropagation: vi.fn(), target };
}

const config = {
  csrfToken: 'csrf-token',
  routes: {
    updateLocale: '/admin/locale',
    updateSidebar: '/admin/sidebar',
    updateTheme: '/admin/theme',
  },
  userTheme: 'light',
};

function setupDom() {
  let ready: (() => void) | undefined;
  const documentListeners = new Map<
    string,
    Array<(event: EventFixture) => void>
  >();
  const elements = new Map<string, ElementFixture>();
  const body = new ElementFixture();
  const documentElement = new ElementFixture();
  const sidebar = new ElementFixture();
  const mainContent = new ElementFixture();
  const sidebarToggle = new ElementFixture();
  const lightLogo = new ElementFixture();
  const darkLogo = new ElementFixture();
  const mobileMenuButton = new ElementFixture();
  const mobileSidebar = new ElementFixture();
  const mobileSidebarClose = new ElementFixture();
  const mobileSidebarOverlay = new ElementFixture();
  const langDropdown = new ElementFixture();
  const langToggle = new ElementFixture();
  const mobileThemeLangDropdown = new ElementFixture();
  const mobileThemeLangToggle = new ElementFixture();
  const themeIcon = new ElementFixture();
  const themeToggle = new ElementFixture();

  lightLogo.dataset.rect = '/logo-light.svg';
  lightLogo.dataset.icon = '/icon-light.svg';
  darkLogo.dataset.rect = '/logo-dark.svg';
  darkLogo.dataset.icon = '/icon-dark.svg';
  elements.set('sidebar', sidebar);
  elements.set('main-content', mainContent);
  elements.set('sidebar-toggle', sidebarToggle);
  elements.set('sidebar-logo-light', lightLogo);
  elements.set('sidebar-logo-dark', darkLogo);
  elements.set('mobile-menu-button', mobileMenuButton);
  elements.set('mobile-sidebar', mobileSidebar);
  elements.set('mobile-sidebar-close', mobileSidebarClose);
  elements.set('mobile-sidebar-overlay', mobileSidebarOverlay);
  elements.set('lang-dropdown', langDropdown);
  elements.set('lang-toggle', langToggle);
  elements.set('mobile-theme-lang-dropdown', mobileThemeLangDropdown);
  elements.set('mobile-theme-lang-toggle', mobileThemeLangToggle);
  elements.set('theme-icon', themeIcon);
  elements.set('theme-toggle', themeToggle);

  const windowFixture = {
    location: { reload: vi.fn() },
  } as Record<string, unknown>;

  vi.stubGlobal('window', windowFixture);
  vi.stubGlobal('document', {
    addEventListener: vi.fn(
      (name: string, listener: (event: EventFixture) => void) => {
        if (name === 'DOMContentLoaded') {
          ready = listener as () => void;
          return;
        }
        const listeners = documentListeners.get(name) ?? [];
        listeners.push(listener);
        documentListeners.set(name, listeners);
      }
    ),
    body,
    documentElement,
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
  });

  return {
    body,
    darkLogo,
    documentElement,
    elements,
    langDropdown,
    langToggle,
    lightLogo,
    mainContent,
    mobileMenuButton,
    mobileSidebar,
    mobileSidebarClose,
    mobileSidebarOverlay,
    mobileThemeLangDropdown,
    mobileThemeLangToggle,
    runReady: () => ready?.(),
    sidebar,
    sidebarToggle,
    themeIcon,
    themeToggle,
    triggerDocument: (name: string, event: EventFixture) => {
      documentListeners.get(name)?.forEach(listener => listener(event));
    },
    windowFixture,
  };
}

async function initializeManager(
  managerConfig: Record<string, unknown> = config
) {
  await import('../../../src/assets/js/admin/layout.js');
  const Manager = (window as any).AdminLayoutManager;
  const manager = new Manager(managerConfig);
  manager.initialize();
  return manager;
}

describe('admin layout manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('optimistically expands the sidebar and persists the new state', async () => {
    const { lightLogo, mainContent, sidebar, sidebarToggle } = setupDom();
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    sidebarToggle.trigger('click');

    expect(sidebar.classList.contains('sidebar-expanded')).toBe(true);
    expect(mainContent.classList.contains('main-content-expanded')).toBe(true);
    expect(lightLogo.src).toBe('/logo-light.svg');
    expect(fetch).toHaveBeenCalledWith('/admin/sidebar', {
      body: JSON.stringify({ expanded: true }),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'POST',
    });
  });

  it('rolls back the sidebar when persistence fails', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { darkLogo, mainContent, sidebar, sidebarToggle } = setupDom();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: false }),
      })
    );
    await initializeManager();

    sidebarToggle.trigger('click');

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[AdminLayout] Failed to update sidebar state'
      )
    );
    expect(sidebar.classList.contains('sidebar-collapsed')).toBe(true);
    expect(mainContent.classList.contains('main-content-collapsed')).toBe(true);
    expect(darkLogo.src).toBe('/icon-dark.svg');
  });

  it('opens and closes the mobile sidebar from every supported control', async () => {
    const {
      mobileMenuButton,
      mobileSidebar,
      mobileSidebarClose,
      mobileSidebarOverlay,
    } = setupDom();
    vi.stubGlobal('fetch', vi.fn());
    await initializeManager();

    mobileMenuButton.trigger('click');
    expect(mobileSidebar.classList.contains('translate-x-0')).toBe(true);
    expect(mobileSidebarOverlay.classList.contains('visible')).toBe(true);

    mobileSidebarClose.trigger('click');
    expect(mobileSidebar.classList.contains('-translate-x-full')).toBe(true);
    expect(mobileSidebarOverlay.classList.contains('invisible')).toBe(true);

    mobileMenuButton.trigger('click');
    mobileSidebarOverlay.trigger('click');
    expect(mobileSidebar.classList.contains('-translate-x-full')).toBe(true);
  });

  it('persists, applies, and redraws a theme change', async () => {
    const createIcons = vi.fn();
    const { documentElement, themeIcon, themeToggle, windowFixture } =
      setupDom();
    windowFixture.lucide = { createIcons };
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    const event = themeToggle.trigger('click');

    await vi.waitFor(() =>
      expect(documentElement.classList.contains('dark')).toBe(true)
    );
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('dark')).toBe(true);
    expect(themeIcon.getAttribute('data-lucide')).toBe('moon');
    expect(createIcons).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('/admin/theme', {
      body: JSON.stringify({ theme: 'dark' }),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'POST',
    });
  });

  it('keeps the current theme when persistence throws', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { documentElement, themeToggle } = setupDom();
    const failure = new Error('network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    await initializeManager();

    themeToggle.trigger('click');

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[AdminLayout] Failed to update theme:',
        failure
      )
    );
    expect(documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggles the language menu, closes it outside, and persists a locale', async () => {
    const localeOption = new ElementFixture();
    localeOption.setAttribute('data-locale', 'fr');
    const { langDropdown, langToggle, triggerDocument, windowFixture } =
      setupDom();
    langDropdown.classList.add('hidden');
    langDropdown.setQueryResults('.locale-option', [localeOption]);
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    const openEvent = langToggle.trigger('click');
    expect(openEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(langDropdown.classList.contains('hidden')).toBe(false);
    expect(langToggle.getAttribute('aria-expanded')).toBe('true');

    triggerDocument('click', eventFixture(new ElementFixture()));
    expect(langDropdown.classList.contains('hidden')).toBe(true);
    expect(langToggle.getAttribute('aria-expanded')).toBe('false');

    localeOption.trigger('click');
    await vi.waitFor(() =>
      expect(
        (windowFixture.location as { reload: ReturnType<typeof vi.fn> }).reload
      ).toHaveBeenCalledOnce()
    );
    expect(fetch).toHaveBeenCalledWith('/admin/locale', {
      body: JSON.stringify({ locale: 'fr' }),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'POST',
    });
  });

  it('applies a persisted theme selected from the mobile menu', async () => {
    const darkOption = new ElementFixture();
    darkOption.setAttribute('data-theme', 'dark');
    const lightOption = new ElementFixture();
    lightOption.setAttribute('data-theme', 'light');
    const { documentElement, mobileThemeLangDropdown, mobileThemeLangToggle } =
      setupDom();
    mobileThemeLangDropdown.classList.add('hidden');
    mobileThemeLangDropdown.setQueryResults('.mobile-theme-option', [
      lightOption,
      darkOption,
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
    );
    await initializeManager();

    mobileThemeLangToggle.trigger('click');
    expect(mobileThemeLangDropdown.classList.contains('hidden')).toBe(false);
    darkOption.trigger('click');

    await vi.waitFor(() =>
      expect(documentElement.classList.contains('dark')).toBe(true)
    );
    expect(darkOption.classList.contains('bg-muted')).toBe(true);
    expect(darkOption.classList.contains('border-primary')).toBe(true);
    expect(lightOption.classList.contains('border-transparent')).toBe(true);
  });

  it('switches from an initial dark theme back to light', async () => {
    const { documentElement, themeIcon, themeToggle } = setupDom();
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
    );
    await initializeManager({ ...config, userTheme: 'dark' });

    expect(themeIcon.getAttribute('data-lucide')).toBe('moon');
    themeToggle.trigger('click');

    await vi.waitFor(() =>
      expect(documentElement.classList.contains('dark')).toBe(false)
    );
    expect(document.body.classList.contains('dark')).toBe(false);
    expect(themeIcon.getAttribute('data-lucide')).toBe('sun');
  });

  it('persists locale changes selected from the mobile menu', async () => {
    const localeOption = new ElementFixture();
    localeOption.setAttribute('data-locale', 'fr');
    const { mobileThemeLangDropdown, windowFixture } = setupDom();
    mobileThemeLangDropdown.setQueryResults('.mobile-locale-option', [
      localeOption,
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
    );
    await initializeManager();

    localeOption.trigger('click');

    await vi.waitFor(() =>
      expect(
        (windowFixture.location as { reload: ReturnType<typeof vi.fn> }).reload
      ).toHaveBeenCalledOnce()
    );
  });

  it('reports locale and mobile-theme persistence failures', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const localeOption = new ElementFixture();
    localeOption.setAttribute('data-locale', 'fr');
    const darkOption = new ElementFixture();
    darkOption.setAttribute('data-theme', 'dark');
    const { langDropdown, mobileThemeLangDropdown } = setupDom();
    langDropdown.setQueryResults('.locale-option', [localeOption]);
    mobileThemeLangDropdown.setQueryResults('.mobile-theme-option', [
      darkOption,
    ]);
    const failure = new Error('network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    await initializeManager();

    localeOption.trigger('click');
    darkOption.trigger('click');

    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledWith(
      '[AdminLayout] Failed to update locale:',
      failure
    );
    expect(error).toHaveBeenCalledWith(
      '[AdminLayout] Failed to update theme:',
      failure
    );
  });

  it('closes open navigation and dropdowns with Escape only', async () => {
    const {
      langDropdown,
      langToggle,
      mobileMenuButton,
      mobileSidebar,
      mobileSidebarOverlay,
      mobileThemeLangDropdown,
      mobileThemeLangToggle,
      triggerDocument,
    } = setupDom();
    vi.stubGlobal('fetch', vi.fn());
    await initializeManager();

    mobileMenuButton.trigger('click');
    langDropdown.classList.remove('hidden');
    mobileThemeLangDropdown.classList.remove('hidden');
    triggerDocument('keydown', {
      key: 'Enter',
      stopPropagation: vi.fn(),
    });
    expect(mobileSidebar.classList.contains('translate-x-0')).toBe(true);

    triggerDocument('keydown', {
      key: 'Escape',
      stopPropagation: vi.fn(),
    });
    expect(mobileSidebar.classList.contains('-translate-x-full')).toBe(true);
    expect(mobileSidebarOverlay.classList.contains('invisible')).toBe(true);
    expect(langDropdown.classList.contains('hidden')).toBe(true);
    expect(langToggle.getAttribute('aria-expanded')).toBe('false');
    expect(mobileThemeLangDropdown.classList.contains('hidden')).toBe(true);
    expect(mobileThemeLangToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('tolerates partial markup when Escape is pressed', async () => {
    const { elements, triggerDocument } = setupDom();
    elements.delete('lang-toggle');
    elements.delete('mobile-theme-lang-toggle');
    vi.stubGlobal('fetch', vi.fn());
    await initializeManager();

    expect(() =>
      triggerDocument('keydown', {
        key: 'Escape',
        stopPropagation: vi.fn(),
      })
    ).not.toThrow();
  });

  it('initializes safely when optional layout markup is absent', async () => {
    const { elements, triggerDocument } = setupDom();
    elements.clear();
    vi.stubGlobal('fetch', vi.fn());

    await expect(
      initializeManager({ ...config, userTheme: '' })
    ).resolves.toBeDefined();
    expect(() =>
      triggerDocument('keydown', {
        key: 'Escape',
        stopPropagation: vi.fn(),
      })
    ).not.toThrow();
  });

  it('does not toggle a sidebar whose content element is missing', async () => {
    const { elements, sidebar, sidebarToggle } = setupDom();
    elements.delete('main-content');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    sidebarToggle.trigger('click');

    expect(sidebar.classList.contains('sidebar-expanded')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles absent logos and incomplete mobile sidebar markup', async () => {
    const { elements, mobileMenuButton, sidebarToggle } = setupDom();
    elements.delete('sidebar-logo-light');
    elements.delete('sidebar-logo-dark');
    elements.delete('mobile-sidebar');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
    );
    await initializeManager();

    expect(() => sidebarToggle.trigger('click')).not.toThrow();
    expect(() => mobileMenuButton.trigger('click')).not.toThrow();
  });

  it('leaves logo sources unchanged when their data attributes are absent', async () => {
    const { darkLogo, lightLogo, sidebarToggle } = setupDom();
    delete lightLogo.dataset.rect;
    delete lightLogo.dataset.icon;
    delete darkLogo.dataset.rect;
    delete darkLogo.dataset.icon;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
    );
    await initializeManager();

    sidebarToggle.trigger('click');
    await vi.waitFor(() => expect(lightLogo.src).toBe(''));
    sidebarToggle.trigger('click');

    expect(lightLogo.src).toBe('');
    expect(darkLogo.src).toBe('');
  });

  it('ignores menu options without theme or locale values', async () => {
    const desktopLocale = new ElementFixture();
    const mobileLocale = new ElementFixture();
    const mobileTheme = new ElementFixture();
    const { langDropdown, mobileThemeLangDropdown } = setupDom();
    langDropdown.setQueryResults('.locale-option', [desktopLocale]);
    mobileThemeLangDropdown.setQueryResults('.mobile-locale-option', [
      mobileLocale,
    ]);
    mobileThemeLangDropdown.setQueryResults('.mobile-theme-option', [
      mobileTheme,
    ]);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    desktopLocale.trigger('click');
    mobileLocale.trigger('click');
    mobileTheme.trigger('click');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps menus open for clicks inside their controls', async () => {
    const {
      langDropdown,
      langToggle,
      mobileThemeLangDropdown,
      mobileThemeLangToggle,
      triggerDocument,
    } = setupDom();
    vi.stubGlobal('fetch', vi.fn());
    await initializeManager();

    langDropdown.classList.add('hidden');
    mobileThemeLangDropdown.classList.add('hidden');
    langToggle.trigger('click');
    mobileThemeLangToggle.trigger('click');
    triggerDocument('click', eventFixture(langToggle));
    expect(langDropdown.classList.contains('hidden')).toBe(false);

    mobileThemeLangToggle.trigger('click');
    triggerDocument('click', eventFixture(mobileThemeLangDropdown));

    expect(mobileThemeLangDropdown.classList.contains('hidden')).toBe(false);
  });

  it('closes a dropdown when its toggle is clicked again', async () => {
    const { langDropdown, langToggle } = setupDom();
    langDropdown.classList.add('hidden');
    vi.stubGlobal('fetch', vi.fn());
    await initializeManager();

    langToggle.trigger('click');
    langToggle.trigger('click');

    expect(langDropdown.classList.contains('hidden')).toBe(true);
    expect(langToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not apply server-rejected theme and locale changes', async () => {
    const localeOption = new ElementFixture();
    localeOption.setAttribute('data-locale', 'fr');
    const darkOption = new ElementFixture();
    darkOption.setAttribute('data-theme', 'dark');
    const {
      documentElement,
      langDropdown,
      mobileThemeLangDropdown,
      themeToggle,
      windowFixture,
    } = setupDom();
    langDropdown.setQueryResults('.locale-option', [localeOption]);
    mobileThemeLangDropdown.setQueryResults('.mobile-theme-option', [
      darkOption,
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: false }),
      })
    );
    await initializeManager();

    themeToggle.trigger('click');
    localeOption.trigger('click');
    darkOption.trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(documentElement.classList.contains('dark')).toBe(false);
    expect(
      (windowFixture.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).not.toHaveBeenCalled();
  });

  it('warns when automatic initialization has no embedded state', async () => {
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { runReady } = setupDom();
    await import('../../../src/assets/js/admin/layout.js');

    runReady();

    expect(warning).toHaveBeenCalledWith(
      '[AdminLayout] State element not found'
    );
  });

  it('reports malformed embedded state during automatic initialization', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { elements, runReady } = setupDom();
    const state = new ElementFixture();
    state.textContent = '{invalid';
    elements.set('___ADMIN_LAYOUT_STATE___', state);
    await import('../../../src/assets/js/admin/layout.js');

    runReady();

    expect(error).toHaveBeenCalledWith(
      '[AdminLayout] Initialization failed:',
      expect.any(SyntaxError)
    );
  });

  it('automatically initializes from embedded state, including empty content', async () => {
    const { elements, runReady, themeIcon } = setupDom();
    const state = new ElementFixture();
    elements.set('___ADMIN_LAYOUT_STATE___', state);
    await import('../../../src/assets/js/admin/layout.js');

    expect(() => runReady()).not.toThrow();
    expect(themeIcon.getAttribute('data-lucide')).toBe('sun');
  });

  it('does not expose the manager when no window global exists', async () => {
    setupDom();
    vi.stubGlobal('window', undefined);

    await expect(
      import('../../../src/assets/js/admin/layout.js')
    ).resolves.toBeDefined();
  });
});
