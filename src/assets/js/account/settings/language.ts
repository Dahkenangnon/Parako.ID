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

import dialogService, { type DialogService } from '../../utils/dialog.js';

/**
 * Configuration interface for LanguageSelector
 */
export interface LanguageSelectorConfig {
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
export class LanguageSelector {
  private config: LanguageSelectorConfig;
  private debug: boolean;
  private languageSelector: HTMLSelectElement | null;

  constructor(
    config: LanguageSelectorConfig,
    private readonly dialog: DialogService = dialogService
  ) {
    this.config = config;
    this.debug = config.debug || false;
    this.languageSelector = null;
  }

  public initialize(): void {
    this.log('Initializing LanguageSelector');

    this.languageSelector = document.getElementById(
      'language-selector-settings'
    ) as HTMLSelectElement;

    if (!this.languageSelector) {
      this.log('Language selector not found, skipping initialization');
      return;
    }

    this.setupChangeHandler(this.languageSelector);
  }

  /**
   * Setup change event handler for language selector
   */
  private setupChangeHandler(languageSelector: HTMLSelectElement): void {
    languageSelector.addEventListener('change', async e => {
      await this.handleLanguageChange(e);
    });

    this.log('Language selector handler setup complete');
  }

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

        await this.dialog.showAlert(
          'Language Update Error',
          this.config.translations.languageUpdateError,
          { variant: 'error' }
        );
      }
    } catch (error) {
      console.error('Settings page: Error updating locale:', error);

      await this.dialog.showAlert(
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
