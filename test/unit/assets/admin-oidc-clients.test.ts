import { afterEach, describe, expect, it, vi } from 'vitest';

type DomEvent = {
  currentTarget?: unknown;
  key?: string;
  preventDefault?: () => void;
  target?: unknown;
};
type DomListener = (event: DomEvent) => void;

type AdminOidcClientsManagerFixture = {
  confirmDeactivateClient: (event: DomEvent) => Promise<boolean>;
  confirmDeleteClient: (event: DomEvent) => Promise<boolean>;
  confirmRegenerateSecret: (event: DomEvent) => Promise<boolean>;
  copyToClipboard: (
    text: string,
    triggerElement?: ElementFixture
  ) => Promise<void>;
};

function getManager(
  browserWindow: Record<string, unknown>
): AdminOidcClientsManagerFixture {
  const manager = browserWindow.adminOidcClientsManager as
    AdminOidcClientsManagerFixture | undefined;
  if (!manager) throw new Error('OIDC client manager was not initialized');
  return manager;
}

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public className = '';
  public closestButton: ElementFixture | null = null;
  public readonly dataset: Record<string, string> = {};
  public readonly focus = vi.fn();
  public innerHTML = '';
  public parentNode: ElementFixture | null = null;
  public readonly submit = vi.fn();
  public textContent = '';
  public type = '';
  private readonly listeners = new Map<string, DomListener[]>();

  constructor(public readonly tagName: string) {}

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
    clipboardError?: Error;
    activeElement?: ElementFixture | null;
    confirmationForms?: ElementFixture[];
    copyTriggers?: ElementFixture[];
    pathname?: string;
    withLucide?: boolean;
  } = {}
) {
  const body = new ElementFixture('body');
  const created: ElementFixture[] = [];
  const documentListeners = new Map<string, Set<DomListener>>();
  const createIcons = vi.fn();
  const writeText = options.clipboardError
    ? vi.fn().mockRejectedValue(options.clipboardError)
    : vi.fn().mockResolvedValue(undefined);
  const browserWindow: Record<string, unknown> = {
    location: { pathname: options.pathname ?? '/admin/oidc-clients' },
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
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === '[data-oidc-client-confirm]') {
        return options.confirmationForms ?? [];
      }
      if (selector === '[data-oidc-copy]') {
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
    runReady: () =>
      documentListeners
        .get('DOMContentLoaded')
        ?.forEach(listener => listener({})),
    writeText,
  };
}

