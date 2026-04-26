/* eslint-disable no-undef */
/**
 * Admin OIDC Clients Form Manager
 *
 * Handles OIDC client form functionality:
 * - Quick-start preset selection (create form)
 * - Auto-apply grant types, response types, auth method, PKCE, scope per preset
 * - Toggle sensitive fields visibility (client secret on show page)
 */
(function () {
  'use strict';

  // Type Definitions

  interface OidcClientsFormConfig {
    csrfToken: string;
    translations: TranslationStrings;
  }

  interface TranslationStrings {
    showSensitiveData: string;
    hideSensitiveData: string;
  }

  interface QuickStartPreset {
    applicationtype: string;
    authMethod: string;
    requirePkce: boolean;
    grantTypes: string[];
    responseTypes: string[];
    scope: string;
  }

  // OIDC Clients Form Manager Class

  class AdminOidcClientsFormManager {
    private config: OidcClientsFormConfig;
    private translations: TranslationStrings;

    // DOM Elements
    private form: HTMLFormElement | null = null;
    private appTypeInput: HTMLInputElement | null = null;
    private appTypeSelect: HTMLSelectElement | null = null;
    private authMethodSelect: HTMLSelectElement | null = null;
    private pkceCheckbox: HTMLInputElement | null = null;
    private scopeInput: HTMLInputElement | null = null;
    private grantTypeCheckboxes: NodeListOf<HTMLInputElement> | null = null;
    private responseTypeCheckboxes: NodeListOf<HTMLInputElement> | null = null;
    private toggleSensitiveFieldsButton: HTMLElement | null = null;
    private secretElement: HTMLElement | null = null;
    private secretHiddenElement: HTMLElement | null = null;
    private copyButton: HTMLElement | null = null;
    private toggleText: HTMLElement | null = null;
    private presetInput: HTMLInputElement | null = null;
    private apiScopesSection: HTMLElement | null = null;
    private customResourceSubSection: HTMLElement | null = null;
    private mgmtApiScopeSubSection: HTMLElement | null = null;
    private apiScopeCheckboxes: NodeListOf<HTMLInputElement> | null = null;
    private allowedResourcesTextarea: HTMLTextAreaElement | null = null;
    private resourcesScopesTextarea: HTMLTextAreaElement | null = null;

    // Quick-start presets matching APP_TYPE_PRESETS from client.interface.ts
    private readonly quickStartPresets: Record<string, QuickStartPreset> = {
      web: {
        applicationtype: 'web',
        authMethod: 'client_secret_basic',
        requirePkce: false,
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scope: 'openid profile email',
      },
      spa: {
        applicationtype: 'web',
        authMethod: 'none',
        requirePkce: true,
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scope: 'openid profile email',
      },
      native: {
        applicationtype: 'native',
        authMethod: 'none',
        requirePkce: true,
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scope: 'openid profile email',
      },
      m2m: {
        applicationtype: 'web',
        authMethod: 'client_secret_basic',
        requirePkce: false,
        grantTypes: ['client_credentials'],
        responseTypes: [],
        scope: '',
      },
      device: {
        applicationtype: 'native',
        authMethod: 'client_secret_post',
        requirePkce: false,
        grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
        responseTypes: [],
        scope: 'openid profile email offline_access',
      },
      api_management: {
        applicationtype: 'web',
        authMethod: 'client_secret_basic',
        requirePkce: false,
        grantTypes: ['client_credentials'],
        responseTypes: [],
        scope: '',
      },
    };

    private readonly defaultTranslations: TranslationStrings = {
      showSensitiveData: 'Show Sensitive Data',
      hideSensitiveData: 'Hide Sensitive Data',
    };

    constructor(config: OidcClientsFormConfig) {
      this.config = config;
      this.translations = {
        ...this.defaultTranslations,
        ...config.translations,
      };
    }

    public initialize(): void {
      this.cacheElements();
      this.setupQuickStartCards();
      this.setupAppTypeAutoSelect();
      this.setupSensitiveFieldsToggle();
      this.setupApiScopesPicker();
      this.setupFormSubmitHandler();

      // Auto-apply default preset on create form
      if (this.isCreateForm()) {
        this.applyQuickStartPreset('web');
      }

      // On edit form, sync visibility based on current grant types
      if (!this.isCreateForm()) {
        this.syncApiScopesSectionVisibility();
      }
    }

    private isCreateForm(): boolean {
      return this.form?.dataset.mode === 'create';
    }

    /**
     * Cache DOM elements
     */
    private cacheElements(): void {
      this.form = document.getElementById(
        'oidc-client-form'
      ) as HTMLFormElement | null;
      this.appTypeInput = document.getElementById(
        'application_type'
      ) as HTMLInputElement | null;
      // On edit form, application_type is a <select>
      if (this.appTypeInput?.tagName === 'SELECT') {
        this.appTypeSelect = this.appTypeInput as unknown as HTMLSelectElement;
        this.appTypeInput = null;
      }
      this.authMethodSelect = document.getElementById(
        'token_endpoint_auth_method'
      ) as HTMLSelectElement | null;
      this.pkceCheckbox = document.getElementById(
        'require_pkce'
      ) as HTMLInputElement | null;
      this.scopeInput = document.getElementById(
        'scope'
      ) as HTMLInputElement | null;
      this.grantTypeCheckboxes = document.querySelectorAll<HTMLInputElement>(
        'input[name="grant_types"]'
      );
      this.responseTypeCheckboxes = document.querySelectorAll<HTMLInputElement>(
        'input[name="response_types"]'
      );

      // Preset hidden input (create form)
      this.presetInput = document.getElementById(
        'preset'
      ) as HTMLInputElement | null;

      // Management API scopes elements
      this.apiScopesSection = document.getElementById(
        'management-api-scopes-section'
      );
      this.customResourceSubSection = document.getElementById(
        'custom-resource-sub-section'
      );
      this.mgmtApiScopeSubSection = document.getElementById(
        'mgmt-api-scope-sub-section'
      );
      this.apiScopeCheckboxes = document.querySelectorAll<HTMLInputElement>(
        'input[name="api_scopes"]'
      );
      this.allowedResourcesTextarea = document.getElementById(
        'allowedResources'
      ) as HTMLTextAreaElement | null;
      this.resourcesScopesTextarea = document.getElementById(
        'resourcesScopes'
      ) as HTMLTextAreaElement | null;

      // Sensitive fields elements (show page)
      this.toggleSensitiveFieldsButton = document.getElementById(
        'toggleSensitiveFields'
      );
      this.secretElement = document.getElementById('client-secret');
      this.secretHiddenElement = document.getElementById(
        'client-secret-hidden'
      );
      this.copyButton = document.getElementById('copy-secret');
      this.toggleText = document.getElementById('toggleText');
    }

    /**
     * Setup quick-start card selection (create form only)
     */
    private setupQuickStartCards(): void {
      const cards = document.querySelectorAll<HTMLElement>('.quick-start-card');
      if (cards.length === 0) return;

      cards.forEach(card => {
        card.addEventListener('click', () => {
          const presetKey = card.dataset.preset;
          if (!presetKey) return;

          cards.forEach(c => {
            c.classList.remove('border-primary', 'bg-primary/5');
            c.classList.add('border-border');
            const check = c.querySelector('.quick-start-check');
            if (check) check.classList.add('hidden');
            const radio = c.querySelector<HTMLInputElement>(
              'input[type="radio"]'
            );
            if (radio) radio.checked = false;
          });

          card.classList.remove('border-border');
          card.classList.add('border-primary', 'bg-primary/5');
          const check = card.querySelector('.quick-start-check');
          if (check) check.classList.remove('hidden');
          const radio = card.querySelector<HTMLInputElement>(
            'input[type="radio"]'
          );
          if (radio) radio.checked = true;

          this.applyQuickStartPreset(presetKey);
        });
      });
    }

    /**
     * Apply a quick-start preset to the form
     */
    private applyQuickStartPreset(presetKey: string): void {
      const preset = this.quickStartPresets[presetKey];
      if (!preset) return;

      if (this.appTypeInput) {
        this.appTypeInput.value = preset.applicationtype;
      }

      if (this.presetInput) {
        this.presetInput.value = presetKey;
      }

      if (this.authMethodSelect) {
        this.authMethodSelect.value = preset.authMethod;
      }

      if (this.pkceCheckbox) {
        this.pkceCheckbox.checked = preset.requirePkce;
      }

      if (this.scopeInput) {
        this.scopeInput.value = preset.scope;
      }

      this.grantTypeCheckboxes?.forEach(cb => (cb.checked = false));
      preset.grantTypes.forEach(gt => {
        const checkbox = document.querySelector<HTMLInputElement>(
          `input[name="grant_types"][value="${gt}"]`
        );
        if (checkbox) checkbox.checked = true;
      });

      this.responseTypeCheckboxes?.forEach(cb => (cb.checked = false));
      preset.responseTypes.forEach(rt => {
        const checkbox = document.querySelector<HTMLInputElement>(
          `input[name="response_types"][value="${rt}"]`
        );
        if (checkbox) checkbox.checked = true;
      });

      // Show/hide Management API scopes section
      this.syncApiScopesSectionVisibility();
    }

    /**
     * Setup auto-selection of grant types and response types based on application type
     * (for edit form where application_type is a <select>)
     */
    private setupAppTypeAutoSelect(): void {
      if (!this.appTypeSelect) return;

      this.appTypeSelect.addEventListener('change', () => {
        const appType = this.appTypeSelect?.value || '';
        const defaults = this.quickStartPresets[appType];

        this.grantTypeCheckboxes?.forEach(cb => (cb.checked = false));
        this.responseTypeCheckboxes?.forEach(cb => (cb.checked = false));

        if (!defaults) return;

        defaults.grantTypes.forEach(grantType => {
          const checkbox = document.querySelector<HTMLInputElement>(
            `input[name="grant_types"][value="${grantType}"]`
          );
          if (checkbox) checkbox.checked = true;
        });

        defaults.responseTypes.forEach(responseType => {
          const checkbox = document.querySelector<HTMLInputElement>(
            `input[name="response_types"][value="${responseType}"]`
          );
          if (checkbox) checkbox.checked = true;
        });
      });
    }

    /**
     * Show or hide the Management API scopes section based on whether
     * the `client_credentials` grant type is currently checked.
     * Then toggle sub-sections based on preset value:
     * - api_management → show scope checkboxes, hide custom textareas
     * - m2m → show custom textareas, hide scope checkboxes
     * - no preset (old clients) → show both (backward-compatible)
     */
    private syncApiScopesSectionVisibility(): void {
      if (!this.apiScopesSection) return;

      const ccCheckbox = document.querySelector<HTMLInputElement>(
        'input[name="grant_types"][value="client_credentials"]'
      );
      const hasCC = ccCheckbox?.checked ?? false;

      if (hasCC) {
        this.apiScopesSection.classList.remove('hidden');
      } else {
        this.apiScopesSection.classList.add('hidden');
      }

      const preset = this.presetInput?.value || this.form?.dataset.preset || '';

      if (this.customResourceSubSection && this.mgmtApiScopeSubSection) {
        if (preset === 'api_management') {
          this.customResourceSubSection.classList.add('hidden');
          this.mgmtApiScopeSubSection.classList.remove('hidden');
        } else if (preset === 'm2m') {
          this.customResourceSubSection.classList.remove('hidden');
          this.mgmtApiScopeSubSection.classList.add('hidden');
        } else {
          // No preset (old clients) or other presets — show both
          this.customResourceSubSection.classList.remove('hidden');
          this.mgmtApiScopeSubSection.classList.remove('hidden');
        }
      }
    }

    /**
     * Setup the Management API scope picker.
     * - Listen for grant type changes to show/hide the section.
     */
    private setupApiScopesPicker(): void {
      this.grantTypeCheckboxes?.forEach(cb => {
        cb.addEventListener('change', () => {
          this.syncApiScopesSectionVisibility();
        });
      });
    }

    /**
     * Merge checked API scope checkboxes into textareas before form submit.
     */
    private setupFormSubmitHandler(): void {
      if (!this.form) return;

      this.form.addEventListener('submit', () => {
        this.mergeApiScopesIntoTextareas();
      });
    }

    /**
     * Merge checked Management API scope checkboxes into the resource textareas,
     * preserving any custom entries the admin has added manually.
     */
    private mergeApiScopesIntoTextareas(): void {
      if (!this.apiScopeCheckboxes) return;

      const MGMT_RESOURCE_URI = 'urn:parako:api:v1';

      const checkedScopes: string[] = [];
      this.apiScopeCheckboxes.forEach(cb => {
        if (cb.checked) checkedScopes.push(cb.value);
      });

      if (this.resourcesScopesTextarea) {
        const existing = this.resourcesScopesTextarea.value
          .split(/\s+/)
          .filter(Boolean);
        const custom = existing.filter(s => !s.startsWith('parako:'));
        const merged = [...new Set([...custom, ...checkedScopes])];
        this.resourcesScopesTextarea.value = merged.join(' ');
      }

      if (this.allowedResourcesTextarea) {
        const existing = this.allowedResourcesTextarea.value
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        if (checkedScopes.length > 0 && !existing.includes(MGMT_RESOURCE_URI)) {
          existing.push(MGMT_RESOURCE_URI);
        }

        this.allowedResourcesTextarea.value = existing.join('\n');
      }
    }

    /**
     * Setup toggle for sensitive fields (client secret visibility)
     */
    private setupSensitiveFieldsToggle(): void {
      if (!this.toggleSensitiveFieldsButton) return;

      this.toggleSensitiveFieldsButton.addEventListener('click', () => {
        this.toggleSensitiveFields();
      });

      // Wire up copy button to use fetched secret
      if (this.copyButton) {
        this.copyButton.addEventListener('click', (e: MouseEvent) => {
          const secret = this.secretElement?.textContent;
          if (secret) {
            (window as any).adminOidcClientsManager?.copyToClipboard(
              secret,
              e.currentTarget as HTMLElement
            );
          }
        });
      }
    }

    /**
     * Toggle sensitive fields visibility.
     * On first reveal, fetches the secret from the server API.
     */
    private async toggleSensitiveFields(): Promise<void> {
      if (!this.secretElement || !this.secretHiddenElement) return;

      const isHidden = this.secretElement.classList.contains('hidden');

      if (isHidden) {
        if (!this.secretElement.textContent) {
          const clientId =
            document.querySelector<HTMLElement>('[data-client-id]')?.dataset
              .clientId;
          if (!clientId) return;

          try {
            const response = await fetch(
              `/admin/oidc-clients/${clientId}/reveal-secret`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': this.config.csrfToken,
                },
              }
            );

            if (!response.ok) {
              console.error(
                '[AdminOidcClientsFormManager] Failed to reveal secret'
              );
              return;
            }

            const data = await response.json();
            this.secretElement.textContent = data.client_secret;
          } catch (error) {
            console.error(
              '[AdminOidcClientsFormManager] Error fetching secret:',
              error
            );
            return;
          }
        }

        this.secretElement.classList.remove('hidden');
        this.secretHiddenElement.classList.add('hidden');
        if (this.copyButton) this.copyButton.classList.remove('hidden');
        if (this.toggleText)
          this.toggleText.textContent = this.translations.hideSensitiveData;
      } else {
        this.secretElement.classList.add('hidden');
        this.secretHiddenElement.classList.remove('hidden');
        if (this.copyButton) this.copyButton.classList.add('hidden');
        if (this.toggleText)
          this.toggleText.textContent = this.translations.showSensitiveData;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById(
      '___ADMIN_OIDC_CLIENTS_FORM_STATE___'
    );

    // Default config if state element not found
    const defaultConfig: OidcClientsFormConfig = {
      csrfToken: '',
      translations: {
        showSensitiveData: 'Show Sensitive Data',
        hideSensitiveData: 'Hide Sensitive Data',
      },
    };

    try {
      const config = stateElement
        ? JSON.parse(stateElement.textContent || '{}')
        : defaultConfig;
      const manager = new AdminOidcClientsFormManager({
        ...defaultConfig,
        ...config,
      });
      manager.initialize();
    } catch (error) {
      console.error(
        '[AdminOidcClientsFormManager] Initialization failed:',
        error
      );
      const manager = new AdminOidcClientsFormManager(defaultConfig);
      manager.initialize();
    }
  });

  if (typeof window !== 'undefined') {
    (window as any).AdminOidcClientsFormManager = AdminOidcClientsFormManager;
  }
})();
