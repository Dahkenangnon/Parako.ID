/**
 * MainManager - Handles global application functionality
 *
 * Features:
 * - Global error handling
 * - Lucide icons initialization
 * - Theme management and dark mode toggle
 * - Locale management
 * - Modal dialog utilities (inlined from utils/dialog)
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  // Dialog Utilities (inlined from utils/dialog.ts)

  type DialogVariant = 'info' | 'warning' | 'error' | 'success' | 'danger';

  interface AlertOptions {
    variant?: DialogVariant;
    buttonText?: string;
    icon?: string;
  }

  interface ConfirmOptions {
    variant?: DialogVariant;
    confirmText?: string;
    cancelText?: string;
    icon?: string;
  }

  /**
   * Get icon and colors based on dialog variant
   */
  function getVariantConfig(variant: DialogVariant = 'warning') {
    const configs = {
      info: {
        icon: 'info',
        iconColor: 'text-blue-500',
        buttonColor: 'bg-blue-500 hover:bg-blue-600',
      },
      warning: {
        icon: 'alert-triangle',
        iconColor: 'text-amber-500',
        buttonColor: 'bg-amber-500 hover:bg-amber-600',
      },
      error: {
        icon: 'x-circle',
        iconColor: 'text-red-500',
        buttonColor: 'bg-red-500 hover:bg-red-600',
      },
      success: {
        icon: 'check-circle',
        iconColor: 'text-green-500',
        buttonColor: 'bg-green-600 hover:bg-green-700',
      },
      danger: {
        icon: 'alert-triangle',
        iconColor: 'text-red-500',
        buttonColor: 'bg-red-500 hover:bg-red-600',
      },
    };

    return configs[variant];
  }

  /**
   * Show an alert dialog (single button)
   */
  async function showAlert(
    title: string,
    message: string,
    options: AlertOptions = {}
  ): Promise<void> {
    const { variant = 'info', buttonText = 'OK', icon } = options;
    const config = getVariantConfig(variant);
    const iconName = icon || config.icon;

    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className =
        'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
      backdrop.style.animation = 'fadeIn 0.2s ease-out';

      const modal = document.createElement('div');
      modal.className =
        'bg-background border border-border rounded-lg shadow-lg max-w-md w-full';
      modal.style.animation = 'slideIn 0.2s ease-out';

      const header = document.createElement('div');
      header.className = 'flex items-start gap-3 p-6 pb-4';

      const iconContainer = document.createElement('div');
      iconContainer.className = 'flex-shrink-0 mt-0.5';

      const iconElement = document.createElement('i');
      iconElement.setAttribute('data-lucide', iconName);
      iconElement.className = `h-6 w-6 ${config.iconColor}`;
      iconContainer.appendChild(iconElement);

      const titleElement = document.createElement('h3');
      titleElement.className = 'font-semibold text-lg text-foreground flex-1';
      titleElement.textContent = title;

      header.appendChild(iconContainer);
      header.appendChild(titleElement);

      const body = document.createElement('div');
      body.className = 'px-6 pb-4';

      const messageElement = document.createElement('p');
      messageElement.className =
        'text-sm text-muted-foreground whitespace-pre-line';
      messageElement.textContent = message;
      body.appendChild(messageElement);

      const footer = document.createElement('div');
      footer.className =
        'flex justify-end gap-2 p-6 pt-4 border-t border-border';

      const okButton = document.createElement('button');
      okButton.type = 'button';
      okButton.className = `px-4 py-2 text-sm font-medium text-white ${config.buttonColor} rounded-md transition-colors`;
      okButton.textContent = buttonText;

      footer.appendChild(okButton);

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      backdrop.appendChild(modal);

      document.body.appendChild(backdrop);

      if ((window as any).lucide) {
        (window as any).lucide.createIcons();
      }

      setTimeout(() => okButton.focus(), 100);

      const cleanup = () => {
        backdrop.remove();
        resolve();
      };

      okButton.addEventListener('click', cleanup);

      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) {
          cleanup();
        }
      });

      document.addEventListener(
        'keydown',
        e => {
          if (e.key === 'Escape') {
            cleanup();
          }
        },
        { once: true }
      );
    });
  }

  /**
   * Show a confirmation dialog (two buttons)
   * Returns true if confirmed, false if canceled
   */
  async function showConfirm(
    title: string,
    message: string,
    options: ConfirmOptions = {}
  ): Promise<boolean> {
    const {
      variant = 'warning',
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      icon,
    } = options;
    const config = getVariantConfig(variant);
    const iconName = icon || config.icon;

    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className =
        'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
      backdrop.style.animation = 'fadeIn 0.2s ease-out';

      const modal = document.createElement('div');
      modal.className =
        'bg-background border border-border rounded-lg shadow-lg max-w-md w-full';
      modal.style.animation = 'slideIn 0.2s ease-out';

      const header = document.createElement('div');
      header.className = 'flex items-start gap-3 p-6 pb-4';

      const iconContainer = document.createElement('div');
      iconContainer.className = 'flex-shrink-0 mt-0.5';

      const iconElement = document.createElement('i');
      iconElement.setAttribute('data-lucide', iconName);
      iconElement.className = `h-6 w-6 ${config.iconColor}`;
      iconContainer.appendChild(iconElement);

      const titleElement = document.createElement('h3');
      titleElement.className = 'font-semibold text-lg text-foreground flex-1';
      titleElement.textContent = title;

      header.appendChild(iconContainer);
      header.appendChild(titleElement);

      const body = document.createElement('div');
      body.className = 'px-6 pb-4';

      const messageElement = document.createElement('p');
      messageElement.className =
        'text-sm text-muted-foreground whitespace-pre-line';
      messageElement.textContent = message;
      body.appendChild(messageElement);

      const footer = document.createElement('div');
      footer.className =
        'flex justify-end gap-2 p-6 pt-4 border-t border-border';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className =
        'px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors';
      cancelButton.textContent = cancelText;

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = `px-4 py-2 text-sm font-medium text-white ${config.buttonColor} rounded-md transition-colors`;
      confirmButton.textContent = confirmText;

      footer.appendChild(cancelButton);
      footer.appendChild(confirmButton);

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      backdrop.appendChild(modal);

      document.body.appendChild(backdrop);

      if ((window as any).lucide) {
        (window as any).lucide.createIcons();
      }

      setTimeout(() => confirmButton.focus(), 100);

      const cleanup = (result: boolean) => {
        backdrop.remove();
        resolve(result);
      };

      confirmButton.addEventListener('click', () => cleanup(true));
      cancelButton.addEventListener('click', () => cleanup(false));

      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) {
          cleanup(false);
        }
      });

      document.addEventListener(
        'keydown',
        e => {
          if (e.key === 'Escape') {
            cleanup(false);
          }
        },
        { once: true }
      );
    });
  }

  /**
   * Legacy compatibility wrapper for confirm()
   */
  function confirmDialog(message: string): Promise<boolean> {
    return showConfirm('Confirm', message);
  }

  /**
   * Legacy compatibility wrapper for alert()
   */
  function alertDialog(message: string): Promise<void> {
    return showAlert('Notice', message);
  }

  // MainManager Class

  // TypeScript interface for Lucide
  interface LucideWindow extends Window {
    lucide?: {
      createIcons: () => void;
    };
    dialog?: {
      showAlert: typeof showAlert;
      showConfirm: typeof showConfirm;
      alert: typeof alertDialog;
      confirm: typeof confirmDialog;
    };
  }

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

  class MainManager {
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

    /**
     * Initialize all global functionality
     */
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

    /**
     * Setup global error handling
     */
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

    /**
     * Initialize Lucide icons
     */
    private setupLucideIcons(): void {
      try {
        const lucideWindow = window as LucideWindow;
        if (
          lucideWindow.lucide &&
          typeof lucideWindow.lucide.createIcons === 'function'
        ) {
          lucideWindow.lucide.createIcons();
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

      // Fix any inconsistencies (shouldn't happen with server-side rendering, but just in case)
      if (
        bodyHasDarkClass !== shouldHaveDarkClass ||
        htmlHasDarkClass !== shouldHaveDarkClass
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

    /**
     * Update theme toggle button icons
     */
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

    /**
     * Apply theme to document elements (for dynamic theme changes)
     */
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
            if ((this as any).updateDarkMode) {
              (this as any).updateDarkMode();
            }
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
        this.log(
          'No CSRF token or update URL, reloading with localStorage only'
        );
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
        this.log(
          'No CSRF token or update URL for timezone update',
          null,
          'warn'
        );
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

  // Auto-initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById('___MAIN_STATE___');

    if (dataElement) {
      try {
        const data: MainConfiguration = JSON.parse(
          dataElement.textContent || '{}'
        );

        const mainManager = new MainManager(
          {
            debug: data.debug || false,
            theme: data.theme || 'light',
            environment: data.environment || 'production',
          },
          data.csrfToken,
          data.routes?.updateTheme,
          data.locale,
          data.availableLocales,
          data.routes?.updateLocale,
          data.routes?.updateTimezone
        );

        mainManager.run();

        // Make MainManager globally accessible for theme toggle
        (window as any).mainManager = mainManager;

        // Make dialog utilities globally accessible
        (window as LucideWindow).dialog = {
          showAlert,
          showConfirm,
          alert: alertDialog,
          confirm: confirmDialog,
        };
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

        // Make dialog utilities globally accessible
        (window as LucideWindow).dialog = {
          showAlert,
          showConfirm,
          alert: alertDialog,
          confirm: confirmDialog,
        };
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

      // Make dialog utilities globally accessible
      (window as LucideWindow).dialog = {
        showAlert,
        showConfirm,
        alert: alertDialog,
        confirm: confirmDialog,
      };
    }
  });
})(); // End of IIFE
