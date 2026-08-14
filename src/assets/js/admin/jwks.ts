/**
 * Admin JWKS key-management controls.
 *
 * Server-rendered actions use data attributes so strict CSP can keep
 * `script-src-attr 'none'` without disabling rotation, retirement, or copy.
 */
export class AdminJwksManager {
  private dialogSequence = 0;

  /** Attach handlers to the controls rendered by the JWKS admin templates. */
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
            void this.copyToClipboard(value, trigger);
          }
        });
      });
  }

  private showConfirmDialog(
    title: string,
    message: string,
    confirmText: string,
    cancelText: string
  ): Promise<boolean> {
    return new Promise(resolve => {
      const previouslyFocused = document.activeElement as HTMLElement | null;
      const dialogId = `jwks-confirm-${++this.dialogSequence}`;
      const backdrop = document.createElement('div');
      backdrop.className =
        'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';

      const modal = document.createElement('div');
      modal.className =
        'bg-background border border-border rounded-lg shadow-lg max-w-md w-full';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', `${dialogId}-title`);
      modal.setAttribute('aria-describedby', `${dialogId}-description`);

      const header = document.createElement('div');
      header.className = 'flex items-start gap-3 p-6 pb-4';

      const iconContainer = document.createElement('div');
      iconContainer.className = 'flex-shrink-0 mt-0.5';
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'alert-triangle');
      icon.className = 'h-6 w-6 text-amber-500';
      iconContainer.appendChild(icon);

      const titleElement = document.createElement('h3');
      titleElement.className = 'font-semibold text-lg flex-1';
      titleElement.textContent = title;
      titleElement.id = `${dialogId}-title`;

      header.appendChild(iconContainer);
      header.appendChild(titleElement);

      const body = document.createElement('div');
      body.className = 'px-6 pb-4';
      const messageElement = document.createElement('p');
      messageElement.className =
        'text-sm text-muted-foreground whitespace-pre-line';
      messageElement.textContent = message;
      messageElement.id = `${dialogId}-description`;
      body.appendChild(messageElement);

      const footer = document.createElement('div');
      footer.className =
        'flex justify-end gap-2 p-6 pt-4 border-t border-border';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className =
        'px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors';
      cancelButton.textContent = cancelText;

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className =
        'px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-md transition-colors';
      confirmButton.textContent = confirmText;

      footer.appendChild(cancelButton);
      footer.appendChild(confirmButton);
      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      backdrop.appendChild(modal);

      const cleanup = () => {
        backdrop.remove();
        document.removeEventListener('keydown', handleEscape);
        previouslyFocused?.focus();
      };

      cancelButton.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });
      confirmButton.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop) {
          cleanup();
          resolve(false);
        }
      });

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          cleanup();
          resolve(false);
        }
      };
      document.addEventListener('keydown', handleEscape);

      document.body.appendChild(backdrop);
      this.refreshLucideIcons();
      confirmButton.focus();
    });
  }

  private refreshLucideIcons(): void {
    const lucideWindow = window as Window & {
      lucide?: { createIcons?: () => void };
    };
    lucideWindow.lucide?.createIcons?.();
  }

  public async copyToClipboard(
    text: string,
    triggerElement?: HTMLElement
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }

    const button = triggerElement?.closest('button');
    if (!button) return;

    const originalChildren = Array.from(button.childNodes).map(node =>
      node.cloneNode(true)
    );
    while (button.firstChild) button.removeChild(button.firstChild);
    const successIcon = document.createElement('i');
    successIcon.setAttribute('data-lucide', 'check');
    successIcon.className = 'h-3.5 w-3.5';
    button.appendChild(successIcon);
    button.classList.add('text-green-600');
    this.refreshLucideIcons();

    setTimeout(() => {
      while (button.firstChild) button.removeChild(button.firstChild);
      originalChildren.forEach(child => button.appendChild(child));
      button.classList.remove('text-green-600');
      this.refreshLucideIcons();
    }, 2000);
  }

  public async confirmRotateKeys(event: Event): Promise<boolean> {
    const form = (event.currentTarget ?? event.target) as HTMLFormElement;
    event.preventDefault();
    const confirmed = await this.showConfirmDialog(
      'Rotate JWKS Keys',
      'This will generate new signing keys and move current active keys to "expiring" status.\n\nActive tokens signed with old keys will remain valid during the overlap window.\n\nAre you sure you want to rotate the keys?',
      'Yes, Rotate Keys',
      'Cancel'
    );
    if (confirmed) form.submit();
    return confirmed;
  }

  public async confirmRetireExpired(event: Event): Promise<boolean> {
    const form = (event.currentTarget ?? event.target) as HTMLFormElement;
    event.preventDefault();
    const confirmed = await this.showConfirmDialog(
      'Retire Expired Keys',
      'This will permanently retire keys that have passed the overlap window.\n\nRetired keys will no longer be used for token verification. Tokens signed with these keys will become invalid.\n\nAre you sure?',
      'Yes, Retire Expired',
      'Cancel'
    );
    if (confirmed) form.submit();
    return confirmed;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const isAdminJwks =
      window.location.pathname === '/admin/jwks' ||
      window.location.pathname.startsWith('/admin/jwks/');
    if (!isAdminJwks) return;

    const manager = new AdminJwksManager();
    manager.initialize();
    (
      window as Window & { adminJwksManager?: AdminJwksManager }
    ).adminJwksManager = manager;
  });
}
