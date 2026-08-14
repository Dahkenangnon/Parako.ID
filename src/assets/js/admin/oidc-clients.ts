/**
 * Admin OIDC Clients Management - Client-Side Functionality
 *
 * This module handles OIDC client actions (deactivate, delete, regenerate secret) with
 * custom confirmation dialogs and notifications.
 *
 * SECURITY:
 * - All actions require user confirmation
 * - All actions are logged server-side
 * - CSRF token required for all API calls
 *
 * NOTE: no-undef is disabled for this file since it runs in browser context
 * and TypeScript already handles type checking for DOM types
 */

/**
 * Admin OIDC Clients Manager - Handles client action confirmation and execution
 */
class AdminOidcClientsManager {
  private dialogSequence = 0;

  /** Attach CSP-safe handlers to server-rendered client actions. */
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
            void this.copyToClipboard(value, trigger);
          }
        });
      });
  }

  /**
   * Create a custom confirmation dialog
   * Matches the style from admin settings
   *
   * @param title - Dialog title
   * @param message - Dialog message
   * @param confirmText - Confirm button text
   * @param cancelText - Cancel button text
   * @param isDanger - Whether this is a dangerous action (affects button color)
   * @returns Promise that resolves to true if confirmed, false if canceled
   */
  private async showConfirmDialog(
    title: string,
    message: string,
    confirmText: string,
    cancelText: string,
    isDanger: boolean
  ): Promise<boolean> {
    return new Promise(resolve => {
      const previouslyFocused = document.activeElement as HTMLElement | null;
      const dialogId = `oidc-client-confirm-${++this.dialogSequence}`;
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
      icon.className = isDanger
        ? 'h-6 w-6 text-red-500'
        : 'h-6 w-6 text-amber-500';
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

      const cleanup = () => {
        backdrop.remove();
        document.removeEventListener('keydown', handleEscape);
        if (
          previouslyFocused &&
          typeof previouslyFocused.focus === 'function'
        ) {
          previouslyFocused.focus();
        }
      };

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
          resolve(false);
        }
      };
      document.addEventListener('keydown', handleEscape);

      document.body.appendChild(backdrop);

      const lucideWindow = window as any;
      if (
        lucideWindow.lucide &&
        typeof lucideWindow.lucide.createIcons === 'function'
      ) {
        lucideWindow.lucide.createIcons();
      }

      confirmButton.focus();
    });
  }

  /**
   * Show a notification message to the user
   * @param title - Notification title
   * @param message - Notification message
   * @param type - Notification type ('success' or 'error')
   */
  private showNotification(
    title: string,
    message: string,
    type: 'success' | 'error'
  ): void {
    const notificationDiv = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
    const iconName = type === 'success' ? 'check-circle' : 'alert-circle';

    notificationDiv.className = `fixed top-4 right-4 ${bgColor} text-white px-4 py-3 rounded-lg shadow-lg z-50 max-w-md`;

    const flexContainer = document.createElement('div');
    flexContainer.className = 'flex items-start gap-3';

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', iconName);
    icon.className = 'h-5 w-5 flex-shrink-0 mt-0.5';

    const contentContainer = document.createElement('div');
    contentContainer.className = 'flex-1';

    const titleElement = document.createElement('p');
    titleElement.className = 'font-semibold';
    titleElement.textContent = title;

    const messageElement = document.createElement('p');
    messageElement.className = 'text-sm mt-1';
    messageElement.textContent = message;

    const closeButton = document.createElement('button');
    closeButton.className = 'text-white/80 hover:text-white';
    const closeIcon = document.createElement('i');
    closeIcon.setAttribute('data-lucide', 'x');
    closeIcon.className = 'h-4 w-4';
    closeButton.appendChild(closeIcon);

    closeButton.addEventListener('click', () => notificationDiv.remove());

    contentContainer.appendChild(titleElement);
    contentContainer.appendChild(messageElement);
    flexContainer.appendChild(icon);
    flexContainer.appendChild(contentContainer);
    flexContainer.appendChild(closeButton);
    notificationDiv.appendChild(flexContainer);
    document.body.appendChild(notificationDiv);

    const lucideWindow = window as any;
    if (
      lucideWindow.lucide &&
      typeof lucideWindow.lucide.createIcons === 'function'
    ) {
      lucideWindow.lucide.createIcons();
    }

    setTimeout(() => {
      notificationDiv.remove();
    }, 5000);
  }

  /**
   * Confirm and submit deactivate client action
   * @param event - Form submit event
   */
  public async confirmDeactivateClient(event: Event): Promise<boolean> {
    const form = (event.currentTarget ?? event.target) as HTMLFormElement;
    event.preventDefault();

    const confirmed = await this.showConfirmDialog(
      'Deactivate OIDC Client',
      'Are you sure you want to deactivate this client?\n\nThe client will no longer be able to authenticate until reactivated.',
      'Yes, Deactivate',
      'Cancel',
      false
    );

    if (confirmed) {
      form.submit();
    }

    return confirmed;
  }

  /**
   * Confirm and submit delete client action
   * @param event - Form submit event
   */
  public async confirmDeleteClient(event: Event): Promise<boolean> {
    const form = (event.currentTarget ?? event.target) as HTMLFormElement;
    event.preventDefault();

    const confirmed = await this.showConfirmDialog(
      'Delete OIDC Client - Permanent Action',
      '⚠️ WARNING: This action CANNOT be undone!\n\nDeleting this client will:\n• Permanently remove all client data\n• Invalidate all active tokens\n• Break any applications using this client\n\nAre you absolutely sure?',
      'Yes, Delete Permanently',
      'Cancel',
      true
    );

    if (confirmed) {
      form.submit();
    }

    return confirmed;
  }

  /**
   * Confirm and submit regenerate secret action
   * @param event - Form submit event
   */
  public async confirmRegenerateSecret(event: Event): Promise<boolean> {
    const form = (event.currentTarget ?? event.target) as HTMLFormElement;
    event.preventDefault();

    const confirmed = await this.showConfirmDialog(
      'Regenerate Client Secret',
      '⚠️ WARNING: This will invalidate the current secret!\n\nRegenerating the secret will:\n• Invalidate the current client secret\n• Require updating the secret in all applications\n• May temporarily break authentication\n\nMake sure you have a plan to update your applications.',
      'Yes, Regenerate Secret',
      'Cancel',
      true
    );

    if (confirmed) {
      form.submit();
    }

    return confirmed;
  }

  /**
   * Copy text to clipboard with feedback
   * @param text - Text to copy
   * @param triggerElement - The element that triggered the copy (for visual feedback)
   */
  public async copyToClipboard(
    text: string,
    triggerElement?: HTMLElement
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);

      const button = triggerElement?.closest('button') ?? null;
      if (button) {
        const originalIcon = button.innerHTML;
        button.innerHTML = '<i data-lucide="check" class="h-4 w-4"></i>';
        button.classList.add('text-green-600');

        const lucideWindow = window as any;
        if (
          lucideWindow.lucide &&
          typeof lucideWindow.lucide.createIcons === 'function'
        ) {
          lucideWindow.lucide.createIcons();
        }

        setTimeout(() => {
          button.innerHTML = originalIcon;
          button.classList.remove('text-green-600');
          if (
            lucideWindow.lucide &&
            typeof lucideWindow.lucide.createIcons === 'function'
          ) {
            lucideWindow.lucide.createIcons();
          }
        }, 2000);
      }

      this.showNotification(
        'Copied!',
        'Copied to clipboard successfully.',
        'success'
      );
    } catch (err) {
      console.error('Could not copy text: ', err);
      this.showNotification(
        'Copy Failed',
        'Failed to copy to clipboard. Please copy manually.',
        'error'
      );
    }
  }
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const oidcClientsPath = '/admin/oidc-clients';
    const isAdminOidcClients =
      window.location.pathname === oidcClientsPath ||
      window.location.pathname.startsWith(`${oidcClientsPath}/`);

    if (isAdminOidcClients) {
      const adminOidcClientsManager = new AdminOidcClientsManager();
      adminOidcClientsManager.initialize();

      // The detail-form module reuses the manager's secret-copy feedback.
      (window as any).adminOidcClientsManager = adminOidcClientsManager;
    }
  });
}
