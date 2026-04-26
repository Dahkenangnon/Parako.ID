/**
 * Dialog Utility
 * Provides styled modal dialogs for alerts and confirmations
 * Replaces native browser alert() and confirm() functions
 */

declare global {
  interface Window {
    lucide?: { createIcons: () => void };
  }
}

export type DialogVariant = 'info' | 'warning' | 'error' | 'success' | 'danger';

export interface AlertOptions {
  variant?: DialogVariant;
  buttonText?: string;
  icon?: string;
}

export interface ConfirmOptions {
  variant?: DialogVariant;
  confirmText?: string;
  cancelText?: string;
  icon?: string;
}

/**
 * Get icon and colors based on dialog variant
 */
function getVariantConfig(variant: DialogVariant = 'warning') {
  const configs = {
    info: {
      icon: 'info',
      iconColor: 'text-blue-500',
      buttonColor: 'bg-blue-500 hover:bg-blue-600',
    },
    warning: {
      icon: 'alert-triangle',
      iconColor: 'text-amber-500',
      buttonColor: 'bg-amber-500 hover:bg-amber-600',
    },
    error: {
      icon: 'x-circle',
      iconColor: 'text-red-500',
      buttonColor: 'bg-red-500 hover:bg-red-600',
    },
    success: {
      icon: 'check-circle',
      iconColor: 'text-green-500',
      buttonColor: 'bg-green-600 hover:bg-green-700',
    },
    danger: {
      icon: 'alert-triangle',
      iconColor: 'text-red-500',
      buttonColor: 'bg-red-500 hover:bg-red-600',
    },
  };

  return configs[variant];
}

/**
 * Show an alert dialog (single button)
 */
export async function showAlert(
  title: string,
  message: string,
  options: AlertOptions = {}
): Promise<void> {
  const { variant = 'info', buttonText = 'OK', icon } = options;
  const config = getVariantConfig(variant);
  const iconName = icon || config.icon;

  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className =
      'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    backdrop.style.animation = 'fadeIn 0.2s ease-out';

    const modal = document.createElement('div');
    modal.className =
      'bg-background border border-border rounded-lg shadow-lg max-w-md w-full';
    modal.style.animation = 'slideIn 0.2s ease-out';

    const header = document.createElement('div');
    header.className = 'flex items-start gap-3 p-6 pb-4';

    const iconContainer = document.createElement('div');
    iconContainer.className = 'flex-shrink-0 mt-0.5';

    const iconElement = document.createElement('i');
    iconElement.setAttribute('data-lucide', iconName);
    iconElement.className = `h-6 w-6 ${config.iconColor}`;
    iconContainer.appendChild(iconElement);

    const titleElement = document.createElement('h3');
    titleElement.className = 'font-semibold text-lg text-foreground flex-1';
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

    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.className = `px-4 py-2 text-sm font-medium text-white ${config.buttonColor} rounded-md transition-colors`;
    okButton.textContent = buttonText;

    footer.appendChild(okButton);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    backdrop.appendChild(modal);

    document.body.appendChild(backdrop);

    if (window.lucide) {
      window.lucide.createIcons();
    }

    setTimeout(() => okButton.focus(), 100);

    const cleanup = () => {
      backdrop.remove();
      resolve();
    };

    okButton.addEventListener('click', cleanup);

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) {
        cleanup();
      }
    });

    document.addEventListener(
      'keydown',
      e => {
        if (e.key === 'Escape') {
          cleanup();
        }
      },
      { once: true }
    );
  });
}

/**
 * Show a confirmation dialog (two buttons)
 * Returns true if confirmed, false if canceled
 */
export async function showConfirm(
  title: string,
  message: string,
  options: ConfirmOptions = {}
): Promise<boolean> {
  const {
    variant = 'warning',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    icon,
  } = options;
  const config = getVariantConfig(variant);
  const iconName = icon || config.icon;

  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className =
      'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    backdrop.style.animation = 'fadeIn 0.2s ease-out';

    const modal = document.createElement('div');
    modal.className =
      'bg-background border border-border rounded-lg shadow-lg max-w-md w-full';
    modal.style.animation = 'slideIn 0.2s ease-out';

    const header = document.createElement('div');
    header.className = 'flex items-start gap-3 p-6 pb-4';

    const iconContainer = document.createElement('div');
    iconContainer.className = 'flex-shrink-0 mt-0.5';

    const iconElement = document.createElement('i');
    iconElement.setAttribute('data-lucide', iconName);
    iconElement.className = `h-6 w-6 ${config.iconColor}`;
    iconContainer.appendChild(iconElement);

    const titleElement = document.createElement('h3');
    titleElement.className = 'font-semibold text-lg text-foreground flex-1';
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
    confirmButton.className = `px-4 py-2 text-sm font-medium text-white ${config.buttonColor} rounded-md transition-colors`;
    confirmButton.textContent = confirmText;

    footer.appendChild(cancelButton);
    footer.appendChild(confirmButton);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    backdrop.appendChild(modal);

    document.body.appendChild(backdrop);

    if (window.lucide) {
      window.lucide.createIcons();
    }

    setTimeout(() => confirmButton.focus(), 100);

    const cleanup = (result: boolean) => {
      backdrop.remove();
      resolve(result);
    };

    confirmButton.addEventListener('click', () => cleanup(true));
    cancelButton.addEventListener('click', () => cleanup(false));

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) {
        cleanup(false);
      }
    });

    document.addEventListener(
      'keydown',
      e => {
        if (e.key === 'Escape') {
          cleanup(false);
        }
      },
      { once: true }
    );
  });
}

/**
 * Legacy compatibility wrapper for confirm()
 * Simple synchronous-looking API (though still async under the hood)
 */
export function confirmDialog(message: string): Promise<boolean> {
  return showConfirm('Confirm', message);
}

/**
 * Legacy compatibility wrapper for alert()
 */
export function alertDialog(message: string): Promise<void> {
  return showAlert('Notice', message);
}

export default {
  showAlert,
  showConfirm,
  alert: alertDialog,
  confirm: confirmDialog,
};
