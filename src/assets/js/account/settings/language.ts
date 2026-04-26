/**
 * LanguageSelector - Manages language/locale selection
 *
 * Features:
 * - Handles language dropdown change events
 * - Sends locale update request to server
 * - Automatic page reload to apply new locale
 * - Error handling with user feedback
 * - Debug logging for troubleshooting
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  /**
   * Configuration interface for LanguageSelector
   */
  interface LanguageSelectorConfig {
    updateLocaleUrl: string;
    csrfToken: string;
    translations: {
      languageUpdateError: string;
    };
    debug?: boolean;
  }

  /**
   * LanguageSelector class - Handles language selection
   */
  class LanguageSelector {
    private config: LanguageSelectorConfig;
    private debug: boolean;
    private languageSelector: HTMLSelectElement | null;

    constructor(config: LanguageSelectorConfig) {
      this.config = config;
      this.debug = config.debug || false;
      this.languageSelector = null;
    }

    /**
     * Initialize the language selector
     */
    public initialize(): void {
      this.log('Initializing LanguageSelector');

      this.languageSelector = document.getElementById(
        'language-selector-settings'
      ) as HTMLSelectElement;

      if (!this.languageSelector) {
        this.log('Language selector not found, skipping initialization');
        return;
      }

      this.setupChangeHandler();
    }

    /**
     * Setup change event handler for language selector
     */
    private setupChangeHandler(): void {
      if (!this.languageSelector) return;

      this.languageSelector.addEventListener('change', async e => {
        await this.handleLanguageChange(e);
      });

      this.log('Language selector handler setup complete');
    }

    /**
     * Handle language selection change
     */
    private async handleLanguageChange(e: Event): Promise<void> {
      const target = e.target as HTMLSelectElement;
      const newLocale = target.value;

      this.log('Updating locale to:', newLocale);

      try {
        const response = await fetch(this.config.updateLocaleUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
          body: JSON.stringify({ locale: newLocale }),
        });

        const data = await response.json();

        this.log('Locale update response:', data);

        if (data.success) {
          this.log('Locale updated successfully to:', newLocale);

          window.location.reload();
        } else {
          console.error('Settings page: Failed to update locale:', data.error);

          await (window as any).dialog.showAlert(
            'Language Update Error',
            this.config.translations.languageUpdateError,
            { variant: 'error' }
          );
        }
      } catch (error) {
        console.error('Settings page: Error updating locale:', error);

        await (window as any).dialog.showAlert(
          'Language Update Error',
          this.config.translations.languageUpdateError,
          { variant: 'error' }
        );
      }
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
      if (this.debug) {
        console.log('[LanguageSelector]', ...args);
      }
    }
  }

  if (typeof window !== 'undefined') {
    (window as any).LanguageSelector = LanguageSelector;
  }

  // Module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LanguageSelector;
  }
})();
