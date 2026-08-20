/**
 * Confirm Handler Utility - Shared confirmation dialog handler for settings
 *
 * Provides reusable confirmation dialog functionality with:
 * - Data attribute-based configuration
 * - Message interpolation support
 * - Form submission handling
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

import dialogService, {
  type DialogService,
  type DialogVariant,
} from '../../utils/dialog.js';

/**
 * Translation map interface
 */
export interface TranslationMap {
  [key: string]: string;
}

const DIALOG_VARIANTS = new Set<DialogVariant>([
  'info',
  'warning',
  'error',
  'success',
  'danger',
]);

function resolveDialogVariant(value: string | undefined): DialogVariant {
  return value && DIALOG_VARIANTS.has(value as DialogVariant)
    ? (value as DialogVariant)
    : 'warning';
}

/**
 * Handle confirmation action for a button with data attributes
 *
 * @param button - The button element that was clicked
 * @param translations - Map of translation keys to translated strings
 * @returns Promise<boolean> - true if confirmed, false if cancelled
 */
export async function handleConfirmAction(
  button: HTMLButtonElement,
  translations: TranslationMap,
  dialog: DialogService = dialogService
): Promise<boolean> {
  const title = button.dataset.confirmTitle || 'Confirm Action';
  const messageKey = button.dataset.confirmMessageKey;
  const variant = resolveDialogVariant(button.dataset.confirmVariant);
  const provider = button.dataset.confirmProvider;

  let message =
    messageKey && translations[messageKey]
      ? translations[messageKey]
      : 'Are you sure?';

  // Support {{provider}} interpolation
  if (provider && message.includes('{{provider}}')) {
    message = message.replace(/\{\{provider\}\}/g, provider);
  }

  const confirmed = await dialog.showConfirm(title, message, {
    variant,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
  });

  return confirmed;
}

/**
 * Setup confirmation handlers for all buttons with .confirm-action class
 *
 * @param translations - Map of translation keys to translated strings
 * @param debug - Enable debug logging
 */
export function setupConfirmationHandlers(
  translations: TranslationMap,
  debug: boolean = false,
  dialog: DialogService = dialogService
): void {
  const buttons = document.querySelectorAll('.confirm-action');

  if (debug) {
    console.log(
      '[ConfirmHandler] Setting up',
      buttons.length,
      'confirmation handlers'
    );
  }

  buttons.forEach(button => {
    button.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();

      const confirmed = await handleConfirmAction(
        button as HTMLButtonElement,
        translations,
        dialog
      );

      if (confirmed) {
        const form = (button as HTMLButtonElement).form;
        if (form) {
          if (debug) {
            console.log('[ConfirmHandler] User confirmed, submitting form');
          }
          form.submit();
        }
      } else if (debug) {
        console.log('[ConfirmHandler] User cancelled action');
      }
    });
  });
}
