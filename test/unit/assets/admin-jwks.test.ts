import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminJwksManager } from '../../../src/assets/js/admin/jwks.js';

type DomEvent = {
  currentTarget?: unknown;
  key?: string;
  preventDefault?: () => void;
  target?: unknown;
};
type DomListener = (event: DomEvent) => void;

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public className = '';
  public closestButton: ElementFixture | null = null;
  public readonly dataset: Record<string, string> = {};
  public readonly focus = vi.fn();
  public id = '';
  public parentNode: ElementFixture | null = null;
  public readonly select = vi.fn();
  public readonly style: Record<string, string> = {};
  public readonly submit = vi.fn();
  public textContent = '';
  public type = '';
  public value = '';
  private readonly listeners = new Map<string, DomListener[]>();

  constructor(public readonly tagName: string) {}

  public get childNodes(): ElementFixture[] {
    return this.children;
  }

  public get firstChild(): ElementFixture | null {
    return this.children[0] ?? null;
  }

  public addEventListener(name: string, listener: DomListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  public cloneNode(deep: boolean): ElementFixture {
    const clone = new ElementFixture(this.tagName);
    clone.className = this.className;
    clone.textContent = this.textContent;
    if (deep) {
      this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
    }
    return clone;
  }

  public closest(selector: string): ElementFixture | null {
    return selector === 'button' ? this.closestButton : null;
  }

  public remove(): void {
    this.parentNode?.removeChild(this);
  }

  public removeChild(child: ElementFixture): ElementFixture {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string, event: DomEvent = { target: this }): void {
    this.listeners.get(name)?.forEach(listener => listener(event));
  }
}

