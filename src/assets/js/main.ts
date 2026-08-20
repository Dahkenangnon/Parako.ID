interface MainManagerOptions {
  debug?: boolean;
  theme?: string;
  environment?: string;
}

interface MainConfiguration {
  theme: string;
  environment: string;
  debug: boolean;
  csrfToken?: string;
  locale?: string;
  availableLocales?: string[];
  routes?: {
    updateTheme?: string;
    updateLocale?: string;
    updateTimezone?: string;
  };
}

interface ThemeUpdateResponse {
  success: boolean;
  error?: string;
}

export class MainManager {
  private debug: boolean;
  private theme: string;
  private environment: string;
  private currentTheme: string;
  private csrfToken: string | null;
  private updateThemeUrl: string | null;
  private locale: string;
  private availableLocales: string[];
  private updateLocaleUrl: string | null;
  private updateTimezoneUrl: string | null;

  constructor(
    options: MainManagerOptions = {},
    csrfToken?: string,
    updateThemeUrl?: string,
    locale?: string,
    availableLocales?: string[],
    updateLocaleUrl?: string,
    updateTimezoneUrl?: string
  ) {
    this.debug = options.debug ?? false;
    this.theme = options.theme ?? 'light';
    this.environment = options.environment ?? 'production';
    this.currentTheme = this.theme; // Initialize current theme from server
    this.csrfToken = csrfToken || null;
    this.updateThemeUrl = updateThemeUrl || null;
    this.locale = locale || 'en';
    this.availableLocales = availableLocales || [];
    this.updateLocaleUrl = updateLocaleUrl || null;
    this.updateTimezoneUrl = updateTimezoneUrl || null;

    this.log('MainManager initialized', {
      debug: this.debug,
      theme: this.theme,
      currentTheme: this.currentTheme,
      environment: this.environment,
      locale: this.locale,
      availableLocales: this.availableLocales,
      hasCsrfToken: !!this.csrfToken,
      hasUpdateThemeUrl: !!this.updateThemeUrl,
      hasUpdateLocaleUrl: !!this.updateLocaleUrl,
      hasUpdateTimezoneUrl: !!this.updateTimezoneUrl,
    });
  }

  public run(): void {
    this.setupGlobalErrorHandling();
    this.setupLucideIcons();
    this.setupThemeManagement();
    this.setupLocaleManagement();
  }

  /**
   * Logging utility with debug support
   */
  private log(
    message: string,
    data?: any,
    level: 'log' | 'debug' | 'warn' | 'error' = 'log'
  ): void {
    if (!this.debug && (level === 'log' || level === 'debug')) return;

    const prefix = '[MainManager]';
    if (data) {
      console[level](prefix, message, data);
    } else {
      console[level](prefix, message);
    }
  }

  private setupGlobalErrorHandling(): void {
    window.addEventListener('unhandledrejection', event => {
      this.log(
        'Unhandled promise rejection',
        { reason: event.reason },
        'error'
      );
    });

    window.addEventListener('error', event => {
      this.log(
        'Uncaught error',
        {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
        },
        'error'
      );
    });
  }

  private setupLucideIcons(): void {
    try {
      const lucide = window.lucide;
      if (lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
        this.log('Lucide icons initialized');
      } else {
        this.log(
          'Lucide not available or createIcons method not found',
          null,
          'warn'
        );
      }
    } catch (error) {
      this.log('Failed to initialize Lucide icons', { error }, 'error');
    }
  }

  /**
   * Setup theme management system
   */
  private setupThemeManagement(): void {
    // Theme is already applied server-side to prevent flicker
    this.verifyThemeConsistency();

    this.setupThemeToggle();

    this.setupDarkModeWaveToggle();

    // Watch for theme changes
    this.setupThemeObserver();
  }

  /**
   * Verify theme consistency between server and client
   */
  private verifyThemeConsistency(): void {
    const html = document.documentElement;
    const body = document.body;
    const bodyHasDarkClass = body.classList.contains('dark');
    const htmlHasDarkClass = html.classList.contains('dark');
    const shouldHaveDarkClass = this.theme === 'dark';
    const bodyTheme = body.getAttribute('data-theme');

    // Fix any inconsistencies (shouldn't happen with server-side rendering, but just in case)
    if (
      bodyHasDarkClass !== shouldHaveDarkClass ||
      htmlHasDarkClass !== shouldHaveDarkClass ||
      bodyTheme !== this.theme
    ) {
      this.log('Fixing theme inconsistency', null, 'warn');
      this.applyTheme(this.theme);
    }
  }

  /**
   * Setup theme toggle button functionality
   */
  private setupThemeToggle(): void {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) {
      this.log('Theme toggle button not found in DOM', null, 'warn');
      return;
    }

    this.updateThemeToggleIcons();

