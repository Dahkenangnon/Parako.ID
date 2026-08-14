/**
 * Declarative controls for administrator grant revocation.
 *
 * Templates own mutation routes and CSRF values. This module adds localized
 * confirmation without inline handlers and preserves native form submission
 * when the shared dialog service is unavailable.
 */

interface GrantsConfig {
  translations: TranslationStrings;
}

interface TranslationStrings {
  revokeTitle: string;
  revokeMessage: string;
  revokeConfirm: string;
  revokeCancel: string;
}

type GrantsConfigInput = {
  translations?: Partial<TranslationStrings>;
};

const DEFAULT_CONFIG: GrantsConfig = {
  translations: {
    revokeTitle: 'Revoke Authorization',
    revokeMessage:
      'Are you sure you want to revoke this authorization? This action cannot be undone.',
    revokeConfirm: 'Revoke',
    revokeCancel: 'Cancel',
  },
};

export class AdminGrantsManager {
  private readonly config: GrantsConfig;

  public constructor(config: GrantsConfigInput = {}) {
    this.config = {
      translations: {
        ...DEFAULT_CONFIG.translations,
        ...config.translations,
      },
    };
  }

  public initialize(): void {
    const revokeForms = document.querySelectorAll<HTMLFormElement>(
      '[data-grant-revoke]'
    );

    revokeForms.forEach(form => {
      form.addEventListener('submit', async event => {
        const showConfirm = (
          window as typeof window & {
            dialog?: {
              showConfirm?: (
                title: string,
                message: string,
                options: Record<string, string>
              ) => Promise<boolean>;
            };
          }
        ).dialog?.showConfirm;

        if (!showConfirm) return;

        event.preventDefault();
        const message =
          form.dataset.grantRevokeMessage ||
          this.config.translations.revokeMessage;
        const confirmed = await showConfirm(
          this.config.translations.revokeTitle,
          message,
          {
            variant: 'danger',
            confirmText: this.config.translations.revokeConfirm,
            cancelText: this.config.translations.revokeCancel,
          }
        );

        if (confirmed) form.submit();
      });
    });
  }
}

function readConfig(): GrantsConfigInput {
  const stateElement = document.getElementById('___ADMIN_GRANTS_STATE___');
  if (!stateElement?.textContent?.trim()) return {};

  try {
    return JSON.parse(stateElement.textContent) as GrantsConfigInput;
  } catch (error) {
    console.error('[AdminGrantsManager] Initialization failed:', error);
    return {};
  }
}

function bootstrap(): void {
  new AdminGrantsManager(readConfig()).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, { AdminGrantsManager });
}
