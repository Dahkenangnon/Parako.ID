/**
 * RecoveryCodesManager - Manages backup recovery codes download and copy
 *
 * Features:
 * - Download codes as formatted text file
 * - Copy all codes to clipboard
 * - Visual feedback for successful operations
 * - Error handling with dialog integration
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  /**
   * Configuration interface for RecoveryCodesManager
   */
  interface RecoveryCodesConfig {
    codes: string[]; // populated from DOM elements, not JSON state
    translations: {
      fileContentTitle: string;
      fileContentGenerated: string;
      fileContentImportant: string;
      fileContentTotalCodes: string;
      downloadedFeedback: string;
      copiedFeedback: string;
      copyFailedError: string;
    };
    debug?: boolean;
  }

  /**
   * RecoveryCodesManager class - Handles backup codes download and copy
   */
  class RecoveryCodesManager {
    private config: RecoveryCodesConfig;
    private debug: boolean;
    private copyAllButton: HTMLElement | null;
    private downloadButton: HTMLElement | null;

    constructor(config: RecoveryCodesConfig) {
      this.config = config;
      this.debug = config.debug || false;
      this.copyAllButton = null;
      this.downloadButton = null;
    }

    /**
     * Initialize the recovery codes manager
     */
    public initialize(): void {
      this.log(
        'Initializing RecoveryCodesManager with',
        this.config.codes.length,
        'codes'
      );

      this.copyAllButton = document.getElementById('copy-all-codes');
      this.downloadButton = document.getElementById('download-codes');

      if (this.downloadButton) {
        this.setupDownloadHandler();
      }

      if (this.copyAllButton) {
        this.setupCopyHandler();
      }
    }

    /**
     * Setup download handler for codes
     */
    private setupDownloadHandler(): void {
      if (!this.downloadButton) return;

      this.downloadButton.addEventListener('click', () => {
        this.downloadCodes();
      });

      this.log('Download handler setup complete');
    }

    /**
     * Setup copy to clipboard handler
     */
    private setupCopyHandler(): void {
      if (!this.copyAllButton) return;

      this.copyAllButton.addEventListener('click', async () => {
        await this.copyCodesToClipboard();
      });

      this.log('Copy handler setup complete');
    }

    /**
     * Download codes as text file
     */
    private downloadCodes(): void {
      const allCodes = this.config.codes.join('\n');
      const today = new Date().toISOString().split('T')[0];
      const filename = `backup-codes-${today}.txt`;

      const fileContent = `${this.config.translations.fileContentTitle}
${this.config.translations.fileContentGenerated}: ${new Date().toLocaleString()}

${this.config.translations.fileContentImportant}

${allCodes}

${this.config.translations.fileContentTotalCodes}: ${this.config.codes.length}
`;

      const blob = new Blob([fileContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.log('Codes downloaded as', filename);

      this.showSuccessFeedback(
        this.downloadButton,
        this.config.translations.downloadedFeedback
      );
    }

    /**
     * Copy codes to clipboard.
     * Uses navigator.clipboard when available (secure contexts),
     * falls back to execCommand('copy') for HTTP/non-secure origins.
     */
    private async copyCodesToClipboard(): Promise<void> {
      const allCodes = this.config.codes.join('\n');

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(allCodes);
        } else {
          this.copyViaExecCommand(allCodes);
        }

        this.log('Codes copied to clipboard');

        this.showSuccessFeedback(
          this.copyAllButton,
          this.config.translations.copiedFeedback
        );
      } catch (err) {
        console.error('Failed to copy codes:', err);

        await (window as any).dialog.showAlert(
          'Copy Failed',
          this.config.translations.copyFailedError,
          { variant: 'error' }
        );
      }
    }

    /**
     * Fallback clipboard copy for non-secure contexts (HTTP).
     */
    private copyViaExecCommand(text: string): void {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    /**
     * Show success feedback by temporarily replacing button text
     */
    private showSuccessFeedback(
      button: HTMLElement | null,
      message: string
    ): void {
      if (!button) return;

      const originalHTML = button.innerHTML;
      const originalDisabled = (button as HTMLButtonElement).disabled;
      (button as HTMLButtonElement).disabled = true;
      button.innerHTML = message;

      setTimeout(() => {
        button.innerHTML = originalHTML;
        (button as HTMLButtonElement).disabled = originalDisabled;
      }, 2000);
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
      if (this.debug) {
        console.log('[RecoveryCodesManager]', ...args);
      }
    }
  }

  // Auto-initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const dataElement = document.getElementById('___RECOVERY_CODES_STATE___');
    if (!dataElement) {
      console.error('[RecoveryCodesManager] Configuration element not found');
      return;
    }

    try {
      const config: RecoveryCodesConfig = JSON.parse(
        dataElement.textContent || '{}'
      );

      // Read codes from DOM elements instead of JSON state (security hardening)
      const codesContainer = document.getElementById('recovery-codes-data');
      if (codesContainer) {
        const codeEls = codesContainer.querySelectorAll('[data-code]');
        config.codes = Array.from(codeEls)
          .map(el => el.getAttribute('data-code') || '')
          .filter(Boolean);
      }

      if (!config.codes || config.codes.length === 0) {
        console.error('[RecoveryCodesManager] No recovery codes found in DOM');
        return;
      }

      const manager = new RecoveryCodesManager(config);
      manager.initialize();
    } catch (error) {
      console.error(
        '[RecoveryCodesManager] Failed to parse configuration:',
        error
      );
    }
  });

  // Module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RecoveryCodesManager;
  }
})();
