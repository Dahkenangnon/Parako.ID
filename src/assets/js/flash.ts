/**
 * Notification Manager
 * Handles toast notifications (success/info/warning) and error modals
 * Toasts appear in top-right corner with auto-dismiss
 * Errors trigger centered modal dialogs requiring acknowledgment
 */

interface ToastElement extends HTMLElement {
  dataset: {
    toastType?: string;
    timeout?: string;
    dismissible?: string;
  };
}

interface FlashError {
  type: 'error';
  message: string;
  title?: string;
  dismissible?: boolean;
  timeout?: number;
}

interface ToastTimer {
  timeoutId: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startTime: number;
}

interface DialogApi {
  showAlert: (
    title: string,
    message: string,
    options?: { variant?: string; buttonText?: string }
  ) => Promise<void>;
}

interface WindowWithDialog extends Window {
  dialog?: DialogApi;
}

class NotificationManager {
  private activeToasts: Map<HTMLElement, ToastTimer> = new Map();

  constructor() {
    this.init();
  }

  private init(): void {
    this.setupToasts();
    this.processErrorMessages();
  }

  /**
   * Setup toast notification behaviors
   * - Dismiss button click handlers
   * - Auto-dismiss timers
   * - Pause on hover
   */
  private setupToasts(): void {
    const toasts = document.querySelectorAll<ToastElement>('.toast');

    toasts.forEach(toast => {
      const timeout = parseInt(toast.dataset.timeout || '0', 10);
      const dismissible = toast.dataset.dismissible !== 'false';

      const dismissBtn = toast.querySelector('.toast-dismiss');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => this.dismissToast(toast));
      }

      // Setup auto-dismiss timer if dismissible and has timeout
      if (dismissible && timeout > 0) {
        const timer: ToastTimer = {
          timeoutId: null,
          remaining: timeout,
          startTime: Date.now(),
        };

        timer.timeoutId = setTimeout(() => this.dismissToast(toast), timeout);
        this.activeToasts.set(toast, timer);

        toast.addEventListener('mouseenter', () => this.pauseTimer(toast));
        toast.addEventListener('mouseleave', () => this.resumeTimer(toast));
      }
    });
  }

  /**
   * Pause auto-dismiss timer when hovering over toast
   */
  private pauseTimer(toast: HTMLElement): void {
    const timer = this.activeToasts.get(toast);
    if (!timer || !timer.timeoutId) return;

    clearTimeout(timer.timeoutId);
    timer.timeoutId = null;
    timer.remaining = timer.remaining - (Date.now() - timer.startTime);

    const progressBar = toast.querySelector(
      '.toast-progress-bar'
    ) as HTMLElement;
    if (progressBar) {
      progressBar.style.animationPlayState = 'paused';
    }
  }

  /**
   * Resume auto-dismiss timer when mouse leaves toast
   */
  private resumeTimer(toast: HTMLElement): void {
    const timer = this.activeToasts.get(toast);
    if (!timer || timer.remaining <= 0) return;

    timer.startTime = Date.now();
    timer.timeoutId = setTimeout(
      () => this.dismissToast(toast),
      timer.remaining
    );

    const progressBar = toast.querySelector(
      '.toast-progress-bar'
    ) as HTMLElement;
    if (progressBar) {
      progressBar.style.animationPlayState = 'running';
    }
  }

  /**
   * Dismiss a toast with slide-out animation
   */
  private dismissToast(toast: HTMLElement): void {
    if (!this.activeToasts.has(toast) && !toast.parentNode) return;

    const timer = this.activeToasts.get(toast);
    if (timer?.timeoutId) {
      clearTimeout(timer.timeoutId);
    }
    this.activeToasts.delete(toast);

    toast.classList.add('dismissing');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }

  /**
   * Process error messages from JSON and display as modal dialogs
   * Errors are displayed sequentially (one at a time)
   */
  private async processErrorMessages(): Promise<void> {
    const errorScript = document.getElementById('__FLASH_ERRORS__');
    if (!errorScript) return;

    try {
      const errors: FlashError[] = JSON.parse(errorScript.textContent || '[]');

      // Remove the script element immediately to prevent re-processing
      errorScript.remove();

      const win = window as WindowWithDialog;
      if (!win.dialog?.showAlert) {
        console.error(
          '[NotificationManager] Dialog utility not available, falling back to console'
        );
        errors.forEach(error => {
          console.error(`[Error] ${error.title || 'Error'}: ${error.message}`);
        });
        return;
      }

      for (const error of errors) {
        await this.showErrorDialog(error);
      }
    } catch (e) {
      console.error('[NotificationManager] Failed to parse error messages', e);
    }
  }

  /**
   * Show a single error as a centered modal dialog
   */
  private async showErrorDialog(error: FlashError): Promise<void> {
    const title = error.title || 'Error';
    const message = error.message;
    const win = window as WindowWithDialog;

    await win.dialog!.showAlert(title, message, {
      variant: 'error',
      buttonText: 'OK',
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new NotificationManager();
});
