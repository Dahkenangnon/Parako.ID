/**
 * Account Layout Manager
 *
 * Handles account panel layout functionality:
 * - Collapsible sidebar with server persistence
 * - Mobile sidebar navigation
 * - Theme toggle (light/dark)
 * - Locale/language switching
 * - Multi-account switcher (load, switch, remove accounts)
 */
(function () {
  'use strict';

  // Type Definitions

  interface AccountLayoutConfig {
    csrfToken: string;
    userTheme: 'light' | 'dark';
    routes: {
      updateSidebar: string;
      updateTheme: string;
      updateLocale: string;
      accountSwitcherData: string;
      switchAccount: string;
      removeAccount: string;
    };
    translations: AccountLayoutTranslations;
  }

  interface AccountLayoutTranslations {
    switchAccount: string;
    noOtherAccounts: string;
    removeAccountTitle: string;
    removeAccountMessage: string;
    removeAccountConfirm: string;
    removeAccountCancel: string;
    errorTitle: string;
    errorRemoveAccount: string;
    unknownError: string;
  }

  interface AccountData {
    id: string;
    displayName: string;
    email: string;
    picture?: string;
    initials: string;
    isActive: boolean;
  }

  // Account Layout Manager Class

  class AccountLayoutManager {
    private config: AccountLayoutConfig;
    private translations: AccountLayoutTranslations;
    private currentTheme: 'light' | 'dark';

    private readonly defaultTranslations: AccountLayoutTranslations = {
      switchAccount: 'Switch account',
      noOtherAccounts: 'No other accounts',
      removeAccountTitle: 'Remove Account',
      removeAccountMessage: 'Are you sure you want to remove this account?',
      removeAccountConfirm: 'Remove',
      removeAccountCancel: 'Cancel',
      errorTitle: 'Error',
      errorRemoveAccount: 'Failed to remove account',
      unknownError: 'Unknown error',
    };

    // DOM Elements - Sidebar
    private sidebar: HTMLElement | null = null;
    private mainContent: HTMLElement | null = null;
    private sidebarToggle: HTMLElement | null = null;
    private sidebarLogoLight: HTMLImageElement | null = null;
    private sidebarLogoDark: HTMLImageElement | null = null;

    // DOM Elements - Mobile
    private mobileMenuButton: HTMLElement | null = null;
    private mobileSidebar: HTMLElement | null = null;
    private mobileSidebarOverlay: HTMLElement | null = null;
    private mobileSidebarClose: HTMLElement | null = null;

    // DOM Elements - Theme
    private themeToggle: HTMLElement | null = null;
    private themeIcon: HTMLElement | null = null;
    private mobileThemeLangToggle: HTMLElement | null = null;
    private mobileThemeLangDropdown: HTMLElement | null = null;

    // DOM Elements - Language
    private langToggle: HTMLElement | null = null;
    private langDropdown: HTMLElement | null = null;

    // DOM Elements - Account Switcher (Sidebar)
    private sidebarUserBtn: HTMLElement | null = null;
    private sidebarUserDropdown: HTMLElement | null = null;
    private accountsLoadingSidebar: HTMLElement | null = null;
    private accountsListSidebar: HTMLElement | null = null;
    private accountsErrorSidebar: HTMLElement | null = null;
    private otherAccountsListSidebar: HTMLElement | null = null;
    private accountStatusText: HTMLElement | null = null;

    // DOM Elements - Account Switcher (Mobile)
    private mobileUserBtn: HTMLElement | null = null;
    private mobileUserDropdown: HTMLElement | null = null;
    private accountsLoadingMobile: HTMLElement | null = null;
    private accountsListMobile: HTMLElement | null = null;
    private accountsErrorMobile: HTMLElement | null = null;
    private otherAccountsListMobile: HTMLElement | null = null;

    constructor(config: AccountLayoutConfig) {
      this.config = config;
      this.currentTheme = config.userTheme || 'light';
      this.translations = {
        ...this.defaultTranslations,
        ...config.translations,
      };
    }

    /**
     * Initialize the layout manager
     */
    public initialize(): void {
      this.cacheElements();
      this.setupSidebarToggle();
      this.setupMobileSidebar();
      this.setupThemeToggle();
      this.setupLanguageToggle();
      this.setupMobileThemeLanguage();
      this.setupAccountSwitcher();
      this.setupMobileAccountSwitcher();
      this.setupKeyboardShortcuts();
      this.exposeGlobalMethods();
    }

    /**
     * Cache DOM element references
     */
    private cacheElements(): void {
      this.sidebar = document.getElementById('sidebar');
      this.mainContent = document.getElementById('main-content');
      this.sidebarToggle = document.getElementById('sidebar-toggle');
      this.sidebarLogoLight = document.getElementById(
        'sidebar-logo-light'
      ) as HTMLImageElement | null;
      this.sidebarLogoDark = document.getElementById(
        'sidebar-logo-dark'
      ) as HTMLImageElement | null;

      this.mobileMenuButton = document.getElementById('mobile-menu-button');
      this.mobileSidebar = document.getElementById('mobile-sidebar');
      this.mobileSidebarOverlay = document.getElementById(
        'mobile-sidebar-overlay'
      );
      this.mobileSidebarClose = document.getElementById('mobile-sidebar-close');

      this.themeToggle = document.getElementById('theme-toggle');
      this.themeIcon = document.getElementById('theme-icon');
      this.mobileThemeLangToggle = document.getElementById(
        'mobile-theme-lang-toggle'
      );
      this.mobileThemeLangDropdown = document.getElementById(
        'mobile-theme-lang-dropdown'
      );

      this.langToggle = document.getElementById('lang-toggle');
      this.langDropdown = document.getElementById('lang-dropdown');

      // Account Switcher (Sidebar)
      this.sidebarUserBtn = document.getElementById('sidebar-user-btn');
      this.sidebarUserDropdown = document.getElementById(
        'sidebar-user-dropdown'
      );
      this.accountsLoadingSidebar = document.getElementById(
        'accounts-loading-sidebar'
      );
      this.accountsListSidebar = document.getElementById(
        'accounts-list-sidebar'
      );
      this.accountsErrorSidebar = document.getElementById(
        'accounts-error-sidebar'
      );
      this.otherAccountsListSidebar = document.getElementById(
        'other-accounts-list-sidebar'
      );
      this.accountStatusText = document.getElementById('account-status-text');

      // Account Switcher (Mobile)
      this.mobileUserBtn = document.getElementById('mobile-user-btn');
      this.mobileUserDropdown = document.getElementById('mobile-user-dropdown');
      this.accountsLoadingMobile = document.getElementById(
        'accounts-loading-mobile'
      );
      this.accountsListMobile = document.getElementById('accounts-list-mobile');
      this.accountsErrorMobile = document.getElementById(
        'accounts-error-mobile'
      );
      this.otherAccountsListMobile = document.getElementById(
        'other-accounts-list-mobile'
      );
    }

    // Sidebar Toggle

    private setupSidebarToggle(): void {
      if (this.sidebarToggle) {
        this.sidebarToggle.addEventListener('click', () =>
          this.toggleSidebar()
        );
      }
    }

    private toggleSidebar(): void {
      if (!this.sidebar || !this.mainContent) return;

      const isExpanded = this.sidebar.classList.contains('sidebar-expanded');
      const newState = !isExpanded;

      // Optimistically update UI
      this.updateSidebarUI(newState);

      this.persistSidebarState(newState).catch(() => {
        this.updateSidebarUI(!newState);
        console.error('[AccountLayout] Failed to update sidebar state');
      });
    }

    private updateSidebarUI(expanded: boolean): void {
      if (!this.sidebar || !this.mainContent) return;

      if (expanded) {
        this.sidebar.classList.remove('sidebar-collapsed');
        this.sidebar.classList.add('sidebar-expanded');
        this.mainContent.classList.remove('main-content-collapsed');
        this.mainContent.classList.add('main-content-expanded');
      } else {
        this.sidebar.classList.remove('sidebar-expanded');
        this.sidebar.classList.add('sidebar-collapsed');
        this.mainContent.classList.remove('main-content-expanded');
        this.mainContent.classList.add('main-content-collapsed');
      }

      this.updateSidebarLogos(expanded);
    }

    private updateSidebarLogos(expanded: boolean): void {
      if (this.sidebarLogoLight) {
        const src = expanded
          ? this.sidebarLogoLight.dataset.rect
          : this.sidebarLogoLight.dataset.icon;
        if (src) this.sidebarLogoLight.src = src;
      }
      if (this.sidebarLogoDark) {
        const src = expanded
          ? this.sidebarLogoDark.dataset.rect
          : this.sidebarLogoDark.dataset.icon;
        if (src) this.sidebarLogoDark.src = src;
      }
    }

    private async persistSidebarState(expanded: boolean): Promise<void> {
      const response = await fetch(this.config.routes.updateSidebar, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.config.csrfToken,
        },
        body: JSON.stringify({ expanded }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error('Server rejected sidebar state update');
      }
    }

    // Mobile Sidebar

    private setupMobileSidebar(): void {
      if (this.mobileMenuButton) {
        this.mobileMenuButton.addEventListener('click', () =>
          this.openMobileSidebar()
        );
      }

      if (this.mobileSidebarClose) {
        this.mobileSidebarClose.addEventListener('click', () =>
          this.closeMobileSidebar()
        );
      }

      if (this.mobileSidebarOverlay) {
        this.mobileSidebarOverlay.addEventListener('click', () =>
          this.closeMobileSidebar()
        );
      }
    }

    private openMobileSidebar(): void {
      if (this.mobileSidebar && this.mobileSidebarOverlay) {
        this.mobileSidebar.classList.remove('-translate-x-full');
        this.mobileSidebar.classList.add('translate-x-0');
        this.mobileSidebarOverlay.classList.remove('opacity-0', 'invisible');
        this.mobileSidebarOverlay.classList.add('opacity-100', 'visible');
      }
    }

    private closeMobileSidebar(): void {
      if (this.mobileSidebar && this.mobileSidebarOverlay) {
        this.mobileSidebar.classList.remove('translate-x-0');
        this.mobileSidebar.classList.add('-translate-x-full');
        this.mobileSidebarOverlay.classList.remove('opacity-100', 'visible');
        this.mobileSidebarOverlay.classList.add('opacity-0', 'invisible');
      }
    }

    // Theme Toggle

    private setupThemeToggle(): void {
      if (!this.themeToggle || !this.themeIcon) return;

      this.updateThemeIcon();

      this.themeToggle.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleTheme();
      });
    }

    private updateThemeIcon(): void {
      if (this.themeIcon) {
        this.themeIcon.setAttribute(
          'data-lucide',
          this.currentTheme === 'dark' ? 'moon' : 'sun'
        );
        this.refreshLucideIcons();
      }
    }

    private async toggleTheme(): Promise<void> {
      const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';

      try {
        const response = await fetch(this.config.routes.updateTheme, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
          body: JSON.stringify({ theme: newTheme }),
        });

        const data = await response.json();
        if (data.success) {
          this.currentTheme = newTheme;
          this.applyTheme(newTheme);
          this.updateThemeIcon();
        }
      } catch (error) {
        console.error('[AccountLayout] Failed to update theme:', error);
      }
    }

    private applyTheme(theme: 'light' | 'dark'): void {
      const html = document.documentElement;
      const body = document.body;

      if (theme === 'dark') {
        html.classList.add('dark');
        body.classList.add('dark');
      } else {
        html.classList.remove('dark');
        body.classList.remove('dark');
      }
    }

    // Language Toggle

    private setupLanguageToggle(): void {
      if (!this.langToggle || !this.langDropdown) return;

      this.langToggle.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleDropdown(this.langDropdown!, this.langToggle!);
      });

      document.addEventListener('click', e => {
        if (
          !this.langToggle?.contains(e.target as Node) &&
          !this.langDropdown?.contains(e.target as Node)
        ) {
          this.closeDropdown(this.langDropdown!, this.langToggle!);
        }
      });

      const localeOptions =
        this.langDropdown.querySelectorAll<HTMLElement>('.locale-option');
      localeOptions.forEach(option => {
        option.addEventListener('click', () => {
          const newLocale = option.getAttribute('data-locale');
          if (newLocale) this.changeLocale(newLocale);
        });
      });
    }

    private async changeLocale(locale: string): Promise<void> {
      try {
        const response = await fetch(this.config.routes.updateLocale, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
          body: JSON.stringify({ locale }),
        });

        const data = await response.json();
        if (data.success) {
          window.location.reload();
        }
      } catch (error) {
        console.error('[AccountLayout] Failed to update locale:', error);
      }
    }

    // Mobile Theme/Language Toggle

    private setupMobileThemeLanguage(): void {
      if (!this.mobileThemeLangToggle || !this.mobileThemeLangDropdown) return;

      this.mobileThemeLangToggle.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleDropdown(
          this.mobileThemeLangDropdown!,
          this.mobileThemeLangToggle!
        );
      });

      document.addEventListener('click', e => {
        if (
          !this.mobileThemeLangToggle?.contains(e.target as Node) &&
          !this.mobileThemeLangDropdown?.contains(e.target as Node)
        ) {
          this.closeDropdown(
            this.mobileThemeLangDropdown!,
            this.mobileThemeLangToggle!
          );
        }
      });

      const themeOptions =
        this.mobileThemeLangDropdown.querySelectorAll<HTMLElement>(
          '.mobile-theme-option'
        );
      themeOptions.forEach(option => {
        option.addEventListener('click', () => {
          const newTheme = option.getAttribute('data-theme') as
            | 'light'
            | 'dark';
          if (newTheme) this.handleMobileThemeChange(newTheme, themeOptions);
        });
      });

      const localeOptions =
        this.mobileThemeLangDropdown.querySelectorAll<HTMLElement>(
          '.mobile-locale-option'
        );
      localeOptions.forEach(option => {
        option.addEventListener('click', () => {
          const newLocale = option.getAttribute('data-locale');
          if (newLocale) this.changeLocale(newLocale);
        });
      });
    }

    private async handleMobileThemeChange(
      newTheme: 'light' | 'dark',
      themeOptions: NodeListOf<HTMLElement>
    ): Promise<void> {
      try {
        const response = await fetch(this.config.routes.updateTheme, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
          body: JSON.stringify({ theme: newTheme }),
        });

        const data = await response.json();
        if (data.success) {
          this.currentTheme = newTheme;

          themeOptions.forEach(opt => {
            opt.classList.remove('bg-muted', 'border-primary');
            opt.classList.add('border-transparent');
          });

          const selectedOption = Array.from(themeOptions).find(
            opt => opt.getAttribute('data-theme') === newTheme
          );
          if (selectedOption) {
            selectedOption.classList.add('bg-muted', 'border-primary');
            selectedOption.classList.remove('border-transparent');
          }

          this.applyTheme(newTheme);
        }
      } catch (error) {
        console.error('[AccountLayout] Failed to update theme:', error);
      }
    }

    // Account Switcher (Sidebar)

    private setupAccountSwitcher(): void {
      if (!this.sidebarUserBtn || !this.sidebarUserDropdown) return;

      this.sidebarUserBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isHidden = this.sidebarUserDropdown!.classList.contains('hidden');

        if (isHidden) {
          this.positionSidebarDropdown();
          this.sidebarUserDropdown!.classList.remove('hidden');
          this.sidebarUserBtn!.setAttribute('aria-expanded', 'true');
          this.loadSidebarAccountData();
        } else {
          this.sidebarUserDropdown!.classList.add('hidden');
          this.sidebarUserBtn!.setAttribute('aria-expanded', 'false');
        }
      });

      document.addEventListener('click', e => {
        if (
          !this.sidebarUserBtn?.contains(e.target as Node) &&
          !this.sidebarUserDropdown?.contains(e.target as Node)
        ) {
          this.closeSidebarDropdown();
        }
      });
    }

    private positionSidebarDropdown(): void {
      if (!this.sidebarUserBtn || !this.sidebarUserDropdown || !this.sidebar)
        return;

      const isCollapsed = this.sidebar.classList.contains('sidebar-collapsed');

      if (isCollapsed) {
        const btnRect = this.sidebarUserBtn.getBoundingClientRect();
        this.sidebarUserDropdown.style.position = 'fixed';
        this.sidebarUserDropdown.style.left = '56px';
        this.sidebarUserDropdown.style.bottom = `${window.innerHeight - btnRect.top}px`;
        this.sidebarUserDropdown.style.top = 'auto';
      } else {
        this.sidebarUserDropdown.style.position = '';
        this.sidebarUserDropdown.style.left = '';
        this.sidebarUserDropdown.style.bottom = '';
        this.sidebarUserDropdown.style.top = '';
      }
    }

    private closeSidebarDropdown(): void {
      if (this.sidebarUserDropdown && this.sidebarUserBtn) {
        this.sidebarUserDropdown.classList.add('hidden');
        this.sidebarUserBtn.setAttribute('aria-expanded', 'false');
      }
    }

    private async loadSidebarAccountData(): Promise<void> {
      if (
        !this.accountsLoadingSidebar ||
        !this.accountsListSidebar ||
        !this.accountsErrorSidebar
      ) {
        return;
      }

      this.accountsLoadingSidebar.classList.remove('hidden');
      this.accountsListSidebar.classList.add('hidden');
      this.accountsErrorSidebar.classList.add('hidden');

      try {
        const response = await fetch(this.config.routes.accountSwitcherData);
        const data = await response.json();

        if (data.success) {
          this.populateSidebarAccounts(data.accounts);
          this.accountsLoadingSidebar.classList.add('hidden');
          this.accountsListSidebar.classList.remove('hidden');
        } else {
          throw new Error(data.error || 'Failed to load accounts');
        }
      } catch (error) {
        console.error('[AccountLayout] Error loading accounts:', error);
        this.accountsLoadingSidebar.classList.add('hidden');
        this.accountsErrorSidebar.classList.remove('hidden');
      }
    }

    private populateSidebarAccounts(accounts: AccountData[]): void {
      if (!this.otherAccountsListSidebar) return;

      this.otherAccountsListSidebar.innerHTML = '';

      const otherAccounts = accounts.filter(acc => !acc.isActive);

      if (this.accountStatusText) {
        this.accountStatusText.textContent = this.translations.switchAccount;
      }

      if (otherAccounts.length > 0) {
        otherAccounts.forEach(account => {
          const accountEl = this.createAccountElement(account, 'sidebar');
          this.otherAccountsListSidebar!.appendChild(accountEl);
        });
      } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.className =
          'px-3 py-4 text-center text-xs text-muted-foreground';
        emptyMsg.textContent = this.translations.noOtherAccounts;
        this.otherAccountsListSidebar.textContent = '';
        this.otherAccountsListSidebar.appendChild(emptyMsg);
      }
    }

    /**
     * Build account element safely using DOM APIs (no innerHTML with server data).
     * variant: 'sidebar' uses compact sizing, 'mobile' uses touch-friendly sizing.
     */
    private createAccountElement(
      account: AccountData,
      variant: 'sidebar' | 'mobile'
    ): HTMLElement {
      const isMobile = variant === 'mobile';
      const avatarSize = isMobile ? 'h-10 w-10' : 'h-8 w-8';
      const padding = isMobile ? 'p-3' : 'p-2';
      const margin = isMobile ? 'mr-3' : 'mr-2';
      const minHeight = isMobile ? ' min-h-[60px]' : '';
      const removeBtnClasses = isMobile
        ? 'p-2 hover:bg-muted text-muted-foreground hover:text-destructive flex-shrink-0 border border-transparent min-h-[44px] min-w-[44px] flex items-center justify-center'
        : 'p-1 hover:bg-muted text-muted-foreground hover:text-destructive flex-shrink-0 border border-transparent';
      const svgSize = isMobile ? 'w-5 h-5' : 'w-4 h-4';

      const wrapper = document.createElement('div');
      wrapper.className = `flex items-center ${padding} hover:bg-muted cursor-pointer w-full border-2 border-transparent hover:border-border${minHeight}`;
      wrapper.dataset.accountId = account.id;
      wrapper.addEventListener('click', e => {
        if (!(e.target as HTMLElement).closest('button')) {
          this.switchToAccount(account.id);
        }
      });

      const avatarContainer = document.createElement('div');
      avatarContainer.className = `bg-muted ${avatarSize} rounded-full flex items-center justify-center border border-border ${margin} flex-shrink-0`;

      if (account.picture) {
        const img = document.createElement('img');
        // Only allow safe URL protocols for avatar
        try {
          const url = new URL(account.picture, window.location.origin);
          if (url.protocol === 'https:' || url.protocol === 'http:') {
            img.src = url.href;
          }
        } catch {
          // Invalid URL — skip avatar image
        }
        img.alt = '';
        img.className = `${avatarSize} rounded-full object-cover`;
        avatarContainer.appendChild(img);
      } else {
        const initials = document.createElement('span');
        initials.className = 'text-primary text-sm';
        initials.textContent = account.initials;
        avatarContainer.appendChild(initials);
      }

      const infoCol = document.createElement('div');
      infoCol.className = 'flex-1 min-w-0';
      const nameEl = document.createElement('p');
      nameEl.className = 'text-sm text-foreground truncate';
      nameEl.textContent = account.displayName;
      const emailEl = document.createElement('p');
      emailEl.className = 'text-xs font-mono text-muted-foreground truncate';
      emailEl.textContent = account.email;
      infoCol.appendChild(nameEl);
      infoCol.appendChild(emailEl);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = removeBtnClasses;
      removeBtn.title = 'Remove account';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.removeAccount(account.id);
      });
      // SVG icon via namespace (safe — no server data)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', svgSize);
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML =
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="23" x2="17" y1="11" y2="11"></line>';
      removeBtn.appendChild(svg);

      wrapper.appendChild(avatarContainer);
      wrapper.appendChild(infoCol);
      wrapper.appendChild(removeBtn);
      return wrapper;
    }

    // Account Switcher (Mobile)

    private setupMobileAccountSwitcher(): void {
      if (!this.mobileUserBtn || !this.mobileUserDropdown) return;

      this.mobileUserBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isHidden = this.mobileUserDropdown!.classList.contains('hidden');

        if (isHidden) {
          this.mobileUserDropdown!.classList.remove('hidden');
          this.mobileUserBtn!.setAttribute('aria-expanded', 'true');
          this.loadMobileAccountData();
        } else {
          this.mobileUserDropdown!.classList.add('hidden');
          this.mobileUserBtn!.setAttribute('aria-expanded', 'false');
        }
      });

      document.addEventListener('click', e => {
        if (
          !this.mobileUserBtn?.contains(e.target as Node) &&
          !this.mobileUserDropdown?.contains(e.target as Node)
        ) {
          this.closeMobileAccountDropdown();
        }
      });
    }

    private closeMobileAccountDropdown(): void {
      if (this.mobileUserDropdown && this.mobileUserBtn) {
        this.mobileUserDropdown.classList.add('hidden');
        this.mobileUserBtn.setAttribute('aria-expanded', 'false');
      }
    }

    private async loadMobileAccountData(): Promise<void> {
      if (
        !this.accountsLoadingMobile ||
        !this.accountsListMobile ||
        !this.accountsErrorMobile
      ) {
        return;
      }

      this.accountsLoadingMobile.classList.remove('hidden');
      this.accountsListMobile.classList.add('hidden');
      this.accountsErrorMobile.classList.add('hidden');

      try {
        const response = await fetch(this.config.routes.accountSwitcherData);
        const data = await response.json();

        if (data.success) {
          this.populateMobileAccounts(data.accounts);
          this.accountsLoadingMobile.classList.add('hidden');
          this.accountsListMobile.classList.remove('hidden');
        } else {
          throw new Error(data.error || 'Failed to load accounts');
        }
      } catch (error) {
        console.error('[AccountLayout] Error loading accounts:', error);
        this.accountsLoadingMobile.classList.add('hidden');
        this.accountsErrorMobile.classList.remove('hidden');
      }
    }

    private populateMobileAccounts(accounts: AccountData[]): void {
      if (!this.otherAccountsListMobile) return;

      this.otherAccountsListMobile.innerHTML = '';

      const otherAccounts = accounts.filter(acc => !acc.isActive);

      if (otherAccounts.length > 0) {
        otherAccounts.forEach(account => {
          const accountEl = this.createAccountElement(account, 'mobile');
          this.otherAccountsListMobile!.appendChild(accountEl);
        });
      } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.className =
          'px-3 py-4 text-center text-xs text-muted-foreground';
        emptyMsg.textContent = this.translations.noOtherAccounts;
        this.otherAccountsListMobile.textContent = '';
        this.otherAccountsListMobile.appendChild(emptyMsg);
      }
    }

    // Account Actions

    private switchToAccount(accountId: string): void {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = this.config.routes.switchAccount;
      form.style.display = 'none';

      const csrfInput = document.createElement('input');
      csrfInput.type = 'hidden';
      csrfInput.name = '_csrf';
      csrfInput.value = this.config.csrfToken;

      const accountInput = document.createElement('input');
      accountInput.type = 'hidden';
      accountInput.name = 'accountId';
      accountInput.value = accountId;

      form.appendChild(csrfInput);
      form.appendChild(accountInput);
      document.body.appendChild(form);
      form.submit();
    }

    public async removeAccount(accountId: string): Promise<void> {
      const dialog = (window as any).dialog;
      if (!dialog?.showConfirm) {
        console.error('[AccountLayout] Dialog utility not available');
        return;
      }

      const confirmed = await dialog.showConfirm(
        this.translations.removeAccountTitle,
        this.translations.removeAccountMessage,
        {
          variant: 'danger',
          confirmText: this.translations.removeAccountConfirm,
          cancelText: this.translations.removeAccountCancel,
        }
      );

      if (!confirmed) return;

      try {
        const response = await fetch(this.config.routes.removeAccount, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
          body: JSON.stringify({ accountId }),
        });

        const data = await response.json();

        if (data.success) {
          this.loadSidebarAccountData();
          this.loadMobileAccountData();
        } else {
          await dialog.showAlert(
            this.translations.errorTitle,
            `${this.translations.errorRemoveAccount}: ${data.error || this.translations.unknownError}`,
            { variant: 'error' }
          );
        }
      } catch (error) {
        console.error('[AccountLayout] Error removing account:', error);
        await dialog.showAlert(
          this.translations.errorTitle,
          this.translations.errorRemoveAccount,
          {
            variant: 'error',
          }
        );
      }
    }

    // Keyboard Shortcuts

    private setupKeyboardShortcuts(): void {
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          this.closeMobileSidebar();
          this.closeSidebarDropdown();
          this.closeMobileAccountDropdown();
          if (this.langDropdown)
            this.closeDropdown(this.langDropdown, this.langToggle!);
          if (this.mobileThemeLangDropdown) {
            this.closeDropdown(
              this.mobileThemeLangDropdown,
              this.mobileThemeLangToggle!
            );
          }
        }
      });
    }

    // Helper Methods

    private toggleDropdown(dropdown: HTMLElement, toggle: HTMLElement): void {
      const isHidden = dropdown.classList.contains('hidden');
      if (isHidden) {
        dropdown.classList.remove('hidden');
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        dropdown.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
      }
    }

    private closeDropdown(dropdown: HTMLElement, toggle: HTMLElement): void {
      dropdown.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    }

    private refreshLucideIcons(): void {
      if (typeof (window as any).lucide?.createIcons === 'function') {
        (window as any).lucide.createIcons();
      }
    }

    /**
     * Expose reload methods globally for retry buttons in server-rendered templates.
     * Note: removeAccount is no longer global — it's wired via addEventListener
     * in createAccountElement() to prevent XSS via inline onclick handlers.
     */
    private exposeGlobalMethods(): void {
      (window as any).loadSidebarAccountData =
        this.loadSidebarAccountData.bind(this);
      (window as any).loadMobileAccountData =
        this.loadMobileAccountData.bind(this);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById('___ACCOUNT_LAYOUT_STATE___');
    if (!stateElement) {
      console.warn('[AccountLayout] State element not found');
      return;
    }

    try {
      const config = JSON.parse(
        stateElement.textContent || '{}'
      ) as AccountLayoutConfig;
      const manager = new AccountLayoutManager(config);
      manager.initialize();
    } catch (error) {
      console.error('[AccountLayout] Initialization failed:', error);
    }
  });

  if (typeof window !== 'undefined') {
    (window as any).AccountLayoutManagerClass = AccountLayoutManager;
  }
})();
