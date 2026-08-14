/**
 * Declarative controls for administrator session revocation.
 *
 * Templates own the forms and CSRF values. This module adds localized
 * confirmation without inline handlers and leaves native form submission
 * intact when the shared dialog service is unavailable.
 */

interface SessionsConfig {
  translations: TranslationStrings;
}

interface TranslationStrings {
  revokeTitle: string;
  revokeMessage: string;
  revokeConfirm: string;
  revokeCancel: string;
}

type SessionsConfigInput = {
  translations?: Partial<TranslationStrings>;
};

const DEFAULT_CONFIG: SessionsConfig = {
  translations: {
    revokeTitle: 'Revoke Session',
    revokeMessage:
      'Are you sure you want to revoke this session? This will immediately log out the user from this device.',
    revokeConfirm: 'Revoke',
    revokeCancel: 'Cancel',
  },
};

export class AdminSessionsManager {
  private readonly config: SessionsConfig;

  public constructor(config: SessionsConfigInput = {}) {
    this.config = {
      translations: {
        ...DEFAULT_CONFIG.translations,
        ...config.translations,
      },
    };
  }

  public initialize(): void {
    const revokeForms = document.querySelectorAll<HTMLFormElement>(
      '[data-session-revoke], form[action*="/revoke"]'
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
          form.dataset.sessionRevokeMessage ||
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

function readConfig(): SessionsConfigInput {
  const stateElement = document.getElementById('___ADMIN_SESSIONS_STATE___');
  if (!stateElement?.textContent?.trim()) return {};

  try {
    return JSON.parse(stateElement.textContent) as SessionsConfigInput;
  } catch (error) {
    console.error('[AdminSessionsManager] Initialization failed:', error);
    return {};
  }
}

function bootstrap(): void {
  new AdminSessionsManager(readConfig()).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, { AdminSessionsManager });
}
