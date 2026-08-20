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

type GrantsConfigInput = {
  translations?: Partial<TranslationStrings>;
};

const DEFAULT_TRANSLATIONS: TranslationStrings = {
  revokeTitle: 'Revoke Authorization',
  revokeMessage:
    'Are you sure you want to revoke this authorization? This action cannot be undone.',
  revokeConfirm: 'Revoke',
  revokeCancel: 'Cancel',
};

export class AdminGrantsManager extends ConfirmedFormManager {
  public constructor(
    config: GrantsConfigInput = {},
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
        messageDataKey: 'grantRevokeMessage',
        selector: '[data-grant-revoke]',
        translations: formTranslations,
      },
      dialog
    );
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

export function initializeAdminGrantsPage(
  dialog: ConfirmedActionDialog | null = dialogService
): void {
  new AdminGrantsManager(readConfig(), dialog).initialize();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeAdminGrantsPage(),
      {
        once: true,
      }
    );
  } else {
    initializeAdminGrantsPage();
  }
}
