/**
 * Admin Activities Manager
 *
 * Handles admin activities management functionality:
 * - Clear old activities modal
 * - Form submission for clearing activities
 */
(function () {
  'use strict';

  // Type Definitions

  interface ActivitiesConfig {
    csrfToken: string;
    routes: {
      clearOld: string;
    };
    translations: TranslationStrings;
  }

  interface TranslationStrings {
    invalidDays: string;
  }

  // Activities Manager Class

  class AdminActivitiesManager {
    private config: ActivitiesConfig;
    private translations: TranslationStrings;
    private modal: HTMLElement | null = null;
    private daysInput: HTMLInputElement | null = null;

    private readonly defaultTranslations: TranslationStrings = {
      invalidDays: 'Please enter a valid number of days',
    };

    constructor(config: ActivitiesConfig) {
      this.config = config;
      this.translations = {
        ...this.defaultTranslations,
        ...config.translations,
      };
    }

    public initialize(): void {
      this.cacheElements();
      this.setupEventListeners();
      this.exposeGlobalMethods();
    }

    /**
     * Cache DOM elements
     */
    private cacheElements(): void {
      this.modal = document.getElementById('clearOldModal');
      this.daysInput = document.getElementById(
        'days'
      ) as HTMLInputElement | null;
    }

    /**
     * Setup event listeners
     */
    private setupEventListeners(): void {
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          this.hideModal();
        }
      });

      if (this.modal) {
        this.modal.addEventListener('click', event => {
          if (event.target === this.modal) {
            this.hideModal();
          }
        });
      }
    }

    /**
     * Expose global methods for inline onclick handlers
     */
    private exposeGlobalMethods(): void {
      (window as any).showClearOldModal = this.showModal.bind(this);
      (window as any).hideClearOldModal = this.hideModal.bind(this);
      (window as any).clearOldActivities = this.clearOldActivities.bind(this);
    }

    /**
     * Show the clear old activities modal
     */
    public showModal(): void {
      if (this.modal) {
        this.modal.classList.remove('hidden');
      }
    }

    /**
     * Hide the clear old activities modal
     */
    public hideModal(): void {
      if (this.modal) {
        this.modal.classList.add('hidden');
      }
    }

    /**
     * Submit the clear old activities form
     */
    public clearOldActivities(): void {
      if (!this.daysInput) {
        return;
      }

      const days = parseInt(this.daysInput.value, 10);

      if (!days || days < 1) {
        alert(this.translations.invalidDays);
        return;
      }

      const form = document.createElement('form');
      form.method = 'POST';
      form.action =
        this.config.routes.clearOld || '/admin/activities/clear-old';

      const daysInputHidden = document.createElement('input');
      daysInputHidden.type = 'hidden';
      daysInputHidden.name = 'days';
      daysInputHidden.value = days.toString();

      const csrfInput = document.createElement('input');
      csrfInput.type = 'hidden';
      csrfInput.name = '_csrf';
      csrfInput.value = this.getCsrfToken();

      form.appendChild(daysInputHidden);
      form.appendChild(csrfInput);
      document.body.appendChild(form);
      form.submit();
    }

    /**
     * Get CSRF token from hidden input or meta tag
     */
    private getCsrfToken(): string {
      const csrfInput = document.querySelector<HTMLInputElement>(
        'input[name="_csrf"]'
      );
      if (csrfInput) {
        return csrfInput.value;
      }

      const csrfMeta = document.querySelector(
        'meta[name="csrf-token"]'
      ) as HTMLElement | null;
      if (csrfMeta) {
        return csrfMeta.getAttribute('content') || '';
      }

      return this.config.csrfToken || '';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById(
      '___ADMIN_ACTIVITIES_STATE___'
    );

    // Default config if state element not found
    const defaultConfig: ActivitiesConfig = {
      csrfToken: '',
      routes: {
        clearOld: '/admin/activities/clear-old',
      },
      translations: {
        invalidDays: 'Please enter a valid number of days',
      },
    };

    try {
      const config = stateElement
        ? JSON.parse(stateElement.textContent || '{}')
        : defaultConfig;
      const manager = new AdminActivitiesManager({
        ...defaultConfig,
        ...config,
      });
      manager.initialize();
    } catch (error) {
      console.error('[AdminActivitiesManager] Initialization failed:', error);
      const manager = new AdminActivitiesManager(defaultConfig);
      manager.initialize();
    }
  });

  if (typeof window !== 'undefined') {
    (window as any).AdminActivitiesManager = AdminActivitiesManager;
  }
})();
