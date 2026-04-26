/**
 * Admin Configuration Validation Module
 *
 * Client-side constraint enforcement for tenant configuration forms.
 * Validates all number inputs against their min/max attributes before
 * form submission, showing user-friendly inline errors.
 *
 * Used by: security, oidc, notifications, integrations
 */
(function () {
  'use strict';

  const ERROR_CLASS = 'config-validation-error';
  const ERROR_BORDER = 'border-destructive';

  function clearErrors(form: HTMLFormElement): void {
    form.querySelectorAll(`.${ERROR_CLASS}`).forEach(el => el.remove());
    form.querySelectorAll(`.${ERROR_BORDER}`).forEach(el => {
      el.classList.remove(ERROR_BORDER);
    });
  }

  function showError(input: HTMLInputElement, message: string): void {
    input.classList.add(ERROR_BORDER);
    const errorEl = document.createElement('p');
    errorEl.className = `${ERROR_CLASS} mt-1 text-xs text-destructive`;
    errorEl.textContent = message;
    input.insertAdjacentElement('afterend', errorEl);
  }

  function validateForm(form: HTMLFormElement): boolean {
    clearErrors(form);
    let valid = true;

    const numberInputs = form.querySelectorAll<HTMLInputElement>(
      'input[type="number"]'
    );

    for (const input of numberInputs) {
      const raw = input.value.trim();
      if (raw === '') continue;

      const value = Number(raw);

      if (isNaN(value) || !isFinite(value)) {
        showError(input, 'Please enter a valid number.');
        valid = false;
        continue;
      }

      const min = input.hasAttribute('min') ? Number(input.min) : null;
      const max = input.hasAttribute('max') ? Number(input.max) : null;

      if (min !== null && value < min) {
        showError(input, `Value must be at least ${min}.`);
        valid = false;
      } else if (max !== null && value > max) {
        showError(input, `Value cannot exceed ${max}.`);
        valid = false;
      }
    }

    if (!valid) {
      const firstError = form.querySelector(`.${ERROR_BORDER}`);
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    return valid;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById(
      'config-form'
    ) as HTMLFormElement | null;
    if (!form) return;

    form.addEventListener('submit', function (e: Event) {
      if (!validateForm(form)) {
        e.preventDefault();
      }
    });
  });
})();
