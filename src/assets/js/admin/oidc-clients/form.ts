import clipboardService, {
  type ClipboardService,
} from '../../utils/clipboard.js';

interface OidcClientsFormConfig {
  csrfToken: string;
  presets: Record<string, QuickStartPreset>;
  translations: TranslationStrings;
}

interface TranslationStrings {
  showSensitiveData: string;
  hideSensitiveData: string;
}

const MANAGEMENT_API_RESOURCE = 'urn:parako:api:v1';

interface QuickStartPreset {
  application_type: string;
  token_endpoint_auth_method: string;
  require_pkce: boolean;
  grant_types: string[];
  response_types: string[];
  scope: string;
}

export class AdminOidcClientsFormManager {
  private readonly config: OidcClientsFormConfig;
  private readonly translations: TranslationStrings;
  private form: HTMLFormElement | null = null;
  private appTypeInput: HTMLInputElement | null = null;
  private appTypeSelect: HTMLSelectElement | null = null;
  private authMethodSelect: HTMLSelectElement | null = null;
  private pkceCheckbox: HTMLInputElement | null = null;
  private scopeInput: HTMLInputElement | null = null;
  private grantTypeCheckboxes: HTMLInputElement[] = [];
  private responseTypeCheckboxes: HTMLInputElement[] = [];
  private toggleSensitiveFieldsButton: HTMLElement | null = null;
  private secretElement: HTMLElement | null = null;
  private secretHiddenElement: HTMLElement | null = null;
  private copyButton: HTMLElement | null = null;
  private toggleText: HTMLElement | null = null;
  private presetInput: HTMLInputElement | null = null;
  private apiScopesSection: HTMLElement | null = null;
  private customResourceSubSection: HTMLElement | null = null;
  private mgmtApiScopeSubSection: HTMLElement | null = null;
  private apiScopeCheckboxes: HTMLInputElement[] = [];
  private allowedResourcesTextarea: HTMLTextAreaElement | null = null;
  private resourcesScopesTextarea: HTMLTextAreaElement | null = null;

  private readonly quickStartPresets: Record<string, QuickStartPreset>;

  private readonly defaultTranslations: TranslationStrings = {
    showSensitiveData: 'Show Sensitive Data',
    hideSensitiveData: 'Hide Sensitive Data',
  };

  constructor(
    config: OidcClientsFormConfig,
    private readonly clipboard: ClipboardService = clipboardService
  ) {
    this.config = config;
    this.quickStartPresets = config.presets;
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
    if (this.isCreateForm()) {
      this.applyQuickStartPreset('web');
    }
    if (!this.isCreateForm()) {
      this.syncApiScopesSectionVisibility();
    }
  }

  private isCreateForm(): boolean {
    return this.form?.dataset.mode === 'create';
  }
  private cacheElements(): void {
    this.form = document.getElementById(
      'oidc-client-form'
    ) as HTMLFormElement | null;
    this.appTypeInput = document.getElementById(
      'application_type'
    ) as HTMLInputElement | null;
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
    this.grantTypeCheckboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="grant_types"]')
    );
    this.responseTypeCheckboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[name="response_types"]'
      )
    );
    this.presetInput = document.getElementById(
      'preset'
    ) as HTMLInputElement | null;
    this.apiScopesSection = document.getElementById(
      'management-api-scopes-section'
    );
    this.customResourceSubSection = document.getElementById(
      'custom-resource-sub-section'
    );
    this.mgmtApiScopeSubSection = document.getElementById(
      'mgmt-api-scope-sub-section'
    );
    this.apiScopeCheckboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="api_scopes"]')
    );
    this.allowedResourcesTextarea = document.getElementById(
      'allowedResources'
    ) as HTMLTextAreaElement | null;
    this.resourcesScopesTextarea = document.getElementById(
      'resourcesScopes'
    ) as HTMLTextAreaElement | null;
    this.toggleSensitiveFieldsButton = document.getElementById(
      'toggleSensitiveFields'
    );
    this.secretElement = document.getElementById('client-secret');
    this.secretHiddenElement = document.getElementById('client-secret-hidden');
    this.copyButton = document.getElementById('copy-secret');
    this.toggleText = document.getElementById('toggleText');
  }
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
  private applyQuickStartPreset(presetKey: string): void {
    const preset = this.quickStartPresets[presetKey];
    if (!preset) return;

    if (this.appTypeInput) {
      this.appTypeInput.value = preset.application_type;
    }

    if (this.presetInput) {
      this.presetInput.value = presetKey;
    }

    if (this.authMethodSelect) {
      this.authMethodSelect.value = preset.token_endpoint_auth_method;
    }

    if (this.pkceCheckbox) {
      this.pkceCheckbox.checked = preset.require_pkce;
    }

    if (this.scopeInput) {
      this.scopeInput.value = preset.scope;
    }

    this.grantTypeCheckboxes.forEach(cb => (cb.checked = false));
    preset.grant_types.forEach(gt => {
      const checkbox = document.querySelector<HTMLInputElement>(
        `input[name="grant_types"][value="${gt}"]`
      );
      if (checkbox) checkbox.checked = true;
    });

    this.responseTypeCheckboxes.forEach(cb => (cb.checked = false));
    preset.response_types.forEach(rt => {
      const checkbox = document.querySelector<HTMLInputElement>(
        `input[name="response_types"][value="${rt}"]`
      );
      if (checkbox) checkbox.checked = true;
    });
    this.syncApiScopesSectionVisibility();
  }
  private setupAppTypeAutoSelect(): void {
    const appTypeSelect = this.appTypeSelect;
    if (!appTypeSelect) return;

    appTypeSelect.addEventListener('change', () => {
      const appType = appTypeSelect.value;
      const defaults = this.quickStartPresets[appType];

      this.grantTypeCheckboxes.forEach(cb => (cb.checked = false));
      this.responseTypeCheckboxes.forEach(cb => (cb.checked = false));

      if (!defaults) return;

      defaults.grant_types.forEach(grantType => {
        const checkbox = document.querySelector<HTMLInputElement>(
          `input[name="grant_types"][value="${grantType}"]`
        );
        if (checkbox) checkbox.checked = true;
      });

      defaults.response_types.forEach(responseType => {
        const checkbox = document.querySelector<HTMLInputElement>(
          `input[name="response_types"][value="${responseType}"]`
        );
        if (checkbox) checkbox.checked = true;
      });
    });
  }
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
        this.customResourceSubSection.classList.remove('hidden');
        this.mgmtApiScopeSubSection.classList.remove('hidden');
      }
    }
  }
  private setupApiScopesPicker(): void {
    this.grantTypeCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        this.syncApiScopesSectionVisibility();
      });
    });
  }
  private setupFormSubmitHandler(): void {
    if (!this.form) return;

    this.form.addEventListener('submit', () => {
      this.mergeApiScopesIntoTextareas();
    });
  }
  private mergeApiScopesIntoTextareas(): void {
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
      const customResources = this.allowedResourcesTextarea.value
        .split('\n')
        .map(l => l.trim())
        .filter(resource => resource && resource !== MANAGEMENT_API_RESOURCE);

      if (checkedScopes.length > 0) {
        customResources.push(MANAGEMENT_API_RESOURCE);
      }

      this.allowedResourcesTextarea.value = [...new Set(customResources)].join(
        '\n'
      );
    }
  }
  private setupSensitiveFieldsToggle(): void {
    if (!this.toggleSensitiveFieldsButton) return;

    this.toggleSensitiveFieldsButton.addEventListener('click', () => {
      void this.toggleSensitiveFields();
    });
    if (this.copyButton) {
      this.copyButton.addEventListener('click', (e: MouseEvent) => {
        const secret = this.secretElement?.textContent;
        if (secret) {
          void this.clipboard.copy(secret, e.currentTarget as HTMLElement);
        }
      });
    }
  }
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

          const data: unknown = await response.json();
          const secret = readClientSecret(data);
          if (!secret) {
            console.error(
              '[AdminOidcClientsFormManager] Failed to reveal secret'
            );
            return;
          }
          this.secretElement.textContent = secret;
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

