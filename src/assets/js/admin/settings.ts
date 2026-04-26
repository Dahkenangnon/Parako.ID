/**
 * Admin Settings Management - Client-Side Secret Reveal Functionality
 *
 * This module handles revealing and masking sensitive configuration values
 * in the admin settings panel. All reveal operations are audited server-side.
 *
 * SECURITY:
 * - Reveal actions require user confirmation
 * - All reveals are logged with user ID, IP, timestamp
 * - Rate limited to 10 reveals per minute per admin
 * - CSRF token required for all API calls
 * - No sensitive data logged to console
 * - Auto-remask after 2 minutes of inactivity
 * - Revealed values are invisible (same color as background) when not focused to prevent shoulder surfing
 *
 * NOTE: no-undef is disabled for this file since it runs in browser context
 * and TypeScript already handles type checking for DOM types
 */

/**
 * Interface for reveal secret API response
 */
interface RevealSecretResponse {
  success: boolean;
  value?: string | string[];
  error?: string;
}

/**
 * Admin Settings Manager - Handles secret reveal/mask functionality
 */
class AdminSettingsManager {
  private debug: boolean;
  private inactivityTimer: any = null;
  private readonly INACTIVITY_TIMEOUT = 0.5 * 60 * 1000; // 2 minutes of inactivity, 30 second for testing
  private revealedFields: Set<string> = new Set();

  constructor(debug: boolean = false) {
    this.debug = debug;
    this.setupInactivityMonitoring();
  }

  /**
   * Logging utility (only in debug mode, never logs sensitive data)
   */
  private log(message: string, data?: any): void {
    if (!this.debug) return;
    console.log('[AdminSettings]', message, data);
  }

  /**
   * Setup inactivity monitoring to auto-remask secrets after period of no activity
   */
  private setupInactivityMonitoring(): void {
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ];

    events.forEach(event => {
      document.addEventListener(event, () => this.resetInactivityTimer(), true);
    });

