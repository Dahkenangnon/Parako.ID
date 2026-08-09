import { afterEach, describe, expect, it, vi } from 'vitest';

type DomEvent = { key?: string; target?: unknown };
type DomListener = (event: DomEvent) => void;

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public className = '';
  public closestButton: ElementFixture | null = null;
  public readonly focus = vi.fn();
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
    if (deep)
      this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
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

function setupInteractiveDom(
  options: {
    copyButton?: ElementFixture | null;
    jwkJson?: ElementFixture | null;
    withLucide?: boolean;
  } = {}
) {
  const body = new ElementFixture('body');
  const created: ElementFixture[] = [];
  const documentListeners = new Map<string, Set<DomListener>>();
  const createIcons = vi.fn();
  const execCommand = vi.fn();
  const browserWindow: Record<string, unknown> = {
    location: { pathname: '/admin/jwks' },
  };
  if (options.withLucide !== false) {
    browserWindow.lucide = { createIcons };
  }
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
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
    getElementById: vi.fn((id: string) =>
      id === 'copy-public-jwk'
        ? (options.copyButton ?? null)
        : id === 'public-jwk-json'
          ? (options.jwkJson ?? null)
          : null
    ),
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
    runReady: () =>
      documentListeners
        .get('DOMContentLoaded')
        ?.forEach(listener => listener({})),
  };
}

function setupDom(
  options: {
    pathname?: string;
  } = {}
) {
  let ready: (() => void) | undefined;
  const browserWindow: Record<string, unknown> = {
    location: { pathname: options.pathname ?? '/admin/jwks' },
  };
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      if (_name === 'DOMContentLoaded') ready = listener;
    }),
    getElementById: vi.fn(() => null),
  });
  return { browserWindow, runReady: () => ready?.() };
}

