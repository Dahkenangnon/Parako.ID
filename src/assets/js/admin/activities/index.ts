/**
 * Declarative controls for the administrator activity listing.
 *
 * Templates provide data attributes and an accessible dialog; this module owns
 * focus, validation, CSRF propagation, and the destructive form submission so
 * the page remains compatible with the strict Content Security Policy.
 */

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

type ActivitiesConfigInput = Partial<
  Omit<ActivitiesConfig, 'routes' | 'translations'>
> & {
  routes?: Partial<ActivitiesConfig['routes']>;
  translations?: Partial<TranslationStrings>;
};

const MAX_RETENTION_DAYS = 36_500;

const DEFAULT_CONFIG: ActivitiesConfig = {
  csrfToken: '',
  routes: {
    clearOld: '/admin/activities/clear-old',
  },
  translations: {
    invalidDays: `Enter a whole number between 1 and ${MAX_RETENTION_DAYS}`,
  },
};

export class AdminActivitiesManager {
  private readonly config: ActivitiesConfig;
  private cancelButton: HTMLButtonElement | null = null;
  private confirmButton: HTMLButtonElement | null = null;
  private daysInput: HTMLInputElement | null = null;
  private errorElement: HTMLElement | null = null;
  private lastFocusedElement: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private trigger: HTMLButtonElement | null = null;

  public constructor(config: ActivitiesConfigInput = {}) {
    this.config = {
      csrfToken: config.csrfToken ?? DEFAULT_CONFIG.csrfToken,
      routes: {
        ...DEFAULT_CONFIG.routes,
        ...config.routes,
      },
      translations: {
        ...DEFAULT_CONFIG.translations,
        ...config.translations,
      },
    };
  }

  public initialize(): void {
    this.modal = document.getElementById('clearOldModal');
    this.daysInput = document.getElementById('days') as HTMLInputElement | null;
    this.errorElement = document.getElementById('clearOldError');
    this.trigger = document.querySelector<HTMLButtonElement>(
      '[data-activities-clear-old]'
    );
    this.cancelButton = document.querySelector<HTMLButtonElement>(
      '[data-activities-clear-cancel]'
    );
    this.confirmButton = document.querySelector<HTMLButtonElement>(
      '[data-activities-clear-confirm]'
    );

    this.trigger?.addEventListener('click', () => this.showModal());
    this.cancelButton?.addEventListener('click', () => this.hideModal());
    this.confirmButton?.addEventListener('click', () =>
      this.clearOldActivities()
    );
    this.daysInput?.addEventListener('input', () =>
      this.clearValidationError()
    );

    this.modal?.addEventListener('click', event => {
      if (event.target === this.modal) this.hideModal();
    });

    document.addEventListener('keydown', event => {
      if (
        event.key === 'Escape' &&
        this.modal &&
        !this.modal.classList.contains('hidden')
      ) {
        this.hideModal();
      }
    });
  }
  public showModal(): void {
    if (!this.modal) return;

    const activeElement = document.activeElement;
    this.lastFocusedElement =
      activeElement &&
      typeof (activeElement as HTMLElement).focus === 'function'
        ? (activeElement as HTMLElement)
        : this.trigger;
    this.clearValidationError();
    this.modal.classList.remove('hidden');
    this.modal.setAttribute('aria-hidden', 'false');
    this.daysInput?.focus();
    this.daysInput?.select();
  }

  public hideModal(): void {
    if (!this.modal) return;

    this.modal.classList.add('hidden');
    this.modal.setAttribute('aria-hidden', 'true');
    this.clearValidationError();
    this.lastFocusedElement?.focus();
    this.lastFocusedElement = null;
  }

  public clearOldActivities(): void {
    if (!this.daysInput) return;

    const value = this.daysInput.value.trim();
    const days = Number(value);
    if (
      !value ||
      !Number.isSafeInteger(days) ||
      days < 1 ||
      days > MAX_RETENTION_DAYS
    ) {
      this.showValidationError();
      return;
    }

    this.clearValidationError();

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = this.config.routes.clearOld || DEFAULT_CONFIG.routes.clearOld;

    const daysInput = document.createElement('input');
    daysInput.type = 'hidden';
    daysInput.name = 'days';
    daysInput.value = String(days);
    form.appendChild(daysInput);

    const csrfInput = document.createElement('input');
    csrfInput.type = 'hidden';
    csrfInput.name = '_csrf';
    csrfInput.value = this.getCsrfToken();
    form.appendChild(csrfInput);

    document.body.appendChild(form);
    form.submit();
  }

  private showValidationError(): void {
    this.daysInput?.setAttribute('aria-invalid', 'true');
    if (this.errorElement) {
      this.errorElement.textContent = this.config.translations.invalidDays;
      this.errorElement.classList.remove('hidden');
    }
    this.daysInput?.focus();
  }

  private clearValidationError(): void {
    this.daysInput?.removeAttribute('aria-invalid');
    if (this.errorElement) {
      this.errorElement.classList.add('hidden');
    }
  }

  private getCsrfToken(): string {
    const input = document.querySelector<HTMLInputElement>(
      'input[name="_csrf"]'
    );
    if (input?.value) return input.value;

    const metaToken = document
      .querySelector<HTMLElement>('meta[name="csrf-token"]')
      ?.getAttribute('content');
    return metaToken || this.config.csrfToken;
  }
}

function readConfig(): ActivitiesConfigInput {
  const stateElement = document.getElementById('___ADMIN_ACTIVITIES_STATE___');
  if (!stateElement?.textContent?.trim()) return {};

  try {
    return JSON.parse(stateElement.textContent) as ActivitiesConfigInput;
  } catch (error) {
    console.error('[AdminActivitiesManager] Initialization failed:', error);
    return {};
  }
}

export function initializeAdminActivitiesPage(): AdminActivitiesManager {
  const manager = new AdminActivitiesManager(readConfig());
  manager.initialize();
  return manager;
}

export function registerAdminActivitiesEntry(): void {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeAdminActivitiesPage(),
      { once: true }
    );
  } else {
    initializeAdminActivitiesPage();
  }
}

if (typeof document !== 'undefined') {
  registerAdminActivitiesEntry();
}
