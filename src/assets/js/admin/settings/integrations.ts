import { confirmCriticalSettingsChange } from './critical-change.js';

export type CriticalChangeConfirmer = (event: Event) => Promise<boolean>;

let dialogIdSequence = 0;

export class IntegrationsSettingsManager {
  private form: HTMLFormElement | null = null;
  private submissionPending = false;

  private readonly confirmCriticalChange: CriticalChangeConfirmer;

  public constructor(confirmCriticalChange?: CriticalChangeConfirmer) {
    this.confirmCriticalChange =
      confirmCriticalChange ??
      (event =>
        confirmCriticalSettingsChange(
          event,
          (title, message, confirmText, cancelText) =>
            this.showConfirmDialog(title, message, confirmText, cancelText)
        ));
  }

  public initialize(): void {
    this.form = document.querySelector('form[data-integrations-settings]');
    this.setupDeclarativeHandlers();
  }

  private setupDeclarativeHandlers(): void {
    this.form?.addEventListener('submit', async event => {
      event.preventDefault();
      await this.handleSubmit(event);
    });

    document
      .querySelector<HTMLButtonElement>('button[data-integrations-reset]')
      ?.addEventListener('click', async () => {
        await this.resetForm();
      });

    document
      .querySelector<HTMLButtonElement>('button[data-integrations-test-email]')
      ?.addEventListener('click', async event => {
        await this.testEmail(event);
      });
  }

  private async handleSubmit(event: Event): Promise<void> {
    if (this.submissionPending) return;
    this.submissionPending = true;

    try {
      if (!(await this.validateForm())) return;

      await this.confirmCriticalChange(event);
    } catch (error) {
      console.error('Failed to confirm integrations settings change', error);
      this.showNotification(
        'Unable to Save',
        'The configuration change could not be confirmed. Please try again.',
        'error'
      );
    } finally {
      this.submissionPending = false;
    }
  }

  private async validateForm(): Promise<boolean> {
    const smtpHost = (
      document.getElementById(
        'integrations.email.smtp_host'
      ) as HTMLInputElement | null
    )?.value;
    const smtpPort = (
      document.getElementById(
        'integrations.email.smtp_port'
      ) as HTMLInputElement | null
    )?.value;
    const smtpUsername = (
      document.getElementById(
        'integrations.email.smtp_username'
      ) as HTMLInputElement | null
    )?.value;
    const smtpPassword = (
      document.getElementById(
        'integrations.email.smtp_password'
      ) as HTMLInputElement | null
    )?.value;
    const fromEmail = (
      document.getElementById(
        'integrations.email.from'
      ) as HTMLInputElement | null
    )?.value;

    if (
      !smtpHost ||
      !smtpPort ||
      !smtpUsername ||
      !smtpPassword ||
      !fromEmail
    ) {
      this.showNotification(
        'Validation Error',
        'All email configuration fields are required. Please fill in all fields.',
        'error'
      );
      return false;
    }

    const website = (
      document.getElementById(
        'integrations.urls.website'
      ) as HTMLInputElement | null
    )?.value;
    const contact = (
      document.getElementById(
        'integrations.urls.contact'
      ) as HTMLInputElement | null
    )?.value;
    const privacyPolicy = (
      document.getElementById(
        'integrations.urls.privacy_policy'
      ) as HTMLInputElement | null
    )?.value;
    const termsOfService = (
      document.getElementById(
        'integrations.urls.terms_of_service'
      ) as HTMLInputElement | null
    )?.value;

    if (!website || !contact || !privacyPolicy || !termsOfService) {
      this.showNotification(
        'Validation Error',
        'All URL configuration fields are required. Please fill in all fields.',
        'error'
      );
      return false;
    }

    return true;
  }

  public async resetForm(): Promise<void> {
    const confirmed = await this.showConfirmDialog(
      'Reset Form',
      'Are you sure you want to reset the form?\n\nAll unsaved changes will be lost.',
      'Yes, Reset Form',
      'Cancel'
    );

    if (confirmed) {
      this.form?.reset();
      this.showNotification(
        'Form Reset',
        'All form fields have been reset to their original values.',
        'info'
      );
    }
  }

  public async testEmail(event: Event): Promise<void> {
    const testButton = (event.currentTarget ??
      event.target) as HTMLButtonElement;
    const testEmailInput = document.getElementById(
      'test-email'
    ) as HTMLInputElement | null;
    const testEmail = testEmailInput?.value.trim();

    if (!testEmail) {
      this.showNotification(
        'Email Required',
        'Please enter a test email address.',
        'error'
      );
      testEmailInput?.focus();
      return;
    }

    const confirmed = await this.showConfirmDialog(
      'Send Test Email',
      `Send a test email to:\n${testEmail}\n\nThis will test your current SMTP configuration.`,
      'Yes, Send Test',
      'Cancel'
    );

    if (!confirmed) {
      return;
    }

    const originalButtonHtml = testButton.innerHTML;
    testButton.disabled = true;
    testButton.innerHTML =
      '<i data-lucide="loader-2" class="h-4 w-4 mr-2 animate-spin"></i>Sending...';

    this.refreshIcons();

    try {
      const csrfInput = document.querySelector(
        'input[name="_csrf"]'
      ) as HTMLInputElement | null;
      const response = await fetch('/admin/settings/integrations/test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfInput?.value || '',
        },
        body: JSON.stringify({ email: testEmail }),
      });

