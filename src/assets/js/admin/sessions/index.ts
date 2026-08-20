import dialogService from '../../utils/dialog.js';
import {
  ConfirmedFormManager,
  type ConfirmedActionDialog,
  type ConfirmedFormTranslations,
} from '../../utils/confirmed-action.js';

type TranslationStrings = {
  revokeTitle: string;
  revokeMessage: string;
  revokeConfirm: string;
  revokeCancel: string;
};

type SessionsConfigInput = {
  translations?: Partial<TranslationStrings>;
};

const DEFAULT_TRANSLATIONS: TranslationStrings = {
  revokeTitle: 'Revoke Session',
  revokeMessage:
    'Are you sure you want to revoke this session? This will immediately log out the user from this device.',
  revokeConfirm: 'Revoke',
  revokeCancel: 'Cancel',
};

export class AdminSessionsManager extends ConfirmedFormManager {
  public constructor(
    config: SessionsConfigInput = {},
    dialog: ConfirmedActionDialog | null = dialogService
  ) {
    const translations = {
      ...DEFAULT_TRANSLATIONS,
      ...config.translations,
    };
    const formTranslations: ConfirmedFormTranslations = {
      cancelText: translations.revokeCancel,
      confirmText: translations.revokeConfirm,
      message: translations.revokeMessage,
      title: translations.revokeTitle,
    };
    super(
      {
        messageDataKey: 'sessionRevokeMessage',
        selector: '[data-session-revoke], form[action*="/revoke"]',
        translations: formTranslations,
      },
      dialog
    );
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

export function initializeAdminSessionsPage(
  dialog: ConfirmedActionDialog | null = dialogService
): void {
  new AdminSessionsManager(readConfig(), dialog).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeAdminSessionsPage(),
      {
        once: true,
      }
    );
  } else {
    initializeAdminSessionsPage();
  }
}
