import { afterEach, describe, expect, it, vi } from 'vitest';

interface ElementFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  appendChild: ReturnType<typeof vi.fn>;
  children: ElementFixture[];
  className: string;
  focus: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  style: Record<string, string>;
  textContent: string;
  type: string;
}

function setupDom(withLucide = true) {
  const elements: ElementFixture[] = [];
  const bodyChildren: ElementFixture[] = [];
  const documentListeners = new Map<string, EventListener>();
  const createIcons = vi.fn();
  vi.stubGlobal('window', withLucide ? { lucide: { createIcons } } : {});
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: EventListener) =>
      documentListeners.set(name, listener)
    ),
    removeEventListener: vi.fn((name: string, listener: EventListener) => {
      if (documentListeners.get(name) === listener)
        documentListeners.delete(name);
    }),
    body: {
      appendChild: vi.fn((node: ElementFixture) => bodyChildren.push(node)),
    },
    createElement: vi.fn(() => {
      const node: ElementFixture = {
        addEventListener: vi.fn(),
        appendChild: vi.fn((child: ElementFixture) =>
          node.children.push(child)
        ),
        children: [],
        className: '',
        focus: vi.fn(),
        remove: vi.fn(),
        setAttribute: vi.fn(),
        style: {},
        textContent: '',
        type: '',
      };
      elements.push(node);
      return node;
    }),
  });
  return { bodyChildren, createIcons, documentListeners, elements };
}

function listener(node: ElementFixture, name: string) {
  return node.addEventListener.mock.calls.find(
    call => call[0] === name
  )?.[1] as (event?: Partial<Event>) => void;
}