    themeToggle.addEventListener('click', () => {
      this.toggleTheme();
    });
  }

  private updateThemeToggleIcons(): void {
    const lightIcon = document.getElementById('theme-toggle-light-icon');
    const darkIcon = document.getElementById('theme-toggle-dark-icon');

    if (!lightIcon || !darkIcon) return;

    if (this.currentTheme === 'dark') {
      lightIcon.classList.add('hidden');
      darkIcon.classList.remove('hidden');
    } else {
      lightIcon.classList.remove('hidden');
      darkIcon.classList.add('hidden');
    }
  }

  private applyTheme(theme: string): void {
    const html = document.documentElement;
    const body = document.body;

    if (theme === 'dark') {
      html.classList.add('dark');
      body.classList.add('dark');
      body.setAttribute('data-theme', 'dark');
    } else {
      html.classList.remove('dark');
      body.classList.remove('dark');
      body.setAttribute('data-theme', 'light');
    }

    this.updateThemeToggleIcons();
  }

  /**
   * Setup dark mode toggle for wave backgrounds
   */
  private setupDarkModeWaveToggle(): void {
    const updateDarkMode = () => {
      const isDarkMode = document.documentElement.classList.contains('dark');
      const lightPaths = document.querySelectorAll('.light-mode-path');
      const darkPaths = document.querySelectorAll('.dark-mode-path');

      lightPaths.forEach(path => {
        (path as HTMLElement).classList.toggle('hidden', isDarkMode);
      });

      darkPaths.forEach(path => {
        (path as HTMLElement).classList.toggle('hidden', !isDarkMode);
      });
    };

    updateDarkMode();

    // Store reference for theme observer
    (this as any).updateDarkMode = updateDarkMode;
  }

  /**
   * Setup theme change observer
   */
  private setupThemeObserver(): void {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.attributeName === 'class') {
          (this as any).updateDarkMode();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // Performance optimization: Remove observer on page unload
    window.addEventListener('beforeunload', () => {
      observer.disconnect();
    });
  }

  /**
   * Setup locale management system
   */
  private setupLocaleManagement(): void {
    if (this.availableLocales && this.availableLocales.length > 0) {
      this.setupLanguageSelector();
    }
    if (this.updateTimezoneUrl) {
      this.setupTimezoneSelector();
    }
  }

  /**
   * Setup language selector functionality
   */
  private setupLanguageSelector(): void {
    const languageSelector = document.getElementById(
      'language-selector'
    ) as HTMLSelectElement;
    if (!languageSelector) {
      this.log('Language selector not found in DOM', null, 'warn');
      return;
    }

    languageSelector.value = this.locale;

    languageSelector.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLSelectElement;
      const newLocale = target.value;
      this.log('Language changed to:', newLocale);
      this.updateLocale(newLocale);
    });

    this.log('Language selector initialized', {
      currentLocale: this.locale,
      availableLocales: this.availableLocales,
    });
  }

  /**
   * Update locale with server synchronization
   */
  private updateLocale(locale: string): void {
    this.log('Updating locale', {
      from: this.locale,
      to: locale,
      hasCsrfToken: !!this.csrfToken,
      hasUpdateUrl: !!this.updateLocaleUrl,
    });

    // Always save to localStorage
    localStorage.setItem('locale', locale);

    if (this.csrfToken && this.updateLocaleUrl) {
      this.log('Sending locale update request to server', {
        url: this.updateLocaleUrl,
      });

      fetch(`${this.updateLocaleUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrfToken,
        },
        body: JSON.stringify({ locale }),
      })
        .then(response => {
          this.log('Locale update response received', {
            status: response.status,
            ok: response.ok,
          });

          if (response.ok) {
            return response.json();
          } else {
            this.log(
              'Server returned error status',
              { status: response.status },
              'warn'
            );
            return { success: true };
          }
        })
        .then((data: ThemeUpdateResponse) => {
          this.log('Locale update response data', data);

          if (data.success) {
            this.log('Locale updated successfully, reloading page');
            window.location.reload();
          } else {
            this.log(
              'Server reported failure, but reloading anyway',
              data,
              'warn'
            );
            // Even if server update fails, reload to apply localStorage
            window.location.reload();
          }
        })
        .catch(error => {
          this.log('Error updating locale on server', { error }, 'error');
          // Even if server update fails, reload to apply localStorage
          window.location.reload();
        });
    } else {
      this.log('No CSRF token or update URL, reloading with localStorage only');
      // No CSRF token or URL, just reload to apply localStorage
      window.location.reload();
    }
  }

  /**
   * Setup timezone selector functionality
   */
  private setupTimezoneSelector(): void {
    const timezoneSelector = document.getElementById(
      'timezone-selector-settings'
    ) as HTMLSelectElement;
    if (!timezoneSelector) {
      this.log('Timezone selector not found in DOM', null, 'debug');
      return;
    }

    timezoneSelector.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLSelectElement;
      const newTimezone = target.value;
      this.log('Timezone changed to:', newTimezone);
      this.updateTimezone(newTimezone);
    });

    this.log('Timezone selector initialized');
  }

  /**
   * Update timezone with server synchronization
   */
  private updateTimezone(timezone: string): void {
    this.log('Updating timezone', {
      to: timezone,
      hasCsrfToken: !!this.csrfToken,
      hasUpdateUrl: !!this.updateTimezoneUrl,
    });

    if (this.csrfToken && this.updateTimezoneUrl) {
      this.log('Sending timezone update request to server', {
        url: this.updateTimezoneUrl,
      });

      fetch(`${this.updateTimezoneUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrfToken,
        },
        body: JSON.stringify({ timezone }),
      })
        .then(response => {
          this.log('Timezone update response received', {
            status: response.status,
            ok: response.ok,
          });

          if (response.ok) {
            return response.json();
          } else {
            this.log(
              'Server returned error status',
              { status: response.status },
              'warn'
            );
            throw new Error('Failed to update timezone');
          }
        })
        .then((data: ThemeUpdateResponse) => {
          this.log('Timezone update response data', data);

          if (data.success) {
            this.log('Timezone updated successfully, reloading page');
            window.location.reload();
          } else {
            this.log('Server reported failure', data, 'warn');
          }
        })
        .catch(error => {
          this.log('Error updating timezone on server', { error }, 'error');
        });
    } else {
      this.log('No CSRF token or update URL for timezone update', null, 'warn');
    }
  }

  /**
   * Toggle theme and update server
   */
  public toggleTheme(): void {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.updateTheme(newTheme);
  }

  /**
   * Update theme with server synchronization
   */
  private updateTheme(theme: string): void {
    this.log('Updating theme', {
      from: this.currentTheme,
      to: theme,
      hasCsrfToken: !!this.csrfToken,
      hasUpdateUrl: !!this.updateThemeUrl,
    });

    // Always save to localStorage
    localStorage.setItem('theme', theme);

    if (this.csrfToken && this.updateThemeUrl) {
      this.log('Sending theme update request to server', {
        url: this.updateThemeUrl,
      });

      fetch(`${this.updateThemeUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrfToken,
        },
        body: JSON.stringify({ theme }),
      })
        .then(response => {
          this.log('Theme update response received', {
            status: response.status,
            ok: response.ok,
          });

          if (response.ok) {
            return response.json();
          } else {
            this.log(
              'Server returned error status',
              { status: response.status },
              'warn'
            );
            return { success: true };
          }
        })
        .then((data: ThemeUpdateResponse) => {
          this.log('Theme update response data', data);

          if (data.success) {
            this.log('Theme updated successfully on server');
            this.currentTheme = theme;
            this.applyTheme(theme);
          } else {
            this.log(
              'Server reported failure, but applying locally',
              data,
              'warn'
            );
            this.currentTheme = theme;
            this.applyTheme(theme);
          }
        })
        .catch(error => {
          this.log('Error updating theme on server', { error }, 'error');
          // Even if server update fails, apply the theme locally
          this.currentTheme = theme;
          this.applyTheme(theme);
        });
    } else {
      this.log('No CSRF token or update URL, applying theme locally only');
      // No CSRF token or URL, just use localStorage
      this.currentTheme = theme;
      this.applyTheme(theme);
    }
  }
}

export function initializeMainPage(): MainManager {
  const dataElement = document.getElementById('___MAIN_STATE___');

  if (dataElement) {
    try {
      const data: MainConfiguration = JSON.parse(
        dataElement.textContent || '{}'
      );

      const mainManager = new MainManager(
        {
          debug: data.debug,
          theme: data.theme,
          environment: data.environment,
        },
        data.csrfToken,
        data.routes?.updateTheme,
        data.locale,
        data.availableLocales,
        data.routes?.updateLocale,
        data.routes?.updateTimezone
      );

      mainManager.run();
      return mainManager;
    } catch (error) {
      console.error('[MainManager] Failed to parse configuration:', error);

      const fallbackDebug =
        document.documentElement.getAttribute('data-env') === 'development' ||
        window.location.hostname === 'localhost';

      const mainManager = new MainManager(
        {
          debug: fallbackDebug,
          theme: document.body.getAttribute('data-theme') || 'light',
          environment: 'production',
        },
        '',
        '',
        'en',
        [],
        '',
        ''
      );

      mainManager.run();
      return mainManager;
    }
  } else {
    console.error('[MainManager] No configuration data found in DOM');

    const fallbackDebug =
      document.documentElement.getAttribute('data-env') === 'development' ||
      localStorage.getItem('debug') === 'true' ||
      window.location.hostname === 'localhost';

    const mainManager = new MainManager(
      {
        debug: fallbackDebug,
        theme: document.body.getAttribute('data-theme') || 'light',
        environment: 'production',
      },
      '',
      '',
      'en',
      [],
      '',
      ''
    );

    mainManager.run();
    return mainManager;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeMainPage();
  });
}
