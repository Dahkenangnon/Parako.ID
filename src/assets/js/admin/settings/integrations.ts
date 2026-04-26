/**
 * Admin Integrations Settings Module
 *
 * Handles integrations settings page functionality:
 * - Form reset with confirmation
 * - Email SMTP configuration validation
 * - URL configuration validation
 * - Test email functionality
 * - Custom notification system
 */
(function () {
  'use strict';

  interface LucideApi {
    createIcons: () => void;
  }

  interface WindowWithLucide {
    lucide?: LucideApi;
    resetForm: () => Promise<void>;
    testEmail: (event: Event) => Promise<void>;
  }

  class IntegrationsSettingsManager {
    private form: HTMLFormElement | null = null;

    public initialize(): void {
      this.form = document.querySelector('form');
      this.setupFormValidation();
      this.exposeGlobalMethods();
    }

    private setupFormValidation(): void {
      if (!this.form) return;

      this.form.addEventListener('submit', async e => {
        const isValid = await this.validateForm();
        if (!isValid) {
          e.preventDefault();
        }
      });
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
      const testEmailInput = document.getElementById(
        'test-email'
      ) as HTMLInputElement | null;
      const testEmail = testEmailInput?.value;

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

      const testButton = event.target as HTMLButtonElement;
      const originalButtonHtml = testButton.innerHTML;
      testButton.disabled = true;
      testButton.innerHTML =
        '<i data-lucide="loader-2" class="h-4 w-4 mr-2 animate-spin"></i>Sending...';

      this.refreshIcons();

      try {
        const csrfInput = document.querySelector(
          'input[name="_csrf"]'
        ) as HTMLInputElement | null;
        const response = await fetch(
          '/admin/settings/integrations/test-email',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfInput?.value || '',
            },
            body: JSON.stringify({ email: testEmail }),
          }
        );

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
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      isDanger = false
    ): Promise<boolean> {
      return new Promise(resolve => {
        const backdrop = document.createElement('div');
        backdrop.className =
          'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';

        const modal = document.createElement('div');
        modal.className = 'bg-background border border-border max-w-md w-full';

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
          'px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80';
        cancelButton.textContent = cancelText;

        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        const buttonColor = isDanger
          ? 'bg-red-600 hover:bg-red-700'
          : 'bg-primary hover:bg-primary/90';
        confirmButton.className = `px-4 py-2 text-sm font-medium text-white ${buttonColor}`;
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

        this.refreshIcons();

        confirmButton.focus();
      });
    }

    private showNotification(
      title: string,
      message: string,
      type: 'info' | 'success' | 'error' = 'info'
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
      const win = window as unknown as WindowWithLucide;
      if (win.lucide && typeof win.lucide.createIcons === 'function') {
        win.lucide.createIcons();
      }
    }

    private exposeGlobalMethods(): void {
      const win = window as unknown as WindowWithLucide;
      win.resetForm = this.resetForm.bind(this);
      win.testEmail = this.testEmail.bind(this);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new IntegrationsSettingsManager().initialize();
  });
})();