describe('admin OIDC clients manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/oidc-clients.js')
    ).resolves.toBeDefined();
  });

  it('opens an accessible confirmation dialog without inline handlers', async () => {
    const form = new ElementFixture('form');
    form.dataset.oidcClientConfirm = 'deactivate';
    const submitButton = new ElementFixture('button');
    const { body, created, dispatchDocument, runReady } = setupDom({
      activeElement: submitButton,
      confirmationForms: [form],
    });
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();
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
        element.textContent === 'Yes, Deactivate'
    );
    expect(confirm?.focus).toHaveBeenCalledOnce();

    dispatchDocument('keydown', { key: 'Escape' });
    await Promise.resolve();

    expect(body.children).toHaveLength(0);
    expect(submitButton.focus).toHaveBeenCalledOnce();
    expect(form.submit).not.toHaveBeenCalled();
  });

  it('copies visible client data without inline handlers', async () => {
    vi.useFakeTimers();
    const copyButton = new ElementFixture('button');
    copyButton.dataset.oidcCopy = 'client-id';
    copyButton.closestButton = copyButton;
    const { runReady, writeText } = setupDom({ copyTriggers: [copyButton] });
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();

    copyButton.trigger('click', {
      currentTarget: copyButton,
      target: copyButton,
    });
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('client-id');
    vi.runAllTimers();
  });

  it('does not expose handlers on a sibling path with the same prefix', async () => {
    const { browserWindow, runReady } = setupDom({
      pathname: '/admin/oidc-clients-preview',
    });
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();

    expect(browserWindow).not.toHaveProperty('confirmDeactivateClient');
    expect(browserWindow).not.toHaveProperty('confirmDeleteClient');
    expect(browserWindow).not.toHaveProperty('confirmRegenerateSecret');
    expect(browserWindow).not.toHaveProperty('copyToClipboard');
  });

  it('cancels deactivation and removes the dialog keyboard listener', async () => {
    const { body, browserWindow, created, documentListeners, runReady } =
      setupDom();
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();
    const form = new ElementFixture('form');
    const event = { preventDefault: vi.fn(), target: form };

    const result = getManager(browserWindow).confirmDeactivateClient(event);
    const cancel = created.find(
      element =>
        element.tagName === 'button' && element.textContent === 'Cancel'
    );
    cancel?.trigger('click');

    await expect(result).resolves.toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(form.submit).not.toHaveBeenCalled();
    expect(body.children).toHaveLength(0);
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it('submits confirmed deactivation, deletion, and secret regeneration', async () => {
    const { browserWindow, createIcons, created, runReady } = setupDom();
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();

    for (const [handlerName, confirmText, color] of [
      ['confirmDeactivateClient', 'Yes, Deactivate', 'bg-amber-500'],
      ['confirmDeleteClient', 'Yes, Delete Permanently', 'bg-red-600'],
      ['confirmRegenerateSecret', 'Yes, Regenerate Secret', 'bg-red-600'],
    ] as const) {
      const form = new ElementFixture('form');
      const event = { preventDefault: vi.fn(), target: form };
      const result = getManager(browserWindow)[handlerName](event);
      const confirm = created.find(
        element =>
          element.tagName === 'button' && element.textContent === confirmText
      );
      expect(confirm?.className).toContain(color);
      expect(confirm?.focus).toHaveBeenCalledOnce();
      confirm?.trigger('click');

      await expect(result).resolves.toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(form.submit).toHaveBeenCalledOnce();
    }

    expect(createIcons).toHaveBeenCalledTimes(3);
  });

  it('cancels regeneration through Escape and the dialog backdrop only', async () => {
    const {
      body,
      browserWindow,
      dispatchDocument,
      documentListeners,
      runReady,
    } = setupDom({ withLucide: false });
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();
    const form = new ElementFixture('form');
    const event = { preventDefault: vi.fn(), target: form };

    const escapeResult =
      getManager(browserWindow).confirmRegenerateSecret(event);
    dispatchDocument('keydown', { key: 'Enter' });
    expect(body.children).toHaveLength(1);
    dispatchDocument('keydown', { key: 'Escape' });
    await expect(escapeResult).resolves.toBe(false);
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);

    const backdropResult =
      getManager(browserWindow).confirmRegenerateSecret(event);
    const backdrop = body.children[0];
    backdrop.trigger('click', { target: backdrop.children[0] });
    expect(body.children).toHaveLength(1);
    backdrop.trigger('click', { target: backdrop });
    await expect(backdropResult).resolves.toBe(false);

    const deleteResult = getManager(browserWindow).confirmDeleteClient(event);
    const cancel = body.children[0].children[0].children[2].children[0];
    cancel.trigger('click');
    await expect(deleteResult).resolves.toBe(false);
    expect(form.submit).not.toHaveBeenCalled();
  });

  it('copies text, shows feedback, and restores the trigger button', async () => {
    vi.useFakeTimers();
    const { body, browserWindow, createIcons, created, runReady, writeText } =
      setupDom();
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();
    const button = new ElementFixture('button');
    button.innerHTML = '<i>copy</i>';
    const trigger = new ElementFixture('span');
    trigger.closestButton = button;

    await getManager(browserWindow).copyToClipboard('client-secret', trigger);

    expect(writeText).toHaveBeenCalledWith('client-secret');
    expect(button.innerHTML).toContain('data-lucide="check"');
    expect(button.classList.add).toHaveBeenCalledWith('text-green-600');
    expect(created.some(element => element.textContent === 'Copied!')).toBe(
      true
    );
    expect(body.children).toHaveLength(1);

    vi.advanceTimersByTime(2000);
    expect(button.innerHTML).toBe('<i>copy</i>');
    expect(button.classList.remove).toHaveBeenCalledWith('text-green-600');
    expect(createIcons).toHaveBeenCalledTimes(3);

    const close = created.find(
      element =>
        element.tagName === 'button' &&
        element.children.some(
          child => child.attributes.get('data-lucide') === 'x'
        )
    );
    close?.trigger('click');
    expect(body.children).toHaveLength(0);
  });

  it('auto-removes success feedback without an icon runtime', async () => {
    vi.useFakeTimers();
    const { body, browserWindow, runReady } = setupDom({ withLucide: false });
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();
    const button = new ElementFixture('button');
    button.innerHTML = '<i>copy</i>';
    const trigger = new ElementFixture('span');
    trigger.closestButton = button;

    await getManager(browserWindow).copyToClipboard('client-id', trigger);
    expect(body.children).toHaveLength(1);

    vi.advanceTimersByTime(2000);
    expect(button.innerHTML).toBe('<i>copy</i>');
    expect(body.children).toHaveLength(1);

    vi.advanceTimersByTime(3000);
    expect(body.children).toHaveLength(0);

    await getManager(browserWindow).copyToClipboard(
      'client-id-without-trigger'
    );
    expect(body.children).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(body.children).toHaveLength(0);
  });

  it('shows error feedback when clipboard writing fails', async () => {
    const error = new Error('clipboard blocked');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { browserWindow, created, runReady } = setupDom({
      clipboardError: error,
      withLucide: false,
    });
    await import('../../../src/assets/js/admin/oidc-clients.js');
    runReady();

    await getManager(browserWindow).copyToClipboard('client-id');

    expect(errorSpy).toHaveBeenCalledWith('Could not copy text: ', error);
    expect(created.some(element => element.textContent === 'Copy Failed')).toBe(
      true
    );
    expect(
      created.some(element => element.className.includes('bg-red-500'))
    ).toBe(true);
  });

  it('exposes handlers on nested client routes', async () => {
    const { browserWindow, runReady } = setupDom({
      pathname: '/admin/oidc-clients/view/client-1',
    });
    await import('../../../src/assets/js/admin/oidc-clients.js');
    expect(runReady).not.toThrow();
    expect(browserWindow).toHaveProperty('adminOidcClientsManager');
  });
});
