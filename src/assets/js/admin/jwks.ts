/**
 * Admin JWKS Key Management - Client-Side Functionality
 *
 * Handles confirmation dialogs for key rotation and retire actions,
 * and copy-to-clipboard for key IDs and public JWK JSON.
 */

/**
 * Create a Lucide icon element
 */
function createIcon(name: string, className: string): HTMLElement {
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', name);
  icon.className = className;
  return icon;
}

/**
 * Refresh Lucide icons in the DOM
 */
function refreshLucideIcons(): void {
  const lucideWindow = window as any;
  if (
    lucideWindow.lucide &&
    typeof lucideWindow.lucide.createIcons === 'function'
  ) {
    lucideWindow.lucide.createIcons();
  }
}

/**
 * Show a custom confirmation dialog
 */
function showConfirmDialog(
  title: string,
  message: string,
  confirmText: string = 'Confirm',
  cancelText: string = 'Cancel',
  isDanger: boolean = false
): Promise<boolean> {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className =
      'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';

    const modal = document.createElement('div');
    modal.className =
      'bg-background border border-border rounded-lg shadow-lg max-w-md w-full';

    const header = document.createElement('div');
    header.className = 'flex items-start gap-3 p-6 pb-4';

    const iconContainer = document.createElement('div');
    iconContainer.className = 'flex-shrink-0 mt-0.5';
    const iconClass = isDanger
      ? 'h-6 w-6 text-red-500'
      : 'h-6 w-6 text-amber-500';
    iconContainer.appendChild(createIcon('alert-triangle', iconClass));

    const titleElement = document.createElement('h3');
    titleElement.className = 'font-semibold text-lg flex-1';
    titleElement.textContent = title;

    header.appendChild(iconContainer);
    header.appendChild(titleElement);

    const body = document.createElement('div');
    body.className = 'px-6 pb-4';
    const messageElement = document.createElement('p');
    messageElement.className =
      'text-sm text-muted-foreground whitespace-pre-line';
    messageElement.textContent = message;
    body.appendChild(messageElement);

    const footer = document.createElement('div');
    footer.className = 'flex justify-end gap-2 p-6 pt-4 border-t border-border';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className =
      'px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors';
    cancelButton.textContent = cancelText;

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    const buttonColor = isDanger
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-amber-500 hover:bg-amber-600';
    confirmButton.className = `px-4 py-2 text-sm font-medium text-white ${buttonColor} rounded-md transition-colors`;
    confirmButton.textContent = confirmText;

    footer.appendChild(cancelButton);
    footer.appendChild(confirmButton);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    backdrop.appendChild(modal);

    const cleanup = () => backdrop.remove();

    cancelButton.addEventListener('click', () => {
      cleanup();
      resolve(false);
    });

    confirmButton.addEventListener('click', () => {
      cleanup();
      resolve(true);
    });

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) {
        cleanup();
        resolve(false);
      }
    });

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        document.removeEventListener('keydown', handleEscape);
        resolve(false);
      }
    };
    document.addEventListener('keydown', handleEscape);

    document.body.appendChild(backdrop);
    refreshLucideIcons();
    confirmButton.focus();
  });
}

/**
 * Copy text to clipboard with visual feedback
 */
async function copyToClipboard(
  text: string,
  triggerElement?: HTMLElement
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);

    const button = triggerElement?.closest('button') ?? null;
    if (button) {
      const originalChildren = Array.from(button.childNodes).map(n =>
        n.cloneNode(true)
      );

      // Replace with check icon
      while (button.firstChild) button.removeChild(button.firstChild);
      button.appendChild(createIcon('check', 'h-3.5 w-3.5'));
      button.classList.add('text-green-600');
      refreshLucideIcons();

      setTimeout(() => {
        while (button.firstChild) button.removeChild(button.firstChild);
        originalChildren.forEach(child => button.appendChild(child));
        button.classList.remove('text-green-600');
        refreshLucideIcons();
      }, 2000);
    }
  } catch {
    // Fallback: use execCommand for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
}

/**
 * Confirm key rotation action
 */
async function confirmRotateKeys(event: Event): Promise<boolean> {
  event.preventDefault();

  const confirmed = await showConfirmDialog(
    'Rotate JWKS Keys',
    'This will generate new signing keys and move current active keys to "expiring" status.\n\nActive tokens signed with old keys will remain valid during the overlap window.\n\nAre you sure you want to rotate the keys?',
    'Yes, Rotate Keys',
    'Cancel',
    false
  );

  if (confirmed) {
    const form = event.target as HTMLFormElement;
    form.submit();
  }

  return confirmed;
}

/**
 * Confirm retire expired keys action
 */
async function confirmRetireExpired(event: Event): Promise<boolean> {
  event.preventDefault();

  const confirmed = await showConfirmDialog(
    'Retire Expired Keys',
    'This will permanently retire keys that have passed the overlap window.\n\nRetired keys will no longer be used for token verification. Tokens signed with these keys will become invalid.\n\nAre you sure?',
    'Yes, Retire Expired',
    'Cancel',
    false
  );

  if (confirmed) {
    const form = event.target as HTMLFormElement;
    form.submit();
  }

  return confirmed;
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const isAdminJwks = window.location.pathname.includes('/admin/jwks');
  if (!isAdminJwks) return;

  // Make functions globally accessible for inline event handlers
  (window as any).confirmRotateKeys = confirmRotateKeys;
  (window as any).confirmRetireExpired = confirmRetireExpired;
  (window as any).copyToClipboard = copyToClipboard;

  const copyJwkButton = document.getElementById('copy-public-jwk');
  const jwkJsonElement = document.getElementById('public-jwk-json');

  if (copyJwkButton && jwkJsonElement) {
    copyJwkButton.addEventListener('click', () => {
      copyToClipboard(jwkJsonElement.textContent || '', copyJwkButton);
    });
  }
});
