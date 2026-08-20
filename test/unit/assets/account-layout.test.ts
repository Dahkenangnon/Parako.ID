import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AccountLayoutManager,
  initializeAccountLayout,
  type AccountLayoutConfig,
  type AccountLayoutDialog,
} from '../../../src/assets/js/account/layout.js';

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
  public readonly appendChild = vi.fn((child: ElementFixture) => child);
  public readonly classList = new ClassListFixture();
  public readonly dataset: Record<string, string> = {};
  public readonly style: Record<string, string> = {};
  public action = '';
  public className = '';
  public innerHTML = '';
  public method = '';
  public name = '';
  public src = '';
  public textContent = '';
  public title = '';
  public type = '';
  public value = '';
  public readonly submit = vi.fn();
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

  public closest(selector: string): ElementFixture | null {
    return selector === 'button' && this.type === 'button' ? this : null;
  }

  public contains(target: ElementFixture | undefined): boolean {
    return target === this;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public getBoundingClientRect(): { top: number } {
    return { top: 100 };
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

const config: AccountLayoutConfig = {
  csrfToken: 'csrf-token',
  routes: {
    accountSwitcherData: '/accounts/data',
    removeAccount: '/accounts/remove',
    switchAccount: '/accounts/switch',
    updateLocale: '/accounts/locale',
    updateSidebar: '/accounts/sidebar',
    updateTheme: '/accounts/theme',
  },
  translations: {},
  userTheme: 'light',
};

function setupDom() {
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
  const sidebarUserBtn = new ElementFixture();
  const sidebarUserDropdown = new ElementFixture();
  const accountsLoadingSidebar = new ElementFixture();
  const accountsListSidebar = new ElementFixture();
  const accountsErrorSidebar = new ElementFixture();
  const accountsRetrySidebar = new ElementFixture();
  const otherAccountsListSidebar = new ElementFixture();
  const accountStatusText = new ElementFixture();
  const mobileUserBtn = new ElementFixture();
  const mobileUserDropdown = new ElementFixture();
  const accountsLoadingMobile = new ElementFixture();
  const accountsListMobile = new ElementFixture();
  const accountsErrorMobile = new ElementFixture();
  const accountsRetryMobile = new ElementFixture();
  const otherAccountsListMobile = new ElementFixture();
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
  elements.set('sidebar-user-btn', sidebarUserBtn);
  elements.set('sidebar-user-dropdown', sidebarUserDropdown);
  elements.set('accounts-loading-sidebar', accountsLoadingSidebar);
  elements.set('accounts-list-sidebar', accountsListSidebar);
  elements.set('accounts-error-sidebar', accountsErrorSidebar);
  elements.set('accounts-retry-sidebar', accountsRetrySidebar);
  elements.set('other-accounts-list-sidebar', otherAccountsListSidebar);
  elements.set('account-status-text', accountStatusText);
  elements.set('mobile-user-btn', mobileUserBtn);
  elements.set('mobile-user-dropdown', mobileUserDropdown);
  elements.set('accounts-loading-mobile', accountsLoadingMobile);
  elements.set('accounts-list-mobile', accountsListMobile);
  elements.set('accounts-error-mobile', accountsErrorMobile);
  elements.set('accounts-retry-mobile', accountsRetryMobile);
  elements.set('other-accounts-list-mobile', otherAccountsListMobile);
  elements.set('theme-icon', themeIcon);
  elements.set('theme-toggle', themeToggle);

  const windowFixture = {
    innerHeight: 900,
    location: {
      origin: 'https://id.example.test',
      reload: vi.fn(),
    },
  } as Record<string, unknown>;

  vi.stubGlobal('window', windowFixture);
  vi.stubGlobal('document', {
    addEventListener: vi.fn(
      (name: string, listener: (event: EventFixture) => void) => {
        const listeners = documentListeners.get(name) ?? [];
        listeners.push(listener);
        documentListeners.set(name, listeners);
      }
    ),
    body,
    createElement: vi.fn(() => new ElementFixture()),
    createElementNS: vi.fn(() => new ElementFixture()),
    documentElement,
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
  });

  return {
    accountStatusText,
    accountsErrorSidebar,
    accountsListSidebar,
    accountsLoadingSidebar,
    accountsRetrySidebar,
    accountsErrorMobile,
    accountsListMobile,
    accountsLoadingMobile,
    accountsRetryMobile,
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
    mobileUserBtn,
    mobileUserDropdown,
    otherAccountsListSidebar,
    otherAccountsListMobile,
    sidebar,
    sidebarToggle,
    sidebarUserBtn,
    sidebarUserDropdown,
    themeIcon,
    themeToggle,
    triggerDocument: (name: string, event: EventFixture) => {
      documentListeners.get(name)?.forEach(listener => listener(event));
    },
    windowFixture,
  };
}

function createDialog(
  overrides: Partial<AccountLayoutDialog> = {}
): AccountLayoutDialog {
  return {
    showAlert: vi.fn().mockResolvedValue(undefined),
    showConfirm: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function initializeManager(
  managerConfig: AccountLayoutConfig = config,
  dialog: AccountLayoutDialog = createDialog()
): AccountLayoutManager {
  const manager = new AccountLayoutManager(managerConfig, dialog);
  manager.initialize();
  return manager;
}

describe('account layout manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    expect(fetch).toHaveBeenCalledWith('/accounts/sidebar', {
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
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: false }),
    });
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    sidebarToggle.trigger('click');
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[AccountLayout] Failed to update sidebar state'
      );
    });

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
    await vi.waitFor(() => {
      expect(documentElement.classList.contains('dark')).toBe(true);
    });

    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('dark')).toBe(true);
    expect(themeIcon.getAttribute('data-lucide')).toBe('moon');
    expect(createIcons).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('/accounts/theme', {
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
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[AccountLayout] Failed to update theme:',
        failure
      );
    });

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
    await vi.waitFor(() => {
      expect((windowFixture.location as any).reload).toHaveBeenCalledOnce();
    });
    expect(fetch).toHaveBeenCalledWith('/accounts/locale', {
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
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    mobileThemeLangToggle.trigger('click');
    expect(mobileThemeLangDropdown.classList.contains('hidden')).toBe(false);
    darkOption.trigger('click');
    await vi.waitFor(() => {
      expect(documentElement.classList.contains('dark')).toBe(true);
    });

    expect(darkOption.classList.contains('bg-muted')).toBe(true);
    expect(darkOption.classList.contains('border-primary')).toBe(true);
    expect(lightOption.classList.contains('border-transparent')).toBe(true);
  });

  it('loads account choices and falls back to initials for an unsafe avatar URL', async () => {
    const {
      accountStatusText,
      accountsListSidebar,
      body,
      otherAccountsListSidebar,
      sidebar,
      sidebarUserBtn,
      sidebarUserDropdown,
    } = setupDom();
    sidebar.classList.add('sidebar-collapsed');
    sidebarUserDropdown.classList.add('hidden');
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        accounts: [
          {
            displayName: 'Active User',
            email: 'active@example.test',
            id: 'active',
            initials: 'AU',
            isActive: true,
          },
          {
            displayName: 'Backup User',
            email: 'backup@example.test',
            id: 'backup',
            initials: 'BU',
            isActive: false,
            picture: 'javascript:alert(1)',
          },
        ],
        success: true,
      }),
    });
    vi.stubGlobal('fetch', fetch);
    const dialog = createDialog({
      showConfirm: vi.fn().mockResolvedValue(false),
    });
    await initializeManager(config, dialog);

    sidebarUserBtn.trigger('click');
    await vi.waitFor(() => {
      expect(otherAccountsListSidebar.appendChild).toHaveBeenCalledOnce();
    });

    expect(sidebarUserDropdown.classList.contains('hidden')).toBe(false);
    expect(sidebarUserBtn.getAttribute('aria-expanded')).toBe('true');
    expect(sidebarUserDropdown.style.position).toBe('fixed');
    expect(sidebarUserDropdown.style.left).toBe('56px');
    expect(accountsListSidebar.classList.contains('hidden')).toBe(false);
    expect(accountStatusText.textContent).toBe('Switch account');

    const wrapper = otherAccountsListSidebar.appendChild.mock.calls[0]?.[0];
    const avatar = wrapper?.appendChild.mock.calls[0]?.[0];
    const avatarContent = avatar?.appendChild.mock.calls[0]?.[0];
    expect(avatarContent?.textContent).toBe('BU');

    wrapper?.trigger('click', eventFixture(wrapper));
    const switchForm = body.appendChild.mock.calls[0]?.[0];
    expect(switchForm?.action).toBe('/accounts/switch');
    expect(switchForm?.method).toBe('POST');
    expect(switchForm?.appendChild.mock.calls[0]?.[0]).toMatchObject({
      name: '_csrf',
      value: 'csrf-token',
    });
    expect(switchForm?.appendChild.mock.calls[1]?.[0]).toMatchObject({
      name: 'accountId',
      value: 'backup',
    });
    expect(switchForm?.submit).toHaveBeenCalledOnce();

    const removeButton = wrapper?.appendChild.mock.calls[2]?.[0];
    wrapper?.trigger('click', eventFixture(removeButton));
    expect(body.appendChild).toHaveBeenCalledOnce();
    const removeEvent = removeButton?.trigger('click');
    expect(removeEvent?.stopPropagation).toHaveBeenCalledOnce();
  });

  it('loads the mobile account switcher and renders a safe avatar image', async () => {
    const {
      accountsListMobile,
      mobileUserBtn,
      mobileUserDropdown,
      otherAccountsListMobile,
    } = setupDom();
    mobileUserDropdown.classList.add('hidden');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          accounts: [
            {
              displayName: 'Mobile User',
              email: 'mobile@example.test',
              id: 'mobile',
              initials: 'MU',
              isActive: false,
              picture: '/avatar.png',
            },
          ],
          success: true,
        }),
      })
    );
    await initializeManager();

    mobileUserBtn.trigger('click');
    await vi.waitFor(() => {
      expect(otherAccountsListMobile.appendChild).toHaveBeenCalledOnce();
    });

    expect(mobileUserDropdown.classList.contains('hidden')).toBe(false);
    expect(mobileUserBtn.getAttribute('aria-expanded')).toBe('true');
    expect(accountsListMobile.classList.contains('hidden')).toBe(false);
    const wrapper = otherAccountsListMobile.appendChild.mock.calls[0]?.[0];
    const avatar = wrapper?.appendChild.mock.calls[0]?.[0];
    const image = avatar?.appendChild.mock.calls[0]?.[0];
    expect(image?.src).toBe('https://id.example.test/avatar.png');
    expect(wrapper?.className).toContain('min-h-[60px]');
  });

  it('retries both account switchers declaratively without page globals', async () => {
    const {
      accountsListMobile,
      accountsListSidebar,
      accountsRetryMobile,
      accountsRetrySidebar,
      windowFixture,
    } = setupDom();
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ accounts: [], success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    accountsRetrySidebar.trigger('click');
    accountsRetryMobile.trigger('click');

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(accountsListSidebar.classList.contains('hidden')).toBe(false);
      expect(accountsListMobile.classList.contains('hidden')).toBe(false);
    });
    expect(windowFixture.loadSidebarAccountData).toBeUndefined();
    expect(windowFixture.loadMobileAccountData).toBeUndefined();
  });

  it('does not remove an account when confirmation is declined', async () => {
    setupDom();
    const showConfirm = vi.fn().mockResolvedValue(false);
    const dialog = createDialog({ showConfirm });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const manager = await initializeManager(config, dialog);

    await manager.removeAccount('backup');

    expect(showConfirm).toHaveBeenCalledWith(
      'Remove Account',
      'Are you sure you want to remove this account?',
      {
        cancelText: 'Cancel',
        confirmText: 'Remove',
        variant: 'danger',
      }
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes a confirmed account and refreshes both account lists', async () => {
    setupDom();
    const showConfirm = vi.fn().mockResolvedValue(true);
    const dialog = createDialog({ showConfirm });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
      .mockResolvedValue({
        json: vi.fn().mockResolvedValue({ accounts: [], success: true }),
      });
    vi.stubGlobal('fetch', fetch);
    const manager = await initializeManager(config, dialog);

    await manager.removeAccount('backup');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    expect(fetch).toHaveBeenNthCalledWith(1, '/accounts/remove', {
      body: JSON.stringify({ accountId: 'backup' }),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'DELETE',
    });
  });

  it('shows the server error when account removal is rejected', async () => {
    setupDom();
    const showAlert = vi.fn();
    const dialog = createDialog({
      showAlert,
      showConfirm: vi.fn().mockResolvedValue(true),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          error: 'last administrator',
          success: false,
        }),
      })
    );
    const manager = await initializeManager(config, dialog);

    await manager.removeAccount('admin');

    expect(showAlert).toHaveBeenCalledWith(
      'Error',
      'Failed to remove account: last administrator',
      { variant: 'error' }
    );
  });

  it('shows a generic error when account removal fails unexpectedly', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    setupDom();
    const showAlert = vi.fn();
    const dialog = createDialog({
      showAlert,
      showConfirm: vi.fn().mockResolvedValue(true),
    });
    const failure = new Error('network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    const manager = await initializeManager(config, dialog);

    await manager.removeAccount('backup');

    expect(error).toHaveBeenCalledWith(
      '[AccountLayout] Error removing account:',
      failure
    );
    expect(showAlert).toHaveBeenCalledWith(
      'Error',
      'Failed to remove account',
      { variant: 'error' }
    );
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
    await vi.waitFor(() => {
      expect(documentElement.classList.contains('dark')).toBe(false);
    });

    expect(document.body.classList.contains('dark')).toBe(false);
    expect(themeIcon.getAttribute('data-lucide')).toBe('sun');
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
      '[AccountLayout] Failed to update locale:',
      failure
    );
    expect(error).toHaveBeenCalledWith(
      '[AccountLayout] Failed to update theme:',
      failure
    );
  });

  it('loads locale changes from the mobile menu', async () => {
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
    await vi.waitFor(() => {
      expect((windowFixture.location as any).reload).toHaveBeenCalledOnce();
    });
  });

  it('shows account loading errors in both switchers', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const {
      accountsErrorMobile,
      accountsErrorSidebar,
      mobileUserBtn,
      mobileUserDropdown,
      sidebarUserBtn,
      sidebarUserDropdown,
    } = setupDom();
    sidebarUserDropdown.classList.add('hidden');
    mobileUserDropdown.classList.add('hidden');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: false }),
      })
    );
    await initializeManager();

    sidebarUserBtn.trigger('click');
    mobileUserBtn.trigger('click');
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));

    expect(accountsErrorSidebar.classList.contains('hidden')).toBe(false);
    expect(accountsErrorMobile.classList.contains('hidden')).toBe(false);
  });

  it('closes open menus on a second click, outside click, and Escape', async () => {
    const {
      langDropdown,
      langToggle,
      mobileSidebar,
      mobileSidebarOverlay,
      mobileThemeLangDropdown,
      mobileThemeLangToggle,
      mobileUserBtn,
      mobileUserDropdown,
      sidebarUserBtn,
      sidebarUserDropdown,
      triggerDocument,
    } = setupDom();
    langDropdown.classList.add('hidden');
    mobileThemeLangDropdown.classList.add('hidden');
    mobileUserDropdown.classList.add('hidden');
    sidebarUserDropdown.classList.add('hidden');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ accounts: [], success: true }),
      })
    );
    await initializeManager();

    langToggle.trigger('click');
    langToggle.trigger('click');
    mobileThemeLangToggle.trigger('click');
    mobileThemeLangToggle.trigger('click');
    sidebarUserBtn.trigger('click');
    sidebarUserBtn.trigger('click');
    mobileUserBtn.trigger('click');
    mobileUserBtn.trigger('click');
    triggerDocument('click', eventFixture(new ElementFixture()));
    triggerDocument('keydown', {
      key: 'Escape',
      stopPropagation: vi.fn(),
    });

    expect(langDropdown.classList.contains('hidden')).toBe(true);
    expect(mobileThemeLangDropdown.classList.contains('hidden')).toBe(true);
    expect(sidebarUserDropdown.classList.contains('hidden')).toBe(true);
    expect(mobileUserDropdown.classList.contains('hidden')).toBe(true);
    expect(mobileSidebar.classList.contains('-translate-x-full')).toBe(true);
    expect(mobileSidebarOverlay.classList.contains('invisible')).toBe(true);
  });

  it('uses the injected dialog instead of an application-owned global', async () => {
    const { windowFixture } = setupDom();
    const globalShowConfirm = vi.fn().mockResolvedValue(true);
    windowFixture.dialog = { showConfirm: globalShowConfirm };
    const showConfirm = vi.fn().mockResolvedValue(false);
    const dialog = createDialog({ showConfirm });
    vi.stubGlobal('fetch', vi.fn());
    const manager = initializeManager(config, dialog);

    await manager.removeAccount('backup');

    expect(showConfirm).toHaveBeenCalledOnce();
    expect(globalShowConfirm).not.toHaveBeenCalled();
  });

  it('warns when account layout state is absent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setupDom();
    vi.stubGlobal('fetch', vi.fn());

    initializeAccountLayout();

    expect(warn).toHaveBeenCalledWith(
      '[AccountLayout] State element not found'
    );
  });

  it('initializes from embedded account layout state', async () => {
    const { elements, themeIcon } = setupDom();
    const state = new ElementFixture();
    state.textContent = JSON.stringify(config);
    elements.set('___ACCOUNT_LAYOUT_STATE___', state);
    vi.stubGlobal('fetch', vi.fn());
    initializeAccountLayout();

    expect(themeIcon.getAttribute('data-lucide')).toBe('sun');
    expect((window as any).loadSidebarAccountData).toBeUndefined();
    expect((window as any).loadMobileAccountData).toBeUndefined();
  });

  it('contains malformed embedded account layout state', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { elements } = setupDom();
    const state = new ElementFixture();
    state.textContent = '{bad json';
    elements.set('___ACCOUNT_LAYOUT_STATE___', state);
    vi.stubGlobal('fetch', vi.fn());
    expect(initializeAccountLayout).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[AccountLayout] Initialization failed:',
      expect.any(SyntaxError)
    );
  });

  it('skips account loading when optional switcher containers are absent', async () => {
    const {
      elements,
      mobileUserBtn,
      mobileUserDropdown,
      sidebarUserBtn,
      sidebarUserDropdown,
    } = setupDom();
    elements.delete('sidebar');
    elements.delete('accounts-loading-sidebar');
    elements.delete('accounts-loading-mobile');
    sidebarUserDropdown.classList.add('hidden');
    mobileUserDropdown.classList.add('hidden');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    sidebarUserBtn.trigger('click');
    mobileUserBtn.trigger('click');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('initializes with every optional layout control absent', async () => {
    const { elements, triggerDocument } = setupDom();
    elements.clear();
    vi.stubGlobal('fetch', vi.fn());

    expect(initializeManager({ ...config, userTheme: '' })).toBeDefined();
    triggerDocument('keydown', {
      key: 'Escape',
      stopPropagation: vi.fn(),
    });
  });

  it('handles missing paired controls and incomplete sidebar structure', async () => {
    const { elements, mobileMenuButton, mobileSidebarClose, sidebarToggle } =
      setupDom();
    elements.delete('main-content');
    elements.delete('mobile-sidebar-overlay');
    elements.delete('theme-icon');
    elements.delete('lang-dropdown');
    elements.delete('mobile-theme-lang-dropdown');
    elements.delete('sidebar-user-dropdown');
    elements.delete('mobile-user-dropdown');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    expect(() => sidebarToggle.trigger('click')).not.toThrow();
    expect(() => mobileMenuButton.trigger('click')).not.toThrow();
    expect(() => mobileSidebarClose.trigger('click')).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads safely when optional account result lists are absent', async () => {
    const { accountsRetryMobile, accountsRetrySidebar, elements } = setupDom();
    elements.delete('other-accounts-list-sidebar');
    elements.delete('other-accounts-list-mobile');
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        accounts: [],
        success: true,
      }),
    });
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    accountsRetrySidebar.trigger('click');
    accountsRetryMobile.trigger('click');

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('uses initials without an account status element and handles malformed avatars', async () => {
    const { accountsRetrySidebar, elements, otherAccountsListSidebar } =
      setupDom();
    elements.delete('account-status-text');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          accounts: [
            {
              displayName: 'No Picture',
              email: 'none@example.test',
              id: 'none',
              initials: 'NP',
              isActive: false,
            },
            {
              displayName: 'Malformed Picture',
              email: 'bad@example.test',
              id: 'bad',
              initials: 'MP',
              isActive: false,
              picture: 'http://[',
            },
          ],
          success: true,
        }),
      })
    );
    await initializeManager();

    accountsRetrySidebar.trigger('click');

    await vi.waitFor(() => {
      expect(otherAccountsListSidebar.appendChild).toHaveBeenCalledTimes(2);
    });
    for (const [wrapper] of otherAccountsListSidebar.appendChild.mock.calls) {
      const avatar = wrapper.appendChild.mock.calls[0]?.[0];
      expect(avatar?.appendChild.mock.calls[0]?.[0].textContent).not.toBe('');
    }
  });

  it('uses the unknown-error fallback for rejected account removal', async () => {
    setupDom();
    const showAlert = vi.fn();
    const dialog = createDialog({
      showAlert,
      showConfirm: vi.fn().mockResolvedValue(true),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: false }),
      })
    );
    const manager = await initializeManager(config, dialog);

    await manager.removeAccount('backup');

    expect(showAlert).toHaveBeenCalledWith(
      'Error',
      'Failed to remove account: Unknown error',
      { variant: 'error' }
    );
  });

  it('ignores non-Escape keyboard input', async () => {
    const { mobileSidebar, triggerDocument } = setupDom();
    vi.stubGlobal('fetch', vi.fn());
    await initializeManager();

    triggerDocument('keydown', { key: 'Enter', stopPropagation: vi.fn() });

    expect(mobileSidebar.classList.add).not.toHaveBeenCalledWith(
      '-translate-x-full'
    );
  });

  it('uses safe defaults for empty embedded account layout state', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { elements, themeIcon } = setupDom();
    const state = new ElementFixture();
    elements.set('___ACCOUNT_LAYOUT_STATE___', state);
    vi.stubGlobal('fetch', vi.fn());
    expect(initializeAccountLayout).not.toThrow();
    expect(error).not.toHaveBeenCalled();
    expect(themeIcon.getAttribute('data-lucide')).toBe('sun');
  });

  it('does not expose the class through an application-owned global', () => {
    const { windowFixture } = setupDom();

    expect(windowFixture.AccountLayoutManagerClass).toBeUndefined();
  });

  it('updates the sidebar without optional logos or logo sources', async () => {
    const first = setupDom();
    first.elements.delete('sidebar-logo-light');
    first.elements.delete('sidebar-logo-dark');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
    );
    await initializeManager();
    first.sidebarToggle.trigger('click');

    const second = setupDom();
    delete second.lightLogo.dataset.rect;
    delete second.darkLogo.dataset.rect;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
    );
    await initializeManager();
    second.sidebarToggle.trigger('click');

    expect(second.lightLogo.src).toBe('');
    expect(second.darkLogo.src).toBe('');
  });

  it('ignores rejected updates and options without values', async () => {
    const language = new ElementFixture();
    language.setAttribute('data-locale', 'fr');
    const languageWithoutValue = new ElementFixture();
    const mobileTheme = new ElementFixture();
    mobileTheme.setAttribute('data-theme', 'dark');
    const mobileThemeWithoutValue = new ElementFixture();
    const mobileLocale = new ElementFixture();
    mobileLocale.setAttribute('data-locale', 'fr');
    const mobileLocaleWithoutValue = new ElementFixture();
    const {
      documentElement,
      langDropdown,
      langToggle,
      mobileThemeLangDropdown,
      mobileThemeLangToggle,
      mobileUserBtn,
      sidebarUserBtn,
      themeToggle,
      triggerDocument,
      windowFixture,
    } = setupDom();
    langDropdown.setQueryResults('.locale-option', [
      language,
      languageWithoutValue,
    ]);
    mobileThemeLangDropdown.setQueryResults('.mobile-theme-option', [
      mobileTheme,
      mobileThemeWithoutValue,
    ]);
    mobileThemeLangDropdown.setQueryResults('.mobile-locale-option', [
      mobileLocale,
      mobileLocaleWithoutValue,
    ]);
    const fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: false }),
    });
    vi.stubGlobal('fetch', fetch);
    await initializeManager();

    themeToggle.trigger('click');
    language.trigger('click');
    languageWithoutValue.trigger('click');
    mobileTheme.trigger('click');
    mobileThemeWithoutValue.trigger('click');
    mobileLocale.trigger('click');
    mobileLocaleWithoutValue.trigger('click');
    triggerDocument('click', eventFixture(langToggle));
    triggerDocument('click', eventFixture(mobileThemeLangToggle));
    triggerDocument('click', eventFixture(sidebarUserBtn));
    triggerDocument('click', eventFixture(mobileUserBtn));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));

    expect(documentElement.classList.contains('dark')).toBe(false);
    expect((windowFixture.location as any).reload).not.toHaveBeenCalled();
  });

  it('handles a mobile theme option removed while persistence is pending', async () => {
    const darkOption = new ElementFixture();
    darkOption.setAttribute('data-theme', 'dark');
    const { documentElement, mobileThemeLangDropdown } = setupDom();
    mobileThemeLangDropdown.setQueryResults('.mobile-theme-option', [
      darkOption,
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      })
    );
    await initializeManager();

    darkOption.trigger('click');
    darkOption.setAttribute('data-theme', 'light');
    await vi.waitFor(() => {
      expect(documentElement.classList.contains('dark')).toBe(true);
    });

    expect(darkOption.classList.contains('bg-muted')).toBe(false);
  });
});
