/**
 * Admin Application Settings Module
 *
 * Handles application settings page functionality:
 * - Form reset with confirmation (via common.ts)
 * - Locale validation (at least one locale, default in available)
 */
(function () {
  'use strict';

  // Type Definitions

  interface DialogApi {
    showAlert: (
      title: string,
      message: string,
      options?: { variant?: string }
    ) => Promise<void>;
  }

  // Application Settings Manager Class

  class ApplicationSettingsManager {
    private form: HTMLFormElement | null = null;
    private availableLocales: NodeListOf<HTMLInputElement> | null = null;
    private defaultLocaleSelect: HTMLSelectElement | null = null;

    public initialize(): void {
      this.cacheElements();
      this.setupFormValidation();
    }

    /**
     * Cache DOM elements
     */
    private cacheElements(): void {
      this.form = document.querySelector('form');
      this.availableLocales = document.querySelectorAll(
        'input[name="locales[available][]"]'
      );
      this.defaultLocaleSelect = document.getElementById(
        'locales.default'
      ) as HTMLSelectElement | null;
    }

    /**
     * Setup form validation
     */
    private setupFormValidation(): void {
      if (!this.form) return;

      this.form.addEventListener('submit', e => {
        e.preventDefault();

        this.validateForm().then(isValid => {
          if (isValid && this.form) {
            const bypassInput = document.createElement('input');
            bypassInput.type = 'hidden';
            bypassInput.name = '_validated';
            bypassInput.value = '1';
            this.form.appendChild(bypassInput);
            this.form.submit();
          }
        });
      });
    }

    /**
     * Validate form before submission
     */
    private async validateForm(): Promise<boolean> {
      if (!this.availableLocales || !this.defaultLocaleSelect) return true;

      const checkedLocales = Array.from(this.availableLocales).filter(
        cb => cb.checked
      );

      if (checkedLocales.length === 0) {
        await this.showValidationError(
          'Please select at least one available locale.'
        );
        return false;
      }

      const defaultLocale = this.defaultLocaleSelect.value;
      const isDefaultInAvailable = checkedLocales.some(
        cb => cb.value === defaultLocale
      );

      if (!isDefaultInAvailable) {
        await this.showValidationError(
          'Default locale must be included in available locales.'
        );
        return false;
      }

      return true;
    }

    /**
     * Show validation error dialog
     */
    private async showValidationError(message: string): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      if (dialogApi && typeof dialogApi.showAlert === 'function') {
        await dialogApi.showAlert('Validation Error', message, {
          variant: 'error',
        });
      } else {
        alert(message);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const manager = new ApplicationSettingsManager();
    manager.initialize();
  });
})();
