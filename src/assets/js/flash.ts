import dialogService, { type DialogService } from './utils/dialog.js';

export interface ToastElement extends HTMLElement {
  dataset: {
    dismissible?: string;
    timeout?: string;
    toastType?: string;
  };
}

export interface FlashError {
  dismissible?: boolean;
  message: string;
  timeout?: number;
  title?: string;
  type: 'error';
}

type FlashDialog = Pick<DialogService, 'showAlert'>;

interface ToastTimer {
  remaining: number;
  startTime: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export class NotificationManager {
  private readonly activeToasts = new Map<HTMLElement, ToastTimer>();

  public constructor(
    private readonly dialog: FlashDialog | null = dialogService
  ) {
    this.setupToasts();
    void this.processErrorMessages();
  }

  private setupToasts(): void {
    const toasts = document.querySelectorAll<ToastElement>('.toast');

    toasts.forEach(toast => {
      const timeout = Number.parseInt(toast.dataset.timeout || '0', 10);
      const dismissible = toast.dataset.dismissible !== 'false';
      const dismissButton = toast.querySelector('.toast-dismiss');

      dismissButton?.addEventListener('click', () => this.dismissToast(toast));

      if (!dismissible || timeout <= 0) return;

      const timer: ToastTimer = {
        timeoutId: setTimeout(() => this.dismissToast(toast), timeout),
        remaining: timeout,
        startTime: Date.now(),
      };
      this.activeToasts.set(toast, timer);

      toast.addEventListener('mouseenter', () => this.pauseTimer(toast));
      toast.addEventListener('mouseleave', () => this.resumeTimer(toast));
    });
  }

  private pauseTimer(toast: HTMLElement): void {
    const timer = this.activeToasts.get(toast);
    if (!timer?.timeoutId) return;

    clearTimeout(timer.timeoutId);
    timer.timeoutId = null;
    timer.remaining -= Date.now() - timer.startTime;

    const progressBar = toast.querySelector<HTMLElement>('.toast-progress-bar');
    if (progressBar) {
      progressBar.style.animationPlayState = 'paused';
    }
  }

  private resumeTimer(toast: HTMLElement): void {
    const timer = this.activeToasts.get(toast);
    if (!timer || timer.remaining <= 0) return;

    timer.startTime = Date.now();
    timer.timeoutId = setTimeout(
      () => this.dismissToast(toast),
      timer.remaining
    );

    const progressBar = toast.querySelector<HTMLElement>('.toast-progress-bar');
    if (progressBar) {
      progressBar.style.animationPlayState = 'running';
    }
  }

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

  private async processErrorMessages(): Promise<void> {
    const errorScript = document.getElementById('__FLASH_ERRORS__');
    if (!errorScript) return;

    let errors: FlashError[];
    try {
      errors = JSON.parse(errorScript.textContent || '[]') as FlashError[];
    } catch (error) {
      console.error(
        '[NotificationManager] Failed to parse error messages',
        error
      );
      return;
    }

    errorScript.remove();
    if (errors.length === 0) return;

    if (!this.dialog) {
      console.error(
        '[NotificationManager] Dialog utility not available, falling back to console'
      );
      errors.forEach(error => {
        console.error(`[Error] ${error.title || 'Error'}: ${error.message}`);
      });
      return;
    }

    for (const error of errors) {
      await this.dialog.showAlert(error.title || 'Error', error.message, {
        variant: 'error',
        buttonText: 'OK',
      });
    }
  }
}

export function initializeFlashNotifications(
  dialog: FlashDialog | null = dialogService
): NotificationManager {
  return new NotificationManager(dialog);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => initializeFlashNotifications(),
      { once: true }
    );
  } else {
    initializeFlashNotifications();
  }
}
