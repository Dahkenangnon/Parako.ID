import clipboardService, { type ClipboardService } from '../utils/clipboard.js';
import dialogService, { type DialogService } from '../utils/dialog.js';

type OidcClientDialog = Pick<DialogService, 'showConfirm'>;

interface ConfirmationCopy {
  confirmText: string;
  message: string;
  title: string;
  variant: 'danger' | 'warning';
}

export class AdminOidcClientsManager {
  public constructor(
    private readonly dialog: OidcClientDialog = dialogService,
    private readonly clipboard: ClipboardService = clipboardService
  ) {}

  public initialize(): void {
    document
      .querySelectorAll<HTMLFormElement>('[data-oidc-client-confirm]')
      .forEach(form => {
        form.addEventListener('submit', event => {
          switch (form.dataset.oidcClientConfirm) {
            case 'deactivate':
              void this.confirmDeactivateClient(event);
              break;
            case 'delete':
              void this.confirmDeleteClient(event);
              break;
            case 'regenerate-secret':
              void this.confirmRegenerateSecret(event);
              break;
          }
        });
      });

    document
      .querySelectorAll<HTMLElement>('[data-oidc-copy]')
      .forEach(trigger => {
        trigger.addEventListener('click', () => {
          const value = trigger.dataset.oidcCopy;
          if (value !== undefined) {
            void this.clipboard.copy(value, trigger);
          }
        });
      });
  }

  private async confirmAndSubmit(
    event: Event,
    copy: ConfirmationCopy
  ): Promise<boolean> {
    const form = (event.currentTarget ?? event.target) as HTMLFormElement;
    event.preventDefault();

    const confirmed = await this.dialog.showConfirm(copy.title, copy.message, {
      cancelText: 'Cancel',
      confirmText: copy.confirmText,
      variant: copy.variant,
    });
    if (confirmed) {
      form.submit();
    }
    return confirmed;
  }

  public confirmDeactivateClient(event: Event): Promise<boolean> {
    return this.confirmAndSubmit(event, {
      confirmText: 'Yes, Deactivate',
      message:
        'Are you sure you want to deactivate this client?\n\nThe client will no longer be able to authenticate until reactivated.',
      title: 'Deactivate OIDC Client',
      variant: 'warning',
    });
  }

  public confirmDeleteClient(event: Event): Promise<boolean> {
    return this.confirmAndSubmit(event, {
      confirmText: 'Yes, Delete Permanently',
      message:
        '\u26A0\uFE0F WARNING: This action CANNOT be undone!\n\nDeleting this client will:\n\u2022 Permanently remove all client data\n\u2022 Invalidate all active tokens\n\u2022 Break any applications using this client\n\nAre you absolutely sure?',
      title: 'Delete OIDC Client - Permanent Action',
      variant: 'danger',
    });
  }

  public confirmRegenerateSecret(event: Event): Promise<boolean> {
    return this.confirmAndSubmit(event, {
      confirmText: 'Yes, Regenerate Secret',
      message:
        '\u26A0\uFE0F WARNING: This will invalidate the current secret!\n\nRegenerating the secret will:\n\u2022 Invalidate the current client secret\n\u2022 Require updating the secret in all applications\n\u2022 May temporarily break authentication\n\nMake sure you have a plan to update your applications.',
      title: 'Regenerate Client Secret',
      variant: 'danger',
    });
  }
}

export function initializeAdminOidcClientsPage(
  dialog: OidcClientDialog = dialogService,
  clipboard: ClipboardService = clipboardService
): AdminOidcClientsManager | null {
  const root = '/admin/oidc-clients';
  const { pathname } = window.location;
  if (pathname !== root && !pathname.startsWith(root + '/')) {
    return null;
  }

  const manager = new AdminOidcClientsManager(dialog, clipboard);
  manager.initialize();
  return manager;
}

export function registerAdminOidcClientsEntry(): void {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeAdminOidcClientsPage(),
      { once: true }
    );
    return;
  }

  initializeAdminOidcClientsPage();
}

if (typeof document !== 'undefined') {
  registerAdminOidcClientsEntry();
}