describe('admin JWKS controls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/jwks.js')
    ).resolves.toBeDefined();
  });

  it('does not expose JWKS handlers on unrelated pages', async () => {
    const { browserWindow, runReady } = setupDom({ pathname: '/admin/users' });
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();

    expect(browserWindow).not.toHaveProperty('confirmRotateKeys');
    expect(browserWindow).not.toHaveProperty('confirmRetireExpired');
    expect(browserWindow).not.toHaveProperty('copyToClipboard');
  });

  it('exposes JWKS handlers when optional copy elements are absent', async () => {
    const { browserWindow, runReady } = setupDom();
    await import('../../../src/assets/js/admin/jwks.js');

    expect(runReady).not.toThrow();
    expect(browserWindow).toMatchObject({
      confirmRetireExpired: expect.any(Function),
      confirmRotateKeys: expect.any(Function),
      copyToClipboard: expect.any(Function),
    });
  });

  it('cancels key rotation and removes all dialog listeners', async () => {
    const {
      body,
      browserWindow,
      createIcons,
      created,
      documentListeners,
      runReady,
    } = setupInteractiveDom();
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();
    const form = new ElementFixture('form');
    const event = { preventDefault: vi.fn(), target: form };

    const result = (
      browserWindow.confirmRotateKeys as (
        value: typeof event
      ) => Promise<boolean>
    )(event);
    const cancel = created.find(
      element =>
        element.tagName === 'button' && element.textContent === 'Cancel'
    );
    const alertIcon = created.find(
      element => element.attributes.get('data-lucide') === 'alert-triangle'
    );
    const confirm = created.find(
      element =>
        element.tagName === 'button' &&
        element.textContent === 'Yes, Rotate Keys'
    );
    expect(alertIcon?.className).toContain('text-amber-500');
    expect(confirm?.className).toContain('bg-amber-500');
    cancel?.trigger('click');

    await expect(result).resolves.toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(form.submit).not.toHaveBeenCalled();
    expect(body.children).toHaveLength(0);
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);
    expect(createIcons).toHaveBeenCalledOnce();
  });

  it('submits key rotation after confirmation and releases its listener', async () => {
    const { browserWindow, created, documentListeners, runReady } =
      setupInteractiveDom();
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();
    const form = new ElementFixture('form');
    const event = { preventDefault: vi.fn(), target: form };

    const result = (
      browserWindow.confirmRotateKeys as (
        value: typeof event
      ) => Promise<boolean>
    )(event);
    const confirm = created.find(
      element =>
        element.tagName === 'button' &&
        element.textContent === 'Yes, Rotate Keys'
    );
    confirm?.trigger('click');

    await expect(result).resolves.toBe(true);
    expect(form.submit).toHaveBeenCalledOnce();
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it('cancels retiring expired keys only when the dialog backdrop is clicked', async () => {
    const { body, browserWindow, created, runReady } = setupInteractiveDom();
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();
    const form = new ElementFixture('form');
    const event = { preventDefault: vi.fn(), target: form };

    const result = (
      browserWindow.confirmRetireExpired as (
        value: typeof event
      ) => Promise<boolean>
    )(event);
    const backdrop = created.find(element =>
      element.className.includes('fixed inset-0')
    );
    backdrop?.trigger('click', { target: new ElementFixture('div') });
    expect(body.children).toHaveLength(1);
    backdrop?.trigger('click', { target: backdrop });

    await expect(result).resolves.toBe(false);
    expect(form.submit).not.toHaveBeenCalled();
    expect(body.children).toHaveLength(0);
  });

  it('submits expired-key retirement after confirmation', async () => {
    const { browserWindow, created, runReady } = setupInteractiveDom();
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();
    const form = new ElementFixture('form');
    const event = { preventDefault: vi.fn(), target: form };

    const result = (
      browserWindow.confirmRetireExpired as (
        value: typeof event
      ) => Promise<boolean>
    )(event);
    const confirm = created.find(
      element =>
        element.tagName === 'button' &&
        element.textContent === 'Yes, Retire Expired'
    );
    confirm?.trigger('click');

    await expect(result).resolves.toBe(true);
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('ignores unrelated keys and cancels a dialog with Escape', async () => {
    const { browserWindow, dispatchDocument, runReady } = setupInteractiveDom();
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();
    const form = new ElementFixture('form');
    const event = { preventDefault: vi.fn(), target: form };
    let settled = false;

    const result = (
      browserWindow.confirmRetireExpired as (
        value: typeof event
      ) => Promise<boolean>
    )(event);
    void result.then(() => {
      settled = true;
    });
    dispatchDocument('keydown', { key: 'Enter' });
    await Promise.resolve();
    expect(settled).toBe(false);

    dispatchDocument('keydown', { key: 'Escape' });
    await expect(result).resolves.toBe(false);
    expect(form.submit).not.toHaveBeenCalled();
  });

  it('copies text without requiring a visual trigger element', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { browserWindow, runReady } = setupInteractiveDom();
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();

    await (browserWindow.copyToClipboard as (text: string) => Promise<void>)(
      'key-id'
    );

    expect(writeText).toHaveBeenCalledWith('key-id');
  });

  it('shows and then restores clipboard success feedback on the trigger button', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { browserWindow, createIcons, runReady } = setupInteractiveDom();
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();
    const button = new ElementFixture('button');
    const original = new ElementFixture('span');
    original.textContent = 'Copy';
    button.appendChild(original);
    const trigger = new ElementFixture('i');
    trigger.closestButton = button;

    await (
      browserWindow.copyToClipboard as (
        text: string,
        trigger: ElementFixture
      ) => Promise<void>
    )('public-jwk', trigger);

    expect(button.children).toHaveLength(1);
    expect(button.children[0]?.attributes.get('data-lucide')).toBe('check');
    expect(button.classList.add).toHaveBeenCalledWith('text-green-600');

    vi.advanceTimersByTime(2000);

    expect(button.children).toHaveLength(1);
    expect(button.children[0]?.textContent).toBe('Copy');
    expect(button.classList.remove).toHaveBeenCalledWith('text-green-600');
    expect(createIcons).toHaveBeenCalledTimes(2);
  });

  it('falls back to a temporary textarea when the Clipboard API fails', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const { body, browserWindow, created, execCommand, runReady } =
      setupInteractiveDom();
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();

    await (browserWindow.copyToClipboard as (text: string) => Promise<void>)(
      'fallback-value'
    );

    const textArea = created.find(element => element.tagName === 'textarea');
    expect(textArea).toMatchObject({
      style: { opacity: '0', position: 'fixed' },
      value: 'fallback-value',
    });
    expect(textArea?.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(body.children).toHaveLength(0);
  });

  it('copies the rendered public JWK when its page button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const copyButton = new ElementFixture('button');
    const jwkJson = new ElementFixture('pre');
    jwkJson.textContent = '{"kty":"RSA"}';
    const { runReady } = setupInteractiveDom({ copyButton, jwkJson });
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();

    copyButton.trigger('click');

    expect(writeText).toHaveBeenCalledWith('{"kty":"RSA"}');
  });

  it('copies empty rendered content when the optional icon runtime is absent', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const copyButton = new ElementFixture('button');
    copyButton.closestButton = copyButton;
    const jwkJson = new ElementFixture('pre');
    jwkJson.textContent = '';
    const { runReady } = setupInteractiveDom({
      copyButton,
      jwkJson,
      withLucide: false,
    });
    await import('../../../src/assets/js/admin/jwks.js');
    runReady();

    copyButton.trigger('click');
    await Promise.resolve();
    vi.advanceTimersByTime(2000);

    expect(writeText).toHaveBeenCalledWith('');
  });
});
