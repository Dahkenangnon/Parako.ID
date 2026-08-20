import dialogService, {
  type DialogService,
  type DialogVariant,
} from './dialog.js';

export interface ConfirmedActionConfig {
  debug?: boolean;
}

export type ConfirmedActionDialog = Pick<DialogService, 'showConfirm'>;

export interface ConfirmationPrompt {
  title: string;
  message: string;
  variant: DialogVariant;
  confirmText: string;
  cancelText: string;
}

export async function requestConfirmation(
  dialog: Partial<ConfirmedActionDialog> | null | undefined,
  prompt: ConfirmationPrompt,
  fallback: (message: string) => boolean = message => confirm(message)
): Promise<boolean> {
  if (typeof dialog?.showConfirm === 'function') {
    try {
      return await dialog.showConfirm(prompt.title, prompt.message, {
        variant: prompt.variant,
        confirmText: prompt.confirmText,
        cancelText: prompt.cancelText,
      });
    } catch {
      return fallback(prompt.message);
    }
  }

  return fallback(prompt.message);
}

const DIALOG_VARIANTS = new Set<DialogVariant>([
  'info',
  'warning',
  'error',
  'success',
  'danger',
]);

function readDialogVariant(value: string | undefined): DialogVariant {
  return value && DIALOG_VARIANTS.has(value as DialogVariant)
    ? (value as DialogVariant)
    : 'warning';
}

export class ConfirmedActionManager {
  private readonly debug: boolean;

  public constructor(
    private readonly logPrefix: string,
    config: ConfirmedActionConfig = {},
    private readonly dialog: ConfirmedActionDialog = dialogService
  ) {
    this.debug = config.debug ?? false;
  }

  public initialize(root: ParentNode = document): void {
    const buttons = root.querySelectorAll<HTMLButtonElement>('.confirm-action');
    this.log(`Found ${buttons.length} confirm-action buttons`);

    buttons.forEach(button => {
      button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();

        const title = button.dataset.confirmTitle || 'Confirm Action';
        const message = button.dataset.confirmMessage || 'Are you sure?';
        const variant = readDialogVariant(button.dataset.confirmVariant);

        this.log('Showing confirmation dialog:', { title, message, variant });
        const confirmed = await this.dialog.showConfirm(title, message, {
          variant,
          confirmText: 'Confirm',
          cancelText: 'Cancel',
        });

        if (confirmed) {
          this.log('User confirmed action, submitting form');
          button.form?.submit();
        } else {
          this.log('User cancelled action');
        }
      });
    });
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(`[${this.logPrefix}]`, ...args);
    }
  }
}

export interface ConfirmedFormTranslations {
  cancelText: string;
  confirmText: string;
  message: string;
  title: string;
}

export interface ConfirmedFormConfig {
  messageDataKey: string;
  selector: string;
  translations: ConfirmedFormTranslations;
}

export class ConfirmedFormManager {
  public constructor(
    private readonly config: ConfirmedFormConfig,
    private readonly dialog: ConfirmedActionDialog | null = dialogService
  ) {}

  public initialize(root: ParentNode = document): void {
    const forms = root.querySelectorAll<HTMLFormElement>(this.config.selector);

    forms.forEach(form => {
      form.addEventListener('submit', async event => {
        if (!this.dialog) return;

        event.preventDefault();
        const message =
          form.dataset[this.config.messageDataKey] ||
          this.config.translations.message;
        const confirmed = await this.dialog.showConfirm(
          this.config.translations.title,
          message,
          {
            variant: 'danger',
            confirmText: this.config.translations.confirmText,
            cancelText: this.config.translations.cancelText,
          }
        );

        if (confirmed) form.submit();
      });
    });
  }
}
