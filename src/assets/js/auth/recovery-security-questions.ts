/**
 * Recovery Security Questions Form Handler
 *
 * Handles answer validation and form submission with loading state
 */
(function () {
  'use strict';

  class RecoverySecurityQuestionsManager {
    private form: HTMLFormElement | null = null;
    private submitBtn: HTMLButtonElement | null = null;

    public initialize(): void {
      this.cacheElements();
      this.setupEventListeners();
    }

    private cacheElements(): void {
      this.form = document.getElementById(
        'security-questions-form'
      ) as HTMLFormElement | null;
      this.submitBtn = document.getElementById(
        'submit-btn'
      ) as HTMLButtonElement | null;
    }

    private setupEventListeners(): void {
      this.form?.addEventListener('submit', e => this.handleSubmit(e));
    }

    private handleSubmit(e: Event): void {
      if (!this.form || !this.submitBtn) return;

      const answerInputs = this.form.querySelectorAll(
        'input[name="answers[]"]'
      );
      let valid = true;

      answerInputs.forEach(input => {
        const inputEl = input as HTMLInputElement;
        if (inputEl.value.trim().length < 3) {
          valid = false;
          inputEl.classList.add('border-red-500');
        } else {
          inputEl.classList.remove('border-red-500');
        }
      });

      if (!valid) {
        e.preventDefault();
        return;
      }

      this.submitBtn.disabled = true;
      this.submitBtn.textContent = this.getProcessingText();
    }

    private getProcessingText(): string {
      const stateEl = document.getElementById(
        '___RECOVERY_SECURITY_QUESTIONS_STATE___'
      );
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
    new RecoverySecurityQuestionsManager().initialize();
  });
})();
