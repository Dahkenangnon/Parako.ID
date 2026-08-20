export interface AdminConfigurationCommonController {
  refreshIcons(): void;
  remaskTenantSecret(inputId: string): void;
  revealTenantSecret(fieldPath: string, inputId: string): void;
}

export function initializeAdminConfigurationCommon(): AdminConfigurationCommonController {
  const revealedFields: Set<string> = new Set();

  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const INACTIVITY_TIMEOUT = 2 * 60 * 1000;

  function refreshIcons(): void {
    const lucide = window.lucide;
    if (lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  function updateButtonContent(
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

    refreshIcons();
  }

  // Shoulder-surfing protection (invisible text on blur)

  function applyInvisibleStyle(field: HTMLInputElement): void {
    field.setAttribute('data-invisible-style', 'true');
    field.style.color = 'transparent';
    field.style.caretColor = '#f97316'; // Orange caret for visibility when typing
  }

  function removeInvisibleStyle(field: HTMLInputElement): void {
    field.removeAttribute('data-invisible-style');
    field.style.color = '';
    field.style.caretColor = '';
  }

  function setupInvisibleTextHandlers(field: HTMLInputElement): void {
    const onFocus = (event: Event): void => {
      const target = event.target as HTMLInputElement;
      if (target.getAttribute('data-invisible-style') === 'true') {
        removeInvisibleStyle(target);
      }
    };

    const onBlur = (event: Event): void => {
      const target = event.target as HTMLInputElement;
      // Only re-apply if the field is still revealed (type === 'text')
      if (target.type === 'text' && revealedFields.has(target.id)) {
        applyInvisibleStyle(target);
      }
    };

    field.addEventListener('focus', onFocus);
    field.addEventListener('blur', onBlur);
  }

  function showNotification(
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

    refreshIcons();

    setTimeout(function () {
      notificationDiv.remove();
    }, 5000);
  }

  function resetInactivityTimer(): void {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }

    inactivityTimer = setTimeout(function () {
      autoRemaskAllSecrets();
    }, INACTIVITY_TIMEOUT);
  }

  function autoRemaskAllSecrets(): void {
    if (revealedFields.size === 0) {
      return;
    }

    const fieldsToRemask = Array.from(revealedFields);
    fieldsToRemask.forEach(function (inputId) {
      remaskTenantSecret(inputId);
    });

    showNotification(
      'Secrets Auto-Masked',
      'Revealed secrets have been automatically masked due to inactivity.',
      'shield-alert'
    );
  }

  function setupInactivityMonitoring(): void {
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ];

    events.forEach(function (event) {
      document.addEventListener(
        event,
        function () {
          resetInactivityTimer();
        },
        true
      );
    });

    resetInactivityTimer();
  }

  function setupResetConfirmations(): void {
    document
      .querySelectorAll<HTMLFormElement>('form[data-confirm-message]')
      .forEach(function (form) {
        form.addEventListener('submit', function (event) {
          const message = form.getAttribute('data-confirm-message')?.trim();
          if (message && !window.confirm(message)) {
            event.preventDefault();
          }
        });
      });
  }

  function setupSecretControls(): void {
    document
      .querySelectorAll<HTMLButtonElement>(
        'button[data-secret-field-path][data-secret-input-id]'
      )
      .forEach(function (button) {
        const fieldPath = button.getAttribute('data-secret-field-path')?.trim();
        const inputId = button.getAttribute('data-secret-input-id')?.trim();
        if (!fieldPath || !inputId) return;

        button.addEventListener('click', function () {
          if (revealedFields.has(inputId)) {
            remaskTenantSecret(inputId);
          } else {
            revealTenantSecret(fieldPath, inputId);
          }
        });
      });
  }

  /**
   * Reveal a tenant secret field via the admin configuration API.
   *
   * Fetches the decrypted value from the server and shows it in the password
   * input. Switches the button to "Re-mask" and applies shoulder-surfing
   * protection (text invisible on blur, visible on focus).
   *
   * @param fieldPath - Dot-path of the secret (e.g. 'notifications.channels.sms.api_key')
   * @param inputId   - DOM id of the <input type="password"> element
   */
  function revealTenantSecret(fieldPath: string, inputId: string): void {
    const csrfInput = document.querySelector<HTMLInputElement>(
      'input[name="_csrf"]'
    );
    const csrfToken = csrfInput?.value || '';

    if (!csrfToken) {
      return;
    }

    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) {
      return;
    }

    const button = input.parentElement?.querySelector(
      'button'
    ) as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    button.disabled = true;
    updateButtonContent(
      button,
      'loader-2',
      'Loading...',
      'h-3 w-3 inline mr-1 animate-spin'
    );

    fetch('/admin/configuration/reveal-secret', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ fieldPath, _csrf: csrfToken }),
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (data: { success: boolean; value?: string }) {
        if (data.success && data.value !== undefined) {
          input.type = 'text';
          input.value = data.value;

          revealedFields.add(inputId);

          setupInvisibleTextHandlers(input);

          input.focus();

          // Change button to "Re-mask"
          button.disabled = false;
          updateButtonContent(button, 'eye-off', 'Re-mask');

          resetInactivityTimer();
        } else {
          button.disabled = false;
          updateButtonContent(button, 'eye', 'Reveal');
        }
      })
      .catch(function () {
        button.disabled = false;
        updateButtonContent(button, 'eye', 'Reveal');
      });
  }

  /**
   * Re-mask a previously revealed tenant secret field.
   *
   * Restores the input to type="password", removes shoulder-surfing styles,
   * and switches the button back to "Reveal".
   *
   * @param inputId - DOM id of the <input> element to remask
   */
  function remaskTenantSecret(inputId: string): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) {
      return;
    }

    input.type = 'password';

    removeInvisibleStyle(input);

    revealedFields.delete(inputId);

    const button = input.parentElement?.querySelector(
      'button'
    ) as HTMLButtonElement | null;
    if (button) {
      updateButtonContent(button, 'eye', 'Reveal');
    }
  }

  setupResetConfirmations();
  setupSecretControls();
  setupInactivityMonitoring();

  return { refreshIcons, remaskTenantSecret, revealTenantSecret };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initializeAdminConfigurationCommon();
}