function setupDom(
  options: {
    activeElement?: ElementFixture | null;
    clipboardError?: Error;
    confirmationForms?: ElementFixture[];
    copyTriggers?: ElementFixture[];
    elementsById?: Record<string, ElementFixture>;
    withLucide?: boolean;
  } = {}
) {
  const body = new ElementFixture('body');
  const created: ElementFixture[] = [];
  const documentListeners = new Map<string, Set<DomListener>>();
  const createIcons = vi.fn();
  const execCommand = vi.fn();
  const writeText = options.clipboardError
    ? vi.fn().mockRejectedValue(options.clipboardError)
    : vi.fn().mockResolvedValue(undefined);
  const browserWindow: Record<string, unknown> = {
    location: { pathname: '/admin/jwks' },
  };
  if (options.withLucide !== false) {
    browserWindow.lucide = { createIcons };
  }

  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('document', {
    activeElement: options.activeElement ?? null,
    addEventListener: vi.fn((name: string, listener: DomListener) => {
      const listeners = documentListeners.get(name) ?? new Set<DomListener>();
      listeners.add(listener);
      documentListeners.set(name, listeners);
    }),
    body,
    createElement: vi.fn((tagName: string) => {
      const element = new ElementFixture(tagName);
      created.push(element);
      return element;
    }),
    execCommand,
    getElementById: vi.fn((id: string) => options.elementsById?.[id] ?? null),
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === '[data-jwks-confirm]') {
        return options.confirmationForms ?? [];
      }
      if (selector === '[data-jwks-copy], [data-jwks-copy-target]') {
        return options.copyTriggers ?? [];
      }
      return [];
    }),
    removeEventListener: vi.fn((name: string, listener: DomListener) => {
      documentListeners.get(name)?.delete(listener);
    }),
  });

  return {
    body,
    browserWindow,
    createIcons,
    created,
    dispatchDocument: (name: string, event: DomEvent) =>
      documentListeners.get(name)?.forEach(listener => listener(event)),
    documentListeners,
    execCommand,
    manager: new AdminJwksManager(),
    writeText,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('admin JWKS controls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens an accessible rotation dialog through a declarative form', async () => {
    const form = new ElementFixture('form');
    form.dataset.jwksConfirm = 'rotate';
    const trigger = new ElementFixture('button');
    const { body, browserWindow, created, dispatchDocument, manager } =
      setupDom({ activeElement: trigger, confirmationForms: [form] });
    manager.initialize();
    const event = {
      currentTarget: form,
      preventDefault: vi.fn(),
      target: form,
    };

    form.trigger('submit', event);

    const dialog = created.find(
      element => element.attributes.get('role') === 'dialog'
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(dialog?.attributes.get('aria-modal')).toBe('true');
    expect(dialog?.attributes.get('aria-labelledby')).toBeTruthy();
    expect(dialog?.attributes.get('aria-describedby')).toBeTruthy();
    const confirm = created.find(
      element =>
        element.tagName === 'button' &&
        element.textContent === 'Yes, Rotate Keys'
    );
    expect(confirm?.focus).toHaveBeenCalledOnce();

    dispatchDocument('keydown', { key: 'Escape' });
    await flushPromises();

    expect(body.children).toHaveLength(0);
    expect(trigger.focus).toHaveBeenCalledOnce();
    expect(form.submit).not.toHaveBeenCalled();
    expect(browserWindow).not.toHaveProperty('confirmRotateKeys');
    expect(browserWindow).not.toHaveProperty('copyToClipboard');
  });

  it('submits rotation after confirmation and releases the keyboard listener', async () => {
    const form = new ElementFixture('form');
    form.dataset.jwksConfirm = 'rotate';
    const { created, documentListeners, manager } = setupDom({
      confirmationForms: [form],
    });
    manager.initialize();
    const event = {
      currentTarget: form,
      preventDefault: vi.fn(),
      target: form,
    };

    form.trigger('submit', event);
    created
      .find(element => element.textContent === 'Yes, Rotate Keys')
      ?.trigger('click');
    await flushPromises();

    expect(form.submit).toHaveBeenCalledOnce();
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it('cancels expired-key retirement through the backdrop and Escape', async () => {
    const form = new ElementFixture('form');
    form.dataset.jwksConfirm = 'retire-expired';
    const { body, dispatchDocument, manager } = setupDom({
      confirmationForms: [form],
      withLucide: false,
    });
    manager.initialize();
    const event = {
      currentTarget: form,
      preventDefault: vi.fn(),
      target: form,
    };

    form.trigger('submit', event);
    const firstBackdrop = body.children[0];
    firstBackdrop.trigger('click', { target: firstBackdrop.children[0] });
    expect(body.children).toHaveLength(1);
    firstBackdrop.trigger('click', { target: firstBackdrop });
    await flushPromises();

    form.trigger('submit', event);
    dispatchDocument('keydown', { key: 'Enter' });
    expect(body.children).toHaveLength(1);
    dispatchDocument('keydown', { key: 'Escape' });
    await flushPromises();

    expect(body.children).toHaveLength(0);
    expect(form.submit).not.toHaveBeenCalled();
  });

  it('submits expired-key retirement after confirmation', async () => {
    const form = new ElementFixture('form');
    form.dataset.jwksConfirm = 'retire-expired';
    const { created, manager } = setupDom({ confirmationForms: [form] });
    manager.initialize();

    form.trigger('submit', {
      currentTarget: form,
      preventDefault: vi.fn(),
      target: form,
    });
    created
      .find(element => element.textContent === 'Yes, Retire Expired')
      ?.trigger('click');
    await flushPromises();

    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('copies a rendered key ID through a declarative button', async () => {
    vi.useFakeTimers();
    const copyButton = new ElementFixture('button');
    copyButton.dataset.jwksCopy = 'key-id';
    copyButton.closestButton = copyButton;
    const { manager, writeText } = setupDom({ copyTriggers: [copyButton] });
    manager.initialize();

    copyButton.trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith('key-id');
    vi.runAllTimers();
  });

  it('copies the rendered public JWK through a target reference', async () => {
    vi.useFakeTimers();
    const copyButton = new ElementFixture('button');
    copyButton.dataset.jwksCopyTarget = 'public-jwk-json';
    copyButton.closestButton = copyButton;
    const publicJwk = new ElementFixture('pre');
    publicJwk.textContent = '{"kty":"RSA"}';
    const { manager, writeText } = setupDom({
      copyTriggers: [copyButton],
      elementsById: { 'public-jwk-json': publicJwk },
    });
    manager.initialize();

    copyButton.trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith('{"kty":"RSA"}');
    vi.runAllTimers();
  });

  it('shows and restores clipboard feedback on the trigger button', async () => {
    vi.useFakeTimers();
    const button = new ElementFixture('button');
    const original = new ElementFixture('span');
    original.textContent = 'Copy';
    button.appendChild(original);
    button.closestButton = button;
    const { createIcons, manager } = setupDom();

    await manager.copyToClipboard('public-jwk', button as never);

    expect(button.children[0]?.attributes.get('data-lucide')).toBe('check');
    expect(button.classList.add).toHaveBeenCalledWith('text-green-600');
    vi.advanceTimersByTime(2000);
    expect(button.children[0]?.textContent).toBe('Copy');
    expect(button.classList.remove).toHaveBeenCalledWith('text-green-600');
    expect(createIcons).toHaveBeenCalledTimes(2);
  });

  it('falls back to a temporary textarea when clipboard writing fails', async () => {
    const { body, created, execCommand, manager } = setupDom({
      clipboardError: new Error('denied'),
    });

    await manager.copyToClipboard('fallback-value');

    const textArea = created.find(element => element.tagName === 'textarea');
    expect(textArea).toMatchObject({
      style: { opacity: '0', position: 'fixed' },
      value: 'fallback-value',
    });
    expect(textArea?.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(body.children).toHaveLength(0);
  });

  it('ignores copy controls without an inline value or target', async () => {
    const copyButton = new ElementFixture('button');
    const { manager, writeText } = setupDom({ copyTriggers: [copyButton] });
    manager.initialize();

    copyButton.trigger('click');
    await flushPromises();

    expect(writeText).not.toHaveBeenCalled();
  });

  it('ignores copy controls without a value or a resolvable target', async () => {
    const copyButton = new ElementFixture('button');
    copyButton.dataset.jwksCopyTarget = 'missing';
    const { manager, writeText } = setupDom({ copyTriggers: [copyButton] });
    manager.initialize();

    copyButton.trigger('click');
    await flushPromises();

    expect(writeText).not.toHaveBeenCalled();
  });
  it('cancels rotation with the accessible cancel button', async () => {
    const form = new ElementFixture('form');
    const { body, created, manager } = setupDom();
    const result = manager.confirmRotateKeys({
      currentTarget: form,
      preventDefault: vi.fn(),
    } as never);

    created.find(element => element.textContent === 'Cancel')?.trigger('click');

    await expect(result).resolves.toBe(false);
    expect(body.children).toHaveLength(0);
    expect(form.submit).not.toHaveBeenCalled();
  });

  it('uses the event target for rotation when currentTarget is unavailable', async () => {
    const form = new ElementFixture('form');
    const { created, manager } = setupDom();
    const result = manager.confirmRotateKeys({
      preventDefault: vi.fn(),
      target: form,
    } as never);

    created.find(element => element.textContent === 'Cancel')?.trigger('click');

    await expect(result).resolves.toBe(false);
    expect(form.submit).not.toHaveBeenCalled();
  });

  it('uses the event target when currentTarget is unavailable', async () => {
    const form = new ElementFixture('form');
    const { created, manager } = setupDom();
    const result = manager.confirmRetireExpired({
      preventDefault: vi.fn(),
      target: form,
    } as never);

    created
      .find(element => element.textContent === 'Yes, Retire Expired')
      ?.trigger('click');

    await expect(result).resolves.toBe(true);
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('automatically initializes only on the JWKS administration route', async () => {
    vi.resetModules();
    const listeners = new Map<string, DomListener>();
    const querySelectorAll = vi.fn(() => []);
    vi.stubGlobal('window', { location: { pathname: '/admin/jwks/keys' } });
    vi.stubGlobal('document', {
      addEventListener: vi.fn((name: string, listener: DomListener) =>
        listeners.set(name, listener)
      ),
      querySelectorAll,
    });

    await import('../../../src/assets/js/admin/jwks.js');
    listeners.get('DOMContentLoaded')?.({});

    expect(querySelectorAll).toHaveBeenCalledTimes(2);
    expect(
      (window as Window & { adminJwksManager?: unknown }).adminJwksManager
    ).toBeTypeOf('object');
  });

  it('does not initialize automatically outside the JWKS administration route', async () => {
    vi.resetModules();
    const listeners = new Map<string, DomListener>();
    const querySelectorAll = vi.fn(() => []);
    vi.stubGlobal('window', { location: { pathname: '/admin/users' } });
    vi.stubGlobal('document', {
      addEventListener: vi.fn((name: string, listener: DomListener) =>
        listeners.set(name, listener)
      ),
      querySelectorAll,
    });

    await import('../../../src/assets/js/admin/jwks.js');
    listeners.get('DOMContentLoaded')?.({});

    expect(querySelectorAll).not.toHaveBeenCalled();
    expect(
      (window as Window & { adminJwksManager?: unknown }).adminJwksManager
    ).toBeUndefined();
  });
});
