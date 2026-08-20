import toastService, { type ToastService } from './toast.js';

export interface ClipboardService {
  copy(text: string, triggerElement?: HTMLElement): Promise<boolean>;
}

async function writeClipboard(text: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';

    try {
      document.body.appendChild(textArea);
      textArea.select();
      if (!document.execCommand('copy')) {
        throw new Error('Clipboard fallback failed');
      }
    } finally {
      textArea.remove();
    }
  }
}

export class BrowserClipboardService implements ClipboardService {
  public constructor(private readonly toast: ToastService = toastService) {}

  public async copy(
    text: string,
    triggerElement?: HTMLElement
  ): Promise<boolean> {
    try {
      await writeClipboard(text);
    } catch {
      this.toast.show(
        'Copy Failed',
        'Failed to copy to clipboard. Please copy manually.',
        'error'
      );
      return false;
    }

    const button = triggerElement?.closest('button');
    if (button) {
      const originalNodes = Array.from(button.childNodes);
      const successIcon = document.createElement('i');
      successIcon.setAttribute('data-lucide', 'check');
      successIcon.className = 'h-4 w-4';
      button.replaceChildren(successIcon);
      button.classList.add('text-green-600');
      window.lucide?.createIcons();

      setTimeout(() => {
        button.replaceChildren(...originalNodes);
        button.classList.remove('text-green-600');
        window.lucide?.createIcons();
      }, 2000);
    }

    this.toast.show('Copied!', 'Copied to clipboard successfully.', 'success');
    return true;
  }
}

const clipboardService: ClipboardService = new BrowserClipboardService();

export default clipboardService;