    this.resetInactivityTimer();
  }

  /**
   * Reset the inactivity timer
   */
  private resetInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = setTimeout(() => {
      this.autoRemaskAllSecrets();
    }, this.INACTIVITY_TIMEOUT);
  }

  /**
   * Automatically re-mask all revealed secrets due to inactivity
   */
  private autoRemaskAllSecrets(): void {
    if (this.revealedFields.size === 0) {
      return;
    }

    this.log('Auto-remasking secrets due to inactivity', {
      count: this.revealedFields.size,
    });

    const fieldsToRemask = Array.from(this.revealedFields);

    fieldsToRemask.forEach(fieldId => {
      this.remaskSecret(fieldId);
    });

    this.showNotification(
      'Secrets Auto-Masked',
      'Revealed secrets have been automatically masked due to inactivity.',
      'shield-alert'
    );
  }

  /**
   * Show a notification message to the user
   * @param title - Notification title
   * @param message - Notification message
   * @param iconName - Lucide icon name (default: 'info')
   */
  private showNotification(
    title: string,
    message: string,
    iconName: string = 'info'
  ): void {
    const notificationDiv = document.createElement('div');
    notificationDiv.className =
      'fixed top-4 right-4 bg-amber-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 max-w-md';

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

    contentContainer.appendChild(titleElement);
    contentContainer.appendChild(messageElement);
    flexContainer.appendChild(icon);
    flexContainer.appendChild(contentContainer);
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
   * Apply invisible text style to field (same color as background)
   * This prevents shoulder surfing when field is not focused
   */
  private applyInvisibleStyle(
    field: HTMLInputElement | HTMLTextAreaElement
  ): void {
    field.setAttribute('data-invisible-style', 'true');
    field.style.color = 'transparent';
    field.style.caretColor = '#f97316'; // Orange caret for visibility when typing
  }

  /**
   * Remove invisible text style from field
   */
  private removeInvisibleStyle(
    field: HTMLInputElement | HTMLTextAreaElement
  ): void {
    field.removeAttribute('data-invisible-style');
    field.style.color = '';
    field.style.caretColor = '';
  }

  /**
   * Setup focus/blur handlers for invisible text on revealed field
   */
  private setupInvisibleTextHandlers(
    field: HTMLInputElement | HTMLTextAreaElement
  ): void {
    // On focus, make text visible
    field.addEventListener('focus', event => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement;
      if (target.getAttribute('data-invisible-style') === 'true') {
        this.removeInvisibleStyle(target);
      }
    });

    // On blur, make text invisible again (if field is still revealed)
    field.addEventListener('blur', event => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement;
      if (!target.hasAttribute('readonly')) {
        this.applyInvisibleStyle(target);
      }
    });
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
   * Safely update button content with icon and text
   * @param button - The button element to update
   * @param iconName - Lucide icon name
   * @param text - Button text
   * @param iconClass - Additional icon classes (default: 'h-3 w-3 inline mr-1')
   */
  private updateButtonContent(
    button: HTMLButtonElement,
    iconName: string,
    text: string,
    iconClass: string = 'h-3 w-3 inline mr-1'
  ): void {
    button.textContent = '';

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', iconName);
    icon.className = iconClass;

    const textNode = document.createTextNode(' ' + text);

    button.appendChild(icon);
    button.appendChild(textNode);

    // Re-initialize Lucide icons
    const lucideWindow = window as any;
    if (
      lucideWindow.lucide &&
      typeof lucideWindow.lucide.createIcons === 'function'
    ) {
      lucideWindow.lucide.createIcons();
    }
  }

  /**
   * Create a custom confirmation dialog
   * Replaces native confirm() with a styled modal
   *
   * @param title - Dialog title
   * @param message - Dialog message
   * @param confirmText - Confirm button text (default: "Confirm")
   * @param cancelText - Cancel button text (default: "Cancel")
   * @returns Promise that resolves to true if confirmed, false if canceled
   */
  private async showConfirmDialog(
    title: string,
    message: string,
    confirmText: string = 'Confirm',
    cancelText: string = 'Cancel'
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
      icon.className = 'h-6 w-6 text-amber-500';
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
   * Show error message to user
   * @param message - Error message to display (uses textContent for safety)
   */
  private showError(message: string): void {
    const errorDiv = document.createElement('div');
    errorDiv.className =
      'fixed top-4 right-4 bg-destructive text-destructive-foreground px-4 py-3 rounded-lg shadow-lg z-50 max-w-md';

    const flexContainer = document.createElement('div');
    flexContainer.className = 'flex items-start gap-3';

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'alert-circle');
    icon.className = 'h-5 w-5 flex-shrink-0 mt-0.5';

    const contentContainer = document.createElement('div');
    contentContainer.className = 'flex-1';

    const titleElement = document.createElement('p');
    titleElement.className = 'font-semibold';
    titleElement.textContent = 'Error';

    const messageElement = document.createElement('p');
    messageElement.className = 'text-sm mt-1';
    messageElement.textContent = message;

    const closeButton = document.createElement('button');
    closeButton.className =
      'error-close-btn text-destructive-foreground/80 hover:text-destructive-foreground';
    const closeIcon = document.createElement('i');
    closeIcon.setAttribute('data-lucide', 'x');
    closeIcon.className = 'h-4 w-4';
    closeButton.appendChild(closeIcon);

    closeButton.addEventListener('click', () => errorDiv.remove());

    contentContainer.appendChild(titleElement);
    contentContainer.appendChild(messageElement);
    flexContainer.appendChild(icon);
    flexContainer.appendChild(contentContainer);
    flexContainer.appendChild(closeButton);
    errorDiv.appendChild(flexContainer);
    document.body.appendChild(errorDiv);

    // Re-initialize Lucide icons
    const lucideWindow = window as any;
    if (
      lucideWindow.lucide &&
      typeof lucideWindow.lucide.createIcons === 'function'
    ) {
      lucideWindow.lucide.createIcons();
    }

    // Auto-remove after 5 seconds
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
  }

  /**
   * Reveal and enable editing of a secret field
   * Makes an API call to retrieve the actual (unmasked) secret value
   *
   * @param fieldId - The DOM id of the field
   * @param fieldPath - The configuration path (e.g., 'security.secrets.jwt_secret')
   */
  public async revealSecret(fieldId: string, fieldPath: string): Promise<void> {
    // Validate inputs to prevent injection
    if (
      !fieldId ||
      typeof fieldId !== 'string' ||
      !fieldPath ||
      typeof fieldPath !== 'string'
    ) {
      this.showError('Invalid field parameters');
      return;
    }

    const confirmed = await this.showConfirmDialog(
      'Reveal Secret - Security Warning',
      'WARNING: Revealing secrets is audited.\n\n' +
        'This action will be logged with your user ID, IP address, and timestamp.\n\n' +
        'Do you want to continue?',
      'Yes, Reveal Secret',
      'Cancel'
    );

    if (!confirmed) {
      return;
    }

    const field = document.getElementById(fieldId) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    const button = field?.parentElement?.querySelector('button');

    if (!field || !button) {
      this.showError('Could not find field or button element');
      return;
    }

    // Get CSRF token
    const csrfToken = this.getCsrfToken();
    if (!csrfToken) {
      this.showError('CSRF token not found. Please refresh the page.');
      return;
    }

    button.disabled = true;
    this.updateButtonContent(
      button as HTMLButtonElement,
      'loader-2',
      'Loading...',
      'h-3 w-3 inline mr-1 animate-spin'
    );

    try {
      // Make API call to reveal secret
      const response = await fetch('/admin/settings/reveal-secret', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ fieldPath }),
      });

      const data: RevealSecretResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Server returned ${response.status}`);
      }

      // Successfully retrieved secret value
      if (data.value !== undefined) {
        const maskedValue = field.value;
        field.setAttribute('data-masked-value', maskedValue);

        if (Array.isArray(data.value)) {
          // For arrays (like cookie_secrets), join with newlines
          field.value = data.value.join('\n');
        } else {
          field.value = String(data.value);
        }

        field.removeAttribute('readonly');
        field.classList.remove('bg-muted');
        field.classList.add('bg-background', 'border-orange-400');

        this.revealedFields.add(fieldId);

        this.setupInvisibleTextHandlers(field);

        field.focus();

        // Change button to "Re-mask" using safe DOM manipulation
        button.disabled = false;
        this.updateButtonContent(
          button as HTMLButtonElement,
          'eye-off',
          'Re-mask'
        );

        button.onclick = () => {
          this.remaskSecret(fieldId);
        };

        this.log('Secret revealed successfully', { fieldPath });

        this.resetInactivityTimer();
      } else {
        throw new Error('No value returned from server');
      }
    } catch (error) {
      this.log('Failed to reveal secret', { error });

      let errorMessage = 'Failed to reveal secret. ';
      if (error instanceof Error) {
        if (
          error.message.includes('429') ||
          error.message.includes('Too many')
        ) {
          errorMessage +=
            'Too many requests. Please wait a moment and try again.';
        } else if (
          error.message.includes('403') ||
          error.message.includes('Invalid field')
        ) {
          errorMessage += 'Invalid field or permission denied.';
        } else if (error.message.includes('401')) {
          errorMessage += 'Session expired. Please refresh the page.';
        } else {
          errorMessage += 'Please try again.';
        }
      } else {
        errorMessage += 'Please try again.';
      }

      this.showError(errorMessage);

      button.disabled = false;
      this.updateButtonContent(button as HTMLButtonElement, 'eye', 'Reveal');
    }
  }

  /**
   * Re-mask a secret field (restore readonly state)
   * Does not make an API call - simply restores the masked display
   *
   * @param fieldId - The DOM id of the field
   */
  public remaskSecret(fieldId: string): void {
    if (!fieldId || typeof fieldId !== 'string') {
      this.showError('Invalid field parameter');
      return;
    }

    const field = document.getElementById(fieldId) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    const button = field?.parentElement?.querySelector('button');

    if (!field || !button) {
      this.showError('Could not find field or button element');
      return;
    }

    this.revealedFields.delete(fieldId);

    this.removeInvisibleStyle(field);

    const maskedValue = field.getAttribute('data-masked-value');
    if (maskedValue) {
      field.value = maskedValue;
      field.removeAttribute('data-masked-value');
    }

    field.setAttribute('readonly', 'readonly');
    field.classList.add('bg-muted');
    field.classList.remove('bg-background', 'border-orange-400');

    const fieldPath = field.getAttribute('data-field-path');
    this.updateButtonContent(button as HTMLButtonElement, 'eye', 'Reveal');

    button.onclick = () => {
      this.revealSecret(fieldId, fieldPath || '');
    };

    this.log('Secret re-masked', { fieldId });
  }

  /**
   * Confirm critical configuration changes
   * Shows a confirmation dialog with warnings about the impact of changes
   *
   * @param event - The form submit event
   * @returns Promise<boolean> - true to allow submission, false to cancel
   */
  public async confirmCriticalChange(event: Event): Promise<boolean> {
    const form = event.target as HTMLFormElement;

    event.preventDefault();

    // Identify section from form action or data attribute
    const formAction = form.action || '';
    let section = 'unknown';
    let sectionTitle = 'Configuration';
    let warnings: string[] = [];

    if (formAction.includes('/settings/security/secrets')) {
      section = 'security-secrets';
      sectionTitle = 'Security Secrets';
      warnings = [
        '• Changing JWT secrets will invalidate all existing tokens',
        '• Changing cookie secrets will log out all users',
        '• All users will need to re-authenticate',
      ];
    } else if (formAction.includes('/settings/security/mfa')) {
      section = 'security-mfa';
      sectionTitle = 'MFA Configuration';
      warnings = [
        '• Disabling MFA methods may lock out users relying on them',
        '• WebAuthn changes affect passkey registration',
        '• Ensure you have tested the new configuration',
      ];
    } else if (formAction.includes('/settings/security/sessions')) {
      section = 'security-sessions';
      sectionTitle = 'Session Configuration';
      warnings = [
        '• Session timeout changes affect active sessions',
        '• Binding changes may invalidate current sessions',
        '• Ensure you have tested the new configuration',
      ];
    } else if (formAction.includes('/settings/security/protection')) {
      section = 'security-protection';
      sectionTitle = 'Protection Configuration';
      warnings = [
        '• Rate limiting changes take effect immediately',
        '• Device matching changes affect login verification',
        '• Ensure you have tested the new configuration',
      ];
    } else if (formAction.includes('/settings/security')) {
      section = 'security-authentication';
      sectionTitle = 'Authentication Configuration';
      warnings = [
        '• Login method changes affect how users sign in',
        '• Password policy changes apply to new passwords only',
        '• Registration changes take effect immediately',
      ];
    } else if (formAction.includes('/settings/oidc')) {
      section = 'oidc';
      sectionTitle = 'OIDC Configuration';
      warnings = [
        '• Changing the OIDC issuer will break all OIDC clients',
        '• Token TTL changes affect active tokens',
        '• JWKS changes require client updates',
        '• May require OIDC client reconfiguration',
      ];
    } else if (formAction.includes('/settings/integrations')) {
      section = 'integrations';
      sectionTitle = 'Integrations Configuration';
      warnings = [
        '• Email configuration changes affect password resets',
        '• OAuth client changes may break social login',
        '• Test connections before saving',
      ];
    }

    const validationWarningsInput = form.querySelector<HTMLInputElement>(
      'input[name="validation_warnings"]'
    );
    if (validationWarningsInput && validationWarningsInput.value) {
      try {
        const serverWarnings = JSON.parse(validationWarningsInput.value);
        if (Array.isArray(serverWarnings)) {
          warnings.push('', 'Server Validation Warnings:');
          serverWarnings.forEach((warning: string) => {
            warnings.push(`• ${warning}`);
          });
        }
      } catch {}
    }

    const message =
      `You are about to save changes to ${sectionTitle}.\n\n` +
      `IMPORTANT: This action may have significant impact:\n\n` +
      warnings.join('\n') +
      '\n\n' +
      `Are you sure you want to proceed?`;

    const confirmed = await this.showConfirmDialog(
      `Confirm ${sectionTitle} Changes`,
      message,
      'Yes, Save Changes',
      'Cancel'
    );

    if (confirmed) {
      this.log('Critical change confirmed', { section });

      // Submit the form programmatically
      form.submit();
      return true;
    } else {
      this.log('Critical change cancelled by user', { section });
      return false;
    }
  }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const isAdminSettings = window.location.pathname.includes('/admin/settings');

  if (isAdminSettings) {
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

    const adminSettingsManager = new AdminSettingsManager(debug);

    // Make functions globally accessible for inline event handlers
    // This allows onclick="revealSecret(...)" and onsubmit="confirmCriticalChange(...)" in templates
    (window as any).revealSecret = (fieldId: string, fieldPath: string) => {
      adminSettingsManager.revealSecret(fieldId, fieldPath);
    };

    (window as any).remaskSecret = (fieldId: string) => {
      adminSettingsManager.remaskSecret(fieldId);
    };

    (window as any).confirmCriticalChange = async (event: Event) => {
      return await adminSettingsManager.confirmCriticalChange(event);
    };

    (window as any).adminSettingsManager = adminSettingsManager;
  }
});
