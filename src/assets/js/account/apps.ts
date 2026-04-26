/**
 * AppsManager - Manages connected applications and their permissions
 *
 * Features:
 * - Confirmation dialogs before revoking app access
 * - Handles single app and bulk revocation
 * - Integration with dialog utility for consistent UX
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  /**
   * Configuration interface for AppsManager
   */
  interface AppsConfig {
    debug?: boolean;
  }

  /**
   * AppsManager class - Handles confirmation dialogs for app revocation
   */
  class AppsManager {
    private debug: boolean;

    constructor(config: AppsConfig = {}) {
      this.debug = config.debug || false;
    }

    /**
     * Initialize the apps manager
     */
    public initialize(): void {
      this.log('Initializing AppsManager');
      this.setupConfirmationHandlers();
    }

    /**
     * Setup confirmation handlers for all confirm-action buttons
     */
    private setupConfirmationHandlers(): void {
      const buttons = document.querySelectorAll('.confirm-action');
      this.log(`Found ${buttons.length} confirm-action buttons`);

      buttons.forEach(button => {
        button.addEventListener('click', async e => {
          e.preventDefault();
          e.stopPropagation();

          await this.handleConfirmAction(button as HTMLButtonElement);
        });
      });
    }

    /**
     * Handle confirmation action for a button
     */
    private async handleConfirmAction(
      button: HTMLButtonElement
    ): Promise<void> {
      const title = button.dataset.confirmTitle || 'Confirm Action';
      const message = button.dataset.confirmMessage || 'Are you sure?';
      const variant = button.dataset.confirmVariant || 'warning';

      this.log('Showing confirmation dialog:', { title, message, variant });

      const confirmed = await (window as any).dialog.showConfirm(
        title,
        message,
        { variant, confirmText: 'Confirm', cancelText: 'Cancel' }
      );

      if (confirmed) {
        this.log('User confirmed action, submitting form');
        const form = button.form;
        if (form) {
          form.submit();
        }
      } else {
        this.log('User cancelled action');
      }
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
      if (this.debug) {
        console.log('[AppsManager]', ...args);
      }
    }
  }

  // Auto-initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const manager = new AppsManager({ debug: false });
    manager.initialize();
  });

  // Module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppsManager;
  }
})();
