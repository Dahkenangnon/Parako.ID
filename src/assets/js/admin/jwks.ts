import clipboardService, { type ClipboardService } from '../utils/clipboard.js';
import dialogService, { type DialogService } from '../utils/dialog.js';

type JwksDialog = Pick<DialogService, 'showConfirm'>;

export class AdminJwksManager {
  public constructor(
    private readonly dialog: JwksDialog = dialogService,
    private readonly clipboard: ClipboardService = clipboardService
  ) {}

  public initialize(): void {
    document
      .querySelectorAll<HTMLFormElement>('[data-jwks-confirm]')
      .forEach(form => {
        form.addEventListener('submit', event => {
          switch (form.dataset.jwksConfirm) {
            case 'rotate':
              void this.confirmRotateKeys(event);
              break;
            case 'retire-expired':
              void this.confirmRetireExpired(event);
              break;
          }
        });
      });

    document
      .querySelectorAll<HTMLElement>(
        '[data-jwks-copy], [data-jwks-copy-target]'
      )
      .forEach(trigger => {
        trigger.addEventListener('click', () => {
          const inlineValue = trigger.dataset.jwksCopy;
          const targetId = trigger.dataset.jwksCopyTarget;
          const value =
            inlineValue ??
            (targetId
              ? document.getElementById(targetId)?.textContent
              : undefined);

          if (value !== undefined && value !== null) {
            void this.clipboard.copy(value, trigger);
          }
        });
      });
  }

  public async confirmRotateKeys(event: Event): Promise<boolean> {
    const form = (event.currentTarget ?? event.target) as HTMLFormElement;
    event.preventDefault();
    const confirmed = await this.dialog.showConfirm(
      'Rotate JWKS Keys',
      'This will generate new signing keys and move current active keys to "expiring" status.\n\nActive tokens signed with old keys will remain valid during the overlap window.\n\nAre you sure you want to rotate the keys?',
      {
        cancelText: 'Cancel',
        confirmText: 'Yes, Rotate Keys',
        variant: 'warning',
      }
    );
    if (confirmed) form.submit();
    return confirmed;
  }

  public async confirmRetireExpired(event: Event): Promise<boolean> {
    const form = (event.currentTarget ?? event.target) as HTMLFormElement;
    event.preventDefault();
    const confirmed = await this.dialog.showConfirm(
      'Retire Expired Keys',
      'This will permanently retire keys that have passed the overlap window.\n\nRetired keys will no longer be used for token verification. Tokens signed with these keys will become invalid.\n\nAre you sure?',
      {
        cancelText: 'Cancel',
        confirmText: 'Yes, Retire Expired',
        variant: 'warning',
      }
    );
    if (confirmed) form.submit();
    return confirmed;
  }
}

export function initializeAdminJwksPage(
  dialog: JwksDialog = dialogService,
  clipboard: ClipboardService = clipboardService
): AdminJwksManager | null {
  const root = '/admin/jwks';
  const { pathname } = window.location;
  if (pathname !== root && !pathname.startsWith(root + '/')) {
    return null;
  }

  const manager = new AdminJwksManager(dialog, clipboard);
  manager.initialize();
  return manager;
}

export function registerAdminJwksEntry(): void {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeAdminJwksPage(),
      { once: true }
    );
    return;
  }

  initializeAdminJwksPage();
}

if (typeof document !== 'undefined') {
  registerAdminJwksEntry();
}
