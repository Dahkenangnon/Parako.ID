import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserClipboardService } from '../../../src/assets/js/utils/clipboard.js';

class ClassListFixture {
  public readonly add = vi.fn();
  public readonly remove = vi.fn();
}

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly childNodes: unknown[] = [];
  public readonly classList = new ClassListFixture();
  public className = '';
  public readonly remove = vi.fn();
  public readonly replaceChildren = vi.fn((...nodes: unknown[]) => {
    this.childNodes.splice(0, this.childNodes.length, ...nodes);
  });
  public readonly select = vi.fn();
  public readonly style: Record<string, string> = {};
  public value = '';

  public constructor(private readonly button: ElementFixture | null = null) {}

  public closest(selector: string): ElementFixture | null {
    return selector === 'button' ? this.button : null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function setupDom(
  options: {
    clipboard?: { writeText: ReturnType<typeof vi.fn> };
    execCommand?: boolean;
  } = {}
) {
  const textArea = new ElementFixture();
  const successIcon = new ElementFixture();
  const appendChild = vi.fn();
  const execCommand = vi.fn().mockReturnValue(options.execCommand ?? true);
  const createIcons = vi.fn();

  vi.stubGlobal('navigator', { clipboard: options.clipboard });
  vi.stubGlobal('window', { lucide: { createIcons } });
  vi.stubGlobal('document', {
    body: { appendChild },
    createElement: vi.fn((tagName: string) =>
      tagName === 'textarea' ? textArea : successIcon
    ),
    execCommand,
  });

  return {
    appendChild,
    createIcons,
    execCommand,
    successIcon,
    textArea,
  };
}

describe('browser clipboard service', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the Clipboard API and restores button feedback', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const dom = setupDom({ clipboard: { writeText } });
    const toast = { show: vi.fn() };
    const service = new BrowserClipboardService(toast);
    const button = new ElementFixture();
    const originalNode = {};
    button.childNodes.push(originalNode);
    const trigger = new ElementFixture(button);

    await expect(service.copy('client-secret', trigger as never)).resolves.toBe(
      true
    );

    expect(writeText).toHaveBeenCalledWith('client-secret');
    expect(button.childNodes).toEqual([dom.successIcon]);
    expect(button.classList.add).toHaveBeenCalledWith('text-green-600');
    expect(toast.show).toHaveBeenCalledWith(
      'Copied!',
      'Copied to clipboard successfully.',
      'success'
    );

    vi.advanceTimersByTime(2000);
    expect(button.childNodes).toEqual([originalNode]);
    expect(button.classList.remove).toHaveBeenCalledWith('text-green-600');
    expect(dom.createIcons).toHaveBeenCalledTimes(2);
  });

  it('falls back to a temporary textarea when the Clipboard API fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const dom = setupDom({ clipboard: { writeText } });
    const toast = { show: vi.fn() };
    const service = new BrowserClipboardService(toast);

    await expect(service.copy('client-id')).resolves.toBe(true);

    expect(dom.appendChild).toHaveBeenCalledWith(dom.textArea);
    expect(dom.textArea.value).toBe('client-id');
    expect(dom.textArea.style).toEqual({
      opacity: '0',
      position: 'fixed',
    });
    expect(dom.textArea.select).toHaveBeenCalledOnce();
    expect(dom.execCommand).toHaveBeenCalledWith('copy');
    expect(dom.textArea.remove).toHaveBeenCalledOnce();
  });

  it('reports failure when neither clipboard mechanism succeeds', async () => {
    const dom = setupDom({ execCommand: false });
    const toast = { show: vi.fn() };
    const service = new BrowserClipboardService(toast);

    await expect(service.copy('client-id')).resolves.toBe(false);

    expect(dom.textArea.remove).toHaveBeenCalledOnce();
    expect(toast.show).toHaveBeenCalledWith(
      'Copy Failed',
      'Failed to copy to clipboard. Please copy manually.',
      'error'
    );
  });

  it('does not require Lucide when no trigger button is provided', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setupDom({ clipboard: { writeText } });
    vi.stubGlobal('window', {});
    const service = new BrowserClipboardService({ show: vi.fn() });

    await expect(service.copy('client-id')).resolves.toBe(true);
  });
});