describe('dialog utility', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['info', 'info', 'text-blue-500'],
    ['warning', 'alert-triangle', 'text-amber-500'],
    ['error', 'x-circle', 'text-red-500'],
    ['success', 'check-circle', 'text-green-500'],
    ['danger', 'alert-triangle', 'text-red-500'],
  ] as const)('renders and closes a %s alert', async (variant, icon, color) => {
    vi.useFakeTimers();
    const { bodyChildren, createIcons, elements } = setupDom();
    const { showAlert } =
      await import('../../../src/assets/js/utils/dialog.js');

    const result = showAlert('Title', 'Message', {
      variant,
      buttonText: 'Understood',
    });
    const backdrop = elements[0]!;
    const modal = elements[1]!;
    const iconElement = elements[4]!;
    const title = elements[5]!;
    const message = elements[7]!;
    const button = elements[9]!;

    expect(bodyChildren).toEqual([backdrop]);
    expect(iconElement.setAttribute).toHaveBeenCalledWith('data-lucide', icon);
    expect(iconElement.className).toContain(color);
    expect(title.textContent).toBe('Title');
    expect(message.textContent).toBe('Message');
    expect(modal.setAttribute).toHaveBeenCalledWith('role', 'dialog');
    expect(modal.setAttribute).toHaveBeenCalledWith('aria-modal', 'true');
    const titleId = title.setAttribute.mock.calls.find(
      call => call[0] === 'id'
    )?.[1] as string;
    const messageId = message.setAttribute.mock.calls.find(
      call => call[0] === 'id'
    )?.[1] as string;
    expect(titleId).toMatch(/^dialog-title-/);
    expect(messageId).toMatch(/^dialog-message-/);
    expect(modal.setAttribute).toHaveBeenCalledWith('aria-labelledby', titleId);
    expect(modal.setAttribute).toHaveBeenCalledWith(
      'aria-describedby',
      messageId
    );
    expect(button.textContent).toBe('Understood');
    expect(createIcons).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(100);
    expect(button.focus).toHaveBeenCalledOnce();
    listener(button, 'click')();
    await expect(result).resolves.toBeUndefined();
    expect(backdrop.remove).toHaveBeenCalledOnce();
    expect(document.removeEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function)
    );
  });

  it('supports a custom alert icon and backdrop dismissal without Lucide', async () => {
    const { elements } = setupDom(false);
    const { showAlert } =
      await import('../../../src/assets/js/utils/dialog.js');
    const result = showAlert('Title', 'Message', { icon: 'shield' });
    const backdrop = elements[0]!;

    expect(elements[4]?.setAttribute).toHaveBeenCalledWith(
      'data-lucide',
      'shield'
    );
    const click = listener(backdrop, 'click');
    click({ target: elements[1] } as unknown as Partial<Event>);
    expect(backdrop.remove).not.toHaveBeenCalled();
    click({ target: backdrop } as unknown as Partial<Event>);

    await expect(result).resolves.toBeUndefined();
  });

  it('ignores unrelated keys and closes an alert on Escape', async () => {
    const { documentListeners, elements } = setupDom();
    const { showAlert } =
      await import('../../../src/assets/js/utils/dialog.js');
    const result = showAlert('Title', 'Message');
    const keydown = documentListeners.get('keydown')!;

    keydown({ key: 'Enter' } as KeyboardEvent);
    expect(elements[0]?.remove).not.toHaveBeenCalled();
    keydown({ key: 'Escape' } as KeyboardEvent);

    await expect(result).resolves.toBeUndefined();
  });

  it('resolves true when a confirmation is accepted', async () => {
    vi.useFakeTimers();
    const { elements } = setupDom();
    const { showConfirm } =
      await import('../../../src/assets/js/utils/dialog.js');
    const result = showConfirm('Confirm', 'Proceed?', {
      variant: 'danger',
      confirmText: 'Proceed',
      cancelText: 'Stop',
      icon: 'shield-alert',
    });
    const cancelButton = elements[9]!;
    const confirmButton = elements[10]!;
    const modal = elements[1]!;
    const title = elements[5]!;
    const message = elements[7]!;

    expect(cancelButton.textContent).toBe('Stop');
    expect(confirmButton.textContent).toBe('Proceed');
    expect(modal.setAttribute).toHaveBeenCalledWith('role', 'dialog');
    expect(modal.setAttribute).toHaveBeenCalledWith('aria-modal', 'true');
    const titleId = title.setAttribute.mock.calls.find(
      call => call[0] === 'id'
    )?.[1] as string;
    const messageId = message.setAttribute.mock.calls.find(
      call => call[0] === 'id'
    )?.[1] as string;
    expect(titleId).toMatch(/^dialog-title-/);
    expect(messageId).toMatch(/^dialog-message-/);
    expect(modal.setAttribute).toHaveBeenCalledWith('aria-labelledby', titleId);
    expect(modal.setAttribute).toHaveBeenCalledWith(
      'aria-describedby',
      messageId
    );
    expect(elements[4]?.setAttribute).toHaveBeenCalledWith(
      'data-lucide',
      'shield-alert'
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(confirmButton.focus).toHaveBeenCalledOnce();
    listener(confirmButton, 'click')();

    await expect(result).resolves.toBe(true);
  });

  it.each(['button', 'backdrop', 'escape'])(
    'resolves false when confirmation is cancelled by %s',
    async method => {
      const { documentListeners, elements } = setupDom(false);
      const { showConfirm } =
        await import('../../../src/assets/js/utils/dialog.js');
      const result = showConfirm('Confirm', 'Proceed?');

      if (method === 'button') {
        listener(elements[9]!, 'click')();
      } else if (method === 'backdrop') {
        const click = listener(elements[0]!, 'click');
        click({ target: elements[1] } as unknown as Partial<Event>);
        expect(elements[0]?.remove).not.toHaveBeenCalled();
        click({ target: elements[0] } as unknown as Partial<Event>);
      } else {
        const keydown = documentListeners.get('keydown')!;
        keydown({ key: 'Enter' } as KeyboardEvent);
        expect(elements[0]?.remove).not.toHaveBeenCalled();
        keydown({ key: 'Escape' } as KeyboardEvent);
      }

      await expect(result).resolves.toBe(false);
    }
  );

  it('provides legacy confirm and alert wrappers', async () => {
    const { elements } = setupDom();
    const { alertDialog, confirmDialog } =
      await import('../../../src/assets/js/utils/dialog.js');
    const alertResult = alertDialog('Legacy alert');
    expect(elements[5]?.textContent).toBe('Notice');
    listener(elements[9]!, 'click')();
    await expect(alertResult).resolves.toBeUndefined();

    elements.length = 0;
    const confirmResult = confirmDialog('Legacy confirm');
    expect(elements[5]?.textContent).toBe('Confirm');
    listener(elements[10]!, 'click')();
    await expect(confirmResult).resolves.toBe(true);
  });
});