      const data = await response.json();

      if (data.success) {
        this.showNotification(
          'Test Email Sent',
          `Test email sent successfully to ${testEmail}. Please check your inbox.`,
          'success'
        );
      } else {
        this.showNotification(
          'Email Send Failed',
          data.error ||
            'Failed to send test email. Please check your SMTP configuration.',
          'error'
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.showNotification(
        'Network Error',
        `Failed to send test email: ${errorMessage}`,
        'error'
      );
    } finally {
      testButton.disabled = false;
      testButton.innerHTML = originalButtonHtml;
      this.refreshIcons();
    }
  }

  private showConfirmDialog(
    title: string,
    message: string,
    confirmText: string,
    cancelText: string
  ): Promise<boolean> {
    return new Promise(resolve => {
      const dialogId = ++dialogIdSequence;
      const titleId = `integrations-dialog-title-${dialogId}`;
      const messageId = `integrations-dialog-message-${dialogId}`;
      const backdrop = document.createElement('div');
      backdrop.className =
        'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';

      const modal = document.createElement('div');
      modal.className = 'bg-background border border-border max-w-md w-full';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', titleId);
      modal.setAttribute('aria-describedby', messageId);

      const header = document.createElement('div');
      header.className = 'flex items-start gap-3 p-6 pb-4';

      const iconContainer = document.createElement('div');
      iconContainer.className = 'flex-shrink-0 mt-0.5';
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'alert-triangle');
      icon.className = 'h-6 w-6 text-amber-500';
      iconContainer.appendChild(icon);

      const titleElement = document.createElement('h3');
      titleElement.setAttribute('id', titleId);
      titleElement.className = 'font-semibold text-lg flex-1';
      titleElement.textContent = title;

      header.appendChild(iconContainer);
      header.appendChild(titleElement);

      const body = document.createElement('div');
      body.className = 'px-6 pb-4';
      const messageElement = document.createElement('p');
      messageElement.setAttribute('id', messageId);
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
        'px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80';
      cancelButton.textContent = cancelText;

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className =
        'px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90';
      confirmButton.textContent = confirmText;

      footer.appendChild(cancelButton);
      footer.appendChild(confirmButton);

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      backdrop.appendChild(modal);

      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        backdrop.remove();
        document.removeEventListener('keydown', handleEscape);
        resolve(result);
      };

      cancelButton.addEventListener('click', () => {
        finish(false);
      });

      confirmButton.addEventListener('click', () => {
        finish(true);
      });

      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) {
          finish(false);
        }
      });

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          finish(false);
        }
      };

      document.addEventListener('keydown', handleEscape);

      document.body.appendChild(backdrop);

      this.refreshIcons();

      cancelButton.focus();
    });
  }

  private showNotification(
    title: string,
    message: string,
    type: 'info' | 'success' | 'error' = 'info'
  ): void {
    const notificationDiv = document.createElement('div');
    notificationDiv.setAttribute('role', type === 'error' ? 'alert' : 'status');
    notificationDiv.setAttribute(
      'aria-live',
      type === 'error' ? 'assertive' : 'polite'
    );
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

    notificationDiv.className = `fixed top-4 right-4 ${bgColor} text-white px-4 py-3 z-50 max-w-md`;

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
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', `Dismiss ${title} notification`);
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

    this.refreshIcons();

    setTimeout(() => {
      notificationDiv.remove();
    }, 5000);
  }

  private refreshIcons(): void {
    if (typeof window.lucide?.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }
}

export function initializeIntegrationsSettingsPage(
  confirmCriticalChange?: CriticalChangeConfirmer
): IntegrationsSettingsManager | null {
  const root = '/admin/settings/integrations';
  const { pathname } = window.location;
  if (pathname !== root && !pathname.startsWith(root + '/')) {
    return null;
  }

  const manager = new IntegrationsSettingsManager(confirmCriticalChange);
  manager.initialize();
  return manager;
}

export function registerIntegrationsSettingsEntry(): void {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeIntegrationsSettingsPage(),
      { once: true }
    );
    return;
  }

  initializeIntegrationsSettingsPage();
}

if (typeof document !== 'undefined') {
  registerIntegrationsSettingsEntry();
}
