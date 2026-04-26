/**
 * Recovery SMS Form Handler
 *
 * Handles retry countdown timer and form submission with loading state
 */
(function () {
  'use strict';

  class RecoverySmsManager {
    private retrySecondsEl: HTMLElement | null = null;
    private sendBtn: HTMLButtonElement | null = null;
    private form: HTMLFormElement | null = null;

    public initialize(): void {
      this.cacheElements();
      this.setupRetryCountdown();
      this.setupFormSubmission();
    }

    private cacheElements(): void {
      this.retrySecondsEl = document.getElementById('retry-seconds');
      this.sendBtn = document.getElementById(
        'send-btn'
      ) as HTMLButtonElement | null;
      this.form = document.getElementById(
        'send-code-form'
      ) as HTMLFormElement | null;
    }

    private setupRetryCountdown(): void {
      if (!this.retrySecondsEl) return;

      let seconds = parseInt(this.retrySecondsEl.textContent || '0', 10);

      const interval = setInterval(() => {
        seconds--;
        if (this.retrySecondsEl) {
          this.retrySecondsEl.textContent = String(seconds);
        }

        if (seconds <= 0) {
          clearInterval(interval);
          const countdownContainer = document.getElementById('retry-countdown');
          if (countdownContainer?.parentElement) {
            countdownContainer.parentElement.style.display = 'none';
          }
          if (this.sendBtn) {
            this.sendBtn.disabled = false;
          }
        }
      }, 1000);
    }

    private setupFormSubmission(): void {
      if (!this.form || !this.sendBtn) return;

      this.form.addEventListener('submit', () => {
        if (this.sendBtn) {
          this.sendBtn.disabled = true;
          this.sendBtn.textContent = this.getSendingText();
        }
      });
    }

    private getSendingText(): string {
      const stateEl = document.getElementById('___RECOVERY_SMS_STATE___');
      if (stateEl) {
        try {
          const data = JSON.parse(stateEl.textContent || '{}');
          return data.translations?.sending || 'Sending...';
        } catch {
          return 'Sending...';
        }
      }
      return 'Sending...';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new RecoverySmsManager().initialize();
  });
})();