const defaultConfig: OidcClientsFormConfig = {
  csrfToken: '',
  presets: {},
  translations: {
    showSensitiveData: 'Show Sensitive Data',
    hideSensitiveData: 'Hide Sensitive Data',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : null;
}

function readPresets(value: unknown): Record<string, QuickStartPreset> {
  if (!isRecord(value)) return {};

  const presets: Record<string, QuickStartPreset> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)) continue;

    const grantTypes = readStringArray(candidate.grant_types);
    const responseTypes = readStringArray(candidate.response_types);
    if (
      typeof candidate.application_type !== 'string' ||
      typeof candidate.token_endpoint_auth_method !== 'string' ||
      typeof candidate.require_pkce !== 'boolean' ||
      !grantTypes ||
      !responseTypes ||
      typeof candidate.scope !== 'string'
    ) {
      continue;
    }

    presets[key] = {
      application_type: candidate.application_type,
      grant_types: grantTypes,
      require_pkce: candidate.require_pkce,
      response_types: responseTypes,
      scope: candidate.scope,
      token_endpoint_auth_method: candidate.token_endpoint_auth_method,
    };
  }
  return presets;
}

function readClientSecret(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.client_secret === 'string' &&
    value.client_secret.length > 0
    ? value.client_secret
    : null;
}

function readConfig(stateElement: HTMLElement | null): OidcClientsFormConfig {
  if (!stateElement) return defaultConfig;

  const parsed: unknown = JSON.parse(stateElement.textContent || '{}');
  if (!isRecord(parsed)) return defaultConfig;

  const translations = isRecord(parsed.translations) ? parsed.translations : {};
  return {
    csrfToken: typeof parsed.csrfToken === 'string' ? parsed.csrfToken : '',
    presets: readPresets(parsed.presets),
    translations: {
      hideSensitiveData:
        typeof translations.hideSensitiveData === 'string'
          ? translations.hideSensitiveData
          : defaultConfig.translations.hideSensitiveData,
      showSensitiveData:
        typeof translations.showSensitiveData === 'string'
          ? translations.showSensitiveData
          : defaultConfig.translations.showSensitiveData,
    },
  };
}

export function initializeAdminOidcClientsForm(
  clipboard: ClipboardService = clipboardService
): AdminOidcClientsFormManager {
  const stateElement = document.getElementById(
    '___ADMIN_OIDC_CLIENTS_FORM_STATE___'
  );

  let config = defaultConfig;
  try {
    config = readConfig(stateElement);
  } catch (error) {
    console.error(
      '[AdminOidcClientsFormManager] Initialization failed:',
      error
    );
  }

  const manager = new AdminOidcClientsFormManager(config, clipboard);
  manager.initialize();
  return manager;
}

export function registerAdminOidcClientsFormEntry(): void {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeAdminOidcClientsForm(),
      { once: true }
    );
    return;
  }

  initializeAdminOidcClientsForm();
}

if (typeof document !== 'undefined') {
  registerAdminOidcClientsFormEntry();
}
