/**
 * Admin Users Management - Client-Side User Action Functionality
 *
 * This module handles user actions (enable, disable, anonymize) with
 * custom confirmation dialogs and notifications.
 *
 * SECURITY:
 * - All actions require user confirmation
 * - All actions are logged server-side with user ID, IP, timestamp
 * - CSRF token required for all API calls
 *
 * NOTE: no-undef is disabled for this file since it runs in browser context
 * and TypeScript already handles type checking for DOM types
 */

/**
 * Interface for API response
 */
interface UserActionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Admin Users Manager - Handles user action confirmation and execution
 */
class AdminUsersManager {
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Logging utility (only in debug mode)
   */
  private log(message: string, data?: any): void {
    if (!this.debug) return;
    console.log('[AdminUsers]', message, data);
  }

  /**
   * Get CSRF token from the page
   * @returns CSRF token or null if not found
   */
  private getCsrfToken(): string | null {
    const csrfInput = document.querySelector<HTMLInputElement>(
      'input[name="_csrf"]'
    );
    return csrfInput ? csrfInput.value : null;
  }

  /**
   * Create a custom confirmation dialog
   * Matches the style from admin settings
   *
   * @param title - Dialog title
   * @param message - Dialog message
   * @param confirmText - Confirm button text (default: "Confirm")
   * @param cancelText - Cancel button text (default: "Cancel")
   * @param isDanger - Whether this is a dangerous action (affects button color)
   * @returns Promise that resolves to true if confirmed, false if canceled
   */
  private async showConfirmDialog(
    title: string,
    message: string,
    confirmText: string = 'Confirm',
    cancelText: string = 'Cancel',
    isDanger: boolean = true
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
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'alert-triangle');
      icon.className = isDanger
        ? 'h-6 w-6 text-red-500'
        : 'h-6 w-6 text-amber-500';
      iconContainer.appendChild(icon);

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
          document.removeEventListener('keydown', handleEscape);
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
   * @param type - Notification type ('success', 'error', 'info')
   */
  private showNotification(
    title: string,
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ): void {
    const notificationDiv = document.createElement('div');
    let bgColor = 'bg-blue-500';
    let iconName = 'info';

    switch (type) {
      case 'success':
        bgColor = 'bg-green-500';
        iconName = 'check-circle';
        break;
      case 'error':
        bgColor = 'bg-red-500';
        iconName = 'alert-circle';
        break;
      case 'info':
        bgColor = 'bg-blue-500';
        iconName = 'info';
        break;
    }

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

    // Auto-remove after 5 seconds
    setTimeout(() => {
      notificationDiv.remove();
    }, 5000);
  }

  /**
   * Toggle user status (enable/disable)
   * @param userId - User ID
   * @param action - Action to perform ('enable' or 'disable')
   */
  public async toggleUserStatus(
    userId: string,
    action: 'enable' | 'disable'
  ): Promise<void> {
    if (
      !userId ||
      typeof userId !== 'string' ||
      !action ||
      (action !== 'enable' && action !== 'disable')
    ) {
      this.showNotification('Error', 'Invalid parameters', 'error');
      return;
    }

    const actionText = action === 'enable' ? 'enable' : 'disable';
    const confirmed = await this.showConfirmDialog(
      `${actionText.charAt(0).toUpperCase() + actionText.slice(1)} User`,
      `Are you sure you want to ${actionText} this user account?\n\nThis action can be reversed later.`,
      `Yes, ${actionText.charAt(0).toUpperCase() + actionText.slice(1)} User`,
      'Cancel',
      false
    );

    if (!confirmed) {
      return;
    }

    // Get CSRF token
    const csrfToken = this.getCsrfToken();
    if (!csrfToken) {
      this.showNotification(
        'Error',
        'CSRF token not found. Please refresh the page.',
        'error'
      );
      return;
    }

    try {
      this.log('Toggling user status', { userId, action });

      const endpoint = `/admin/users/${userId}/${action}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
      });

      const result: UserActionResponse = await response.json();

      if (result.success) {
        this.showNotification(
          'Success',
          result.message || `User ${actionText}d successfully`,
          'success'
        );
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        this.showNotification(
          'Error',
          result.error || 'Failed to update user status',
          'error'
        );
      }
    } catch (error) {
      this.log('Error toggling user status', { error });
      this.showNotification(
        'Error',
        'An error occurred while updating user status',
        'error'
      );
    }
  }

  /**
   * Anonymize user account (destructive action)
   * @param userId - User ID
   * @param username - Username (for confirmation message)
   */
  public async anonymizeUser(userId: string, username: string): Promise<void> {
    if (
      !userId ||
      typeof userId !== 'string' ||
      !username ||
      typeof username !== 'string'
    ) {
      this.showNotification('Error', 'Invalid parameters', 'error');
      return;
    }

    const confirmed = await this.showConfirmDialog(
      'Anonymize User - Permanent Action',
      `Are you sure you want to anonymize user "${username}"?\n\n⚠️ WARNING: This action CANNOT be undone!\n\nThis will permanently:\n• Remove all personal information\n• Replace name/email with anonymous values\n• Disable the account\n• Revoke all active sessions\n\nPlease confirm you understand this is permanent.`,
      'Yes, Anonymize Permanently',
      'Cancel',
      true
    );

    if (!confirmed) {
      return;
    }

    // Get CSRF token
    const csrfToken = this.getCsrfToken();
    if (!csrfToken) {
      this.showNotification(
        'Error',
        'CSRF token not found. Please refresh the page.',
        'error'
      );
      return;
    }

    try {
      this.log('Anonymizing user', { userId, username });

      const endpoint = `/admin/users/${userId}`;

      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
      });

      const result: UserActionResponse = await response.json();

      if (result.success) {
        this.showNotification(
          'Success',
          result.message || 'User anonymized successfully',
          'success'
        );
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        this.showNotification(
          'Error',
          result.error || 'Failed to anonymize user',
          'error'
        );
      }
    } catch (error) {
      this.log('Error anonymizing user', { error });
      this.showNotification(
        'Error',
        'An error occurred while anonymizing user',
        'error'
      );
    }
  }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const isAdminUsers = window.location.pathname.includes('/admin/users');

  if (isAdminUsers) {
    const dataElement = document.getElementById('___MAIN_STATE___');
    let debug = false;

    if (dataElement) {
      try {
        const data = JSON.parse(dataElement.textContent || '{}');
        debug = data.debug || false;
      } catch {
        // Fallback: check if development environment (JSON parse failed)
        debug =
          document.documentElement.getAttribute('data-env') === 'development';
      }
    }

    const adminUsersManager = new AdminUsersManager(debug);

    // Make functions globally accessible for inline event handlers
    (window as any).toggleUserStatus = (
      userId: string,
      action: 'enable' | 'disable'
    ) => {
      adminUsersManager.toggleUserStatus(userId, action);
    };

    (window as any).anonymizeUser = (userId: string, username: string) => {
      adminUsersManager.anonymizeUser(userId, username);
    };

    (window as any).adminUsersManager = adminUsersManager;
  }
});
