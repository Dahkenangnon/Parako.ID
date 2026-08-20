import dialogService, { type DialogService } from '../utils/dialog.js';
import toastService, { type ToastService } from '../utils/toast.js';

interface UserActionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

type UserActionDialog = Pick<DialogService, 'showConfirm'>;

export class AdminUsersManager {
  private readonly debug: boolean;

  constructor(
    debug: boolean = false,
    private readonly dialog: UserActionDialog = dialogService,
    private readonly toast: ToastService = toastService
  ) {
    this.debug = debug;
  }

  private log(message: string, data?: unknown): void {
    if (!this.debug) return;
    console.log('[AdminUsers]', message, data);
  }

  private getCsrfToken(): string | null {
    return (
      document.querySelector<HTMLInputElement>('input[name="_csrf"]')?.value ??
      null
    );
  }

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
      this.toast.show('Error', 'Invalid parameters', 'error');
      return;
    }

    const actionText = action === 'enable' ? 'enable' : 'disable';
    const actionLabel =
      actionText.charAt(0).toUpperCase() + actionText.slice(1);
    const confirmed = await this.dialog.showConfirm(
      `${actionLabel} User`,
      `Are you sure you want to ${actionText} this user account?\n\nThis action can be reversed later.`,
      {
        cancelText: 'Cancel',
        confirmText: `Yes, ${actionLabel} User`,
        variant: 'warning',
      }
    );

    if (!confirmed) {
      return;
    }

    const csrfToken = this.getCsrfToken();
    if (!csrfToken) {
      this.toast.show(
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
        this.toast.show(
          'Success',
          result.message || `User ${actionText}d successfully`,
          'success'
        );
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        this.toast.show(
          'Error',
          result.error || 'Failed to update user status',
          'error'
        );
      }
    } catch (error) {
      this.log('Error toggling user status', { error });
      this.toast.show(
        'Error',
        'An error occurred while updating user status',
        'error'
      );
    }
  }

  public async anonymizeUser(userId: string, username: string): Promise<void> {
    if (
      !userId ||
      typeof userId !== 'string' ||
      !username ||
      typeof username !== 'string'
    ) {
      this.toast.show('Error', 'Invalid parameters', 'error');
      return;
    }

    const confirmed = await this.dialog.showConfirm(
      'Anonymize User - Permanent Action',
      `Are you sure you want to anonymize user "${username}"?\n\n⚠️ WARNING: This action CANNOT be undone!\n\nThis will permanently:\n• Remove all personal information\n• Replace name/email with anonymous values\n• Disable the account\n• Revoke all active sessions\n\nPlease confirm you understand this is permanent.`,
      {
        cancelText: 'Cancel',
        confirmText: 'Yes, Anonymize Permanently',
        variant: 'danger',
      }
    );

    if (!confirmed) {
      return;
    }

    const csrfToken = this.getCsrfToken();
    if (!csrfToken) {
      this.toast.show(
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
        this.toast.show(
          'Success',
          result.message || 'User anonymized successfully',
          'success'
        );
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        this.toast.show(
          'Error',
          result.error || 'Failed to anonymize user',
          'error'
        );
      }
    } catch (error) {
      this.log('Error anonymizing user', { error });
      this.toast.show(
        'Error',
        'An error occurred while anonymizing user',
        'error'
      );
    }
  }
}

export function initializeAdminUsersPage(
  dialog: UserActionDialog = dialogService
): AdminUsersManager | null {
  const { pathname } = window.location;
  if (pathname !== '/admin/users' && !pathname.startsWith('/admin/users/')) {
    return null;
  }

  const dataElement = document.getElementById('___MAIN_STATE___');
  let debug = false;

  if (dataElement) {
    try {
      const data = JSON.parse(dataElement.textContent || '{}');
      debug = data.debug || false;
    } catch {
      debug =
        document.documentElement.getAttribute('data-env') === 'development';
    }
  }

  const manager = new AdminUsersManager(debug, dialog);

  document
    .querySelectorAll<HTMLButtonElement>('[data-user-status-action]')
    .forEach(button => {
      button.addEventListener('click', () => {
        const { userId, userStatusAction } = button.dataset;
        if (
          userId &&
          (userStatusAction === 'enable' || userStatusAction === 'disable')
        ) {
          void manager.toggleUserStatus(userId, userStatusAction);
        }
      });
    });

  document
    .querySelectorAll<HTMLButtonElement>('[data-user-anonymize]')
    .forEach(button => {
      button.addEventListener('click', () => {
        const { userId, username } = button.dataset;
        if (userId && username) {
          void manager.anonymizeUser(userId, username);
        }
      });
    });

  return manager;
}

export function registerAdminUsersEntry(): void {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeAdminUsersPage(),
      { once: true }
    );
    return;
  }

  initializeAdminUsersPage();
}

if (typeof document !== 'undefined') {
  registerAdminUsersEntry();
}
