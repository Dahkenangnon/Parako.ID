(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  function refreshIcons(): void {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const sendButton = document.getElementById('send-test-email-button');
    if (!sendButton) return;

    sendButton.addEventListener(
      'click',
      async function (this: HTMLButtonElement) {
        const emailInput = document.getElementById(
          'test-email-address'
        ) as HTMLInputElement | null;
        const resultEl = document.getElementById('test-email-result');

        if (!emailInput || !resultEl) return;

        const email = emailInput.value.trim();

        if (!email) {
          resultEl.textContent = 'Please enter an email address.';
          resultEl.className = 'mt-2 text-sm text-destructive';
          resultEl.classList.remove('hidden');
          return;
        }

        const csrfInput = document.querySelector<HTMLInputElement>(
          'input[name="_csrf"]'
        );
        const csrfToken = csrfInput?.value || '';

        this.disabled = true;
        this.textContent = 'Sending...';
        resultEl.classList.add('hidden');

        try {
          const response = await fetch(
            '/admin/configuration/integrations/test-email',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
              },
              body: JSON.stringify({ email, _csrf: csrfToken }),
            }
          );
          const data = await response.json();

          resultEl.textContent = data.success
            ? data.message
            : data.error || 'Failed to send test email';
          resultEl.className = data.success
            ? 'mt-2 text-sm text-success'
            : 'mt-2 text-sm text-destructive';
          resultEl.classList.remove('hidden');
        } catch {
          resultEl.textContent = 'Network error. Please try again.';
          resultEl.className = 'mt-2 text-sm text-destructive';
          resultEl.classList.remove('hidden');
        } finally {
          this.disabled = false;
          this.textContent = 'Send Test';
          refreshIcons();
        }
      }
    );
  });
})();
