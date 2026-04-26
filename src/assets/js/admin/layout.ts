/**
 * Admin Layout Manager
 *
 * Handles admin panel layout functionality:
 * - Collapsible sidebar with server persistence
 * - Mobile sidebar navigation
 * - Theme toggle (light/dark)
 * - Locale/language switching
 */
(function () {
  'use strict';

  // Type Definitions

  interface AdminLayoutConfig {
    csrfToken: string;
    userTheme: 'light' | 'dark';
    routes: {
      updateSidebar: string;
      updateTheme: string;
      updateLocale: string;
    };
  }

  // Admin Layout Manager Class

  class AdminLayoutManager {
    private config: AdminLayoutConfig;
    private currentTheme: 'light' | 'dark';

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

    constructor(config: AdminLayoutConfig) {
      this.config = config;
      this.currentTheme = config.userTheme || 'light';
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
      this.setupKeyboardShortcuts();
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
        console.error('[AdminLayout] Failed to update sidebar state');
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
        console.error('[AdminLayout] Failed to update theme:', error);
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
        console.error('[AdminLayout] Failed to update locale:', error);
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
        console.error('[AdminLayout] Failed to update theme:', error);
      }
    }

    // Keyboard Shortcuts

    private setupKeyboardShortcuts(): void {
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          this.closeMobileSidebar();
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
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById('___ADMIN_LAYOUT_STATE___');
    if (!stateElement) {
      console.warn('[AdminLayout] State element not found');
      return;
    }

    try {
      const config = JSON.parse(
        stateElement.textContent || '{}'
      ) as AdminLayoutConfig;
      const manager = new AdminLayoutManager(config);
      manager.initialize();
    } catch (error) {
      console.error('[AdminLayout] Initialization failed:', error);
    }
  });

  if (typeof window !== 'undefined') {
    (window as any).AdminLayoutManager = AdminLayoutManager;
  }
})();
