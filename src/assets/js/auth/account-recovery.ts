/**
 * Account Recovery Form Handler
 *
 * Handles form submission with validation and loading state
 */
(function () {
  'use strict';

  class AccountRecoveryManager {
    private form: HTMLFormElement | null = null;
    private submitBtn: HTMLButtonElement | null = null;
    private identifierInput: HTMLInputElement | null = null;

    public initialize(): void {
      this.cacheElements();
      this.setupEventListeners();
    }

    private cacheElements(): void {
      this.form = document.getElementById(
        'recovery-form'
      ) as HTMLFormElement | null;
      this.submitBtn = document.getElementById(
        'submit-btn'
      ) as HTMLButtonElement | null;
      this.identifierInput = document.getElementById(
        'identifier'
      ) as HTMLInputElement | null;
    }

    private setupEventListeners(): void {
      this.form?.addEventListener('submit', e => this.handleSubmit(e));
    }

    private handleSubmit(e: Event): void {
      if (!this.identifierInput || !this.identifierInput.value.trim()) {
        e.preventDefault();
        return;
      }

      if (this.submitBtn) {
        this.submitBtn.disabled = true;
        this.submitBtn.textContent = this.getProcessingText();
      }
    }

    private getProcessingText(): string {
      const stateEl = document.getElementById('___ACCOUNT_RECOVERY_STATE___');
      if (stateEl) {
        try {
          const data = JSON.parse(stateEl.textContent || '{}');
          return data.translations?.processing || 'Processing...';
        } catch {
          return 'Processing...';
        }
      }
      return 'Processing...';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new AccountRecoveryManager().initialize();
  });
})();
