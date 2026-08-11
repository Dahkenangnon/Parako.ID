import { afterEach, describe, expect, it, vi } from 'vitest';

interface PasskeyCredential {
  credential_id: string;
  friendly_name: string;
  device_type: 'singleDevice' | 'multiDevice';
  backed_up: boolean;
  created_at: string;
  last_used_at?: string;
}

interface DomEventFixture {
  key?: string;
  target?: ElementFixture;
}

class ClassListFixture {
  private readonly values = new Set<string>();

  add = vi.fn((...names: string[]) =>
    names.forEach(name => this.values.add(name))
  );
  remove = vi.fn((...names: string[]) =>
    names.forEach(name => this.values.delete(name))
  );
  contains = vi.fn((name: string) => this.values.has(name));
}

class ElementFixture {
  public readonly classList = new ClassListFixture();
  public readonly dataset: Record<string, string> = {};
  public readonly listeners = new Map<
    string,
    Array<(event: DomEventFixture) => unknown>
  >();
  public readonly children: ElementFixture[] = [];
  public readonly queries = new Map<string, ElementFixture | null>();
  public className = '';
  public id = '';
  public value = '';
  public parentElement: ElementFixture | null = null;
  public removed = false;
  public focused = false;
  public selected = false;
  private renderedHtml = '';
  private renderedText = '';

  get innerHTML(): string {
    return this.renderedHtml;
  }

  set innerHTML(value: string) {
    this.renderedHtml = value;
    if (value === '') this.children.length = 0;
  }

  get textContent(): string {
    return this.renderedText;
  }

  set textContent(value: string) {
    this.renderedText = value;
    this.renderedHtml = value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  addEventListener = vi.fn(
    (type: string, listener: (event: DomEventFixture) => unknown) => {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
  );

  appendChild = vi.fn((child: ElementFixture) => {
    this.children.push(child);
    child.parentElement = this;
    return child;
  });

  querySelector = vi.fn((selector: string): ElementFixture | null => {
    if (this.queries.has(selector)) return this.queries.get(selector) ?? null;
    const match = selector.match(/^\[data-credential-id="(.*)"\]$/);
    if (match) {
      return (
        this.children.find(child => child.dataset.credentialId === match[1]) ??
        null
      );
    }
    return null;
  });

  remove = vi.fn(() => {
    this.removed = true;
    if (this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
    }
  });

  focus = vi.fn(() => {
    this.focused = true;
  });

  select = vi.fn(() => {
    this.selected = true;
  });

  async trigger(type: string, event: DomEventFixture = {}): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
  }
}

class TemplateFixture extends ElementFixture {
  public readonly content: { cloneNode: ReturnType<typeof vi.fn> };

  constructor(factory: () => ElementFixture) {
    super();
    this.content = { cloneNode: vi.fn(() => factory()) };
  }
}

function credential(
  overrides: Partial<PasskeyCredential> = {}
): PasskeyCredential {
  return {
    credential_id: 'credential-1',
    friendly_name: 'Laptop passkey',
    device_type: 'singleDevice',
    backed_up: false,
    created_at: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

const translations = {
  loading: 'Loading',
  addPasskey: 'Add passkey',
  adding: 'Adding',
  rename: 'Rename',
  delete: 'Delete',
  deleteConfirmTitle: 'Delete passkey',
  deleteConfirmMessage: 'Delete this passkey?',
  successAdded: 'Added',
  successRenamed: 'Renamed',
  successDeleted: 'Deleted',
  errorLoading: 'Could not load',
  errorAdding: 'Could not add',
  errorRenaming: 'Could not rename',
  errorDeleting: 'Could not delete',
  errorNotSupported: 'Not supported',
  lastUsed: 'Last used',
  neverUsed: 'Never used',
  createdOn: 'Created on',
  platform: 'Platform',
  crossPlatform: 'Security key',
  singleDevice: 'Single device',
  multiDevice: 'Synced',
};

function state(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      apiBasePath: '/api',
      credentialsUrl: '/api/webauthn/credentials',
      registerUrl: '/account/passkeys/register',
      csrfToken: 'csrf-token',
      debug: false,
    },
    translations,
    ...overrides,
  };
}

function itemFixture(
  options: { includeFields?: boolean; includeActions?: boolean } = {}
) {
  const item = new ElementFixture();
  const rename = new ElementFixture();
  const remove = new ElementFixture();
  if (options.includeActions !== false) {
    item.queries.set('.passkey-rename-btn', rename);
    item.queries.set('.passkey-delete-btn', remove);
  }

  if (options.includeFields !== false) {
    for (const selector of [
      '.passkey-name',
      '.passkey-device',
      '.passkey-created',
      '.passkey-last-used',
      '.passkey-icon svg',
    ]) {
      item.queries.set(selector, new ElementFixture());
    }
  }

  const fragment = new ElementFixture();
  fragment.queries.set('.passkey-item', item);
  return { fragment, item, rename, remove };
}

function modalFixture(options: { includeControls?: boolean } = {}) {
  const wrapper = new ElementFixture();
  // A template's top-level element is parented by a DocumentFragment, so its
  // parentElement is null. Model that browser behavior to catch code that
  // incorrectly tries to append the fragment through parentElement.
  const dialog = wrapper;
  const overlay = new ElementFixture();
  wrapper.queries.set('.fixed.inset-0.bg-gray-500', overlay);

  const input = new ElementFixture();
  const confirmButton = new ElementFixture();
  const cancelButton = new ElementFixture();
  if (options.includeControls !== false) {
    wrapper.queries.set('#new-passkey-name', input);
    wrapper.queries.set('#rename-confirm-btn', confirmButton);
    wrapper.queries.set('#rename-cancel-btn', cancelButton);
  }

  const fragment = new ElementFixture();
  fragment.queries.set('[role="dialog"]', dialog);
  return {
    fragment,
    wrapper,
    dialog,
    overlay,
    input,
    confirmButton,
    cancelButton,
  };
}

interface SetupOptions {
  stateText?: string | null;
  includeList?: boolean;
  includeLoading?: boolean;
  includeEmpty?: boolean;
  includeButtons?: boolean;
  itemFactory?: () => ReturnType<typeof itemFixture>;
  modalFactory?: () => ReturnType<typeof modalFixture>;
  createElementFactory?: (tag: string, index: number) => ElementFixture;
}

async function setup(options: SetupOptions = {}) {
  vi.resetModules();
  const elements = new Map<string, ElementFixture>();
  const stateElement = new ElementFixture();
  stateElement.textContent =
    options.stateText === undefined
      ? JSON.stringify(state())
      : (options.stateText ?? '');
  if (options.stateText !== null)
    elements.set('___PASSKEYS_STATE___', stateElement);

  const loading = new ElementFixture();
  const empty = new ElementFixture();
  const list = new ElementFixture();
  const addButton = new ElementFixture();
  const emptyAddButton = new ElementFixture();
  if (options.includeLoading !== false)
    elements.set('passkeys-loading', loading);
  if (options.includeEmpty !== false) elements.set('passkeys-empty', empty);
  if (options.includeList !== false) elements.set('passkeys-list', list);
  if (options.includeButtons !== false) {
    elements.set('add-passkey-btn', addButton);
    elements.set('add-passkey-btn-empty', emptyAddButton);
  }

  const createdItems: ReturnType<typeof itemFixture>[] = [];
  if (options.itemFactory) {
    const template = new TemplateFixture(() => {
      const created = options.itemFactory?.() ?? itemFixture();
      createdItems.push(created);
      return created.fragment;
    });
    elements.set('passkey-item-template', template);
  }

  const createdModals: ReturnType<typeof modalFixture>[] = [];
  if (options.modalFactory) {
    const template = new TemplateFixture(() => {
      const created = options.modalFactory?.() ?? modalFixture();
      createdModals.push(created);
      return created.fragment;
    });
    elements.set('rename-modal-template', template);
  }

  const body = new ElementFixture();
  const createdElements: ElementFixture[] = [];
  const documentListeners = new Map<string, Array<(event: Event) => unknown>>();
  const documentRoot = {
    body,
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    createElement: vi.fn((tag: string) => {
      const element =
        options.createElementFactory?.(tag, createdElements.length) ??
        new ElementFixture();
      createdElements.push(element);
      return element;
    }),
    addEventListener: vi.fn(
      (type: string, listener: (event: Event) => unknown) => {
        const listeners = documentListeners.get(type) ?? [];
        listeners.push(listener);
        documentListeners.set(type, listeners);
      }
    ),
  };
  const windowRoot = {
    location: { href: 'https://rp.example/account/passkeys' },
  };
  const fetchMock = vi.fn();
  const confirmMock = vi.fn();
  vi.stubGlobal('document', documentRoot);
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal('HTMLElement', ElementFixture);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', confirmMock);

  await import('../../../src/assets/js/account/settings/passkeys.js');

  async function dispatch(type: string, event: Partial<DomEventFixture> = {}) {
    for (const listener of documentListeners.get(type) ?? []) {
      await listener(event as unknown as Event);
    }
    await Promise.resolve();
  }

  return {
    elements,
    loading,
    empty,
    list,
    addButton,
    emptyAddButton,
    body,
    windowRoot,
    fetchMock,
    confirmMock,
    createdItems,
    createdModals,
    createdElements,
    dispatch,
  };
}

function response(body: unknown) {
  return { json: vi.fn().mockResolvedValue(body) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('account passkeys manager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports missing and malformed bootstrap state without requesting data', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const missing = await setup({ stateText: null });

    await missing.dispatch('DOMContentLoaded');

    expect(missing.fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[Passkeys] State element not found'
    );

    const malformed = await setup({ stateText: '{' });
    await malformed.dispatch('DOMContentLoaded');

    expect(malformed.fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[Passkeys] Failed to initialize:',
      expect.any(SyntaxError)
    );
  });

  it('reports asynchronous initialization failures from empty state', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const context = await setup({ stateText: '' });

    await context.dispatch('DOMContentLoaded');

    expect(context.fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[Passkeys] Failed to initialize:',
      expect.any(TypeError)
    );
  });

  it('loads an empty credential list with CSRF protection', async () => {
    const context = await setup();
    context.fetchMock.mockResolvedValue(response({ ok: true }));

    await context.dispatch('DOMContentLoaded');

    expect(context.fetchMock).toHaveBeenCalledWith(
      '/api/webauthn/credentials',
      {
        method: 'GET',
        headers: { 'X-CSRF-Token': 'csrf-token' },
        credentials: 'include',
      }
    );
    expect(context.loading.classList.add).toHaveBeenCalledWith('hidden');
    expect(context.empty.classList.remove).toHaveBeenCalledWith('hidden');
    expect(context.list.classList.add).toHaveBeenCalledWith('hidden');
  });

  it('renders template-backed single-device and synced credentials', async () => {
    const context = await setup({ itemFactory: () => itemFixture() });
    context.fetchMock.mockResolvedValue(
      response({
        ok: true,
        credentials: [
          credential(),
          credential({
            credential_id: 'credential-2',
            friendly_name: 'Phone passkey',
            device_type: 'multiDevice',
            last_used_at: '2026-08-02T12:00:00.000Z',
          }),
        ],
      })
    );

    await context.dispatch('DOMContentLoaded');

    expect(context.list.children).toHaveLength(2);
    expect(context.createdItems[0]?.item.dataset.credentialId).toBe(
      'credential-1'
    );
    expect(
      context.createdItems[0]?.item.queries.get('.passkey-name')?.textContent
    ).toBe('Laptop passkey');
    expect(
      context.createdItems[0]?.item.queries.get('.passkey-device')?.textContent
    ).toBe('Single device');
    expect(
      context.createdItems[0]?.item.queries.get('.passkey-last-used')
        ?.textContent
    ).toBe('Never used');
    expect(
      context.createdItems[1]?.item.queries.get('.passkey-device')?.textContent
    ).toBe('Synced');
    expect(
      context.createdItems[1]?.item.queries.get('.passkey-icon svg')?.innerHTML
    ).toContain('M3 15a4 4');
    expect(context.empty.classList.add).toHaveBeenCalledWith('hidden');
    expect(context.list.classList.remove).toHaveBeenCalledWith('hidden');
  });

  it('redirects from either add-passkey control', async () => {
    const context = await setup();
    context.fetchMock.mockResolvedValue(response({ ok: true }));
    await context.dispatch('DOMContentLoaded');

    await context.addButton.trigger('click');
    expect(context.windowRoot.location.href).toBe('/account/passkeys/register');

    context.windowRoot.location.href = 'https://rp.example/account/passkeys';
    await context.emptyAddButton.trigger('click');
    expect(context.windowRoot.location.href).toBe('/account/passkeys/register');
  });

  it('deletes credentials whose opaque IDs are unsafe in CSS selectors', async () => {
    const unsafeId = 'credential"]';
    const context = await setup({ itemFactory: () => itemFixture() });
    context.fetchMock
      .mockResolvedValueOnce(
        response({
          ok: true,
          credentials: [credential({ credential_id: unsafeId })],
        })
      )
      .mockResolvedValueOnce(response({ ok: true }));
    context.confirmMock.mockReturnValue(true);
    await context.dispatch('DOMContentLoaded');
    context.list.querySelector.mockImplementation(() => {
      throw new DOMException('Invalid selector', 'SyntaxError');
    });

    await context.createdItems[0]?.remove.trigger('click');

    expect(context.fetchMock).toHaveBeenLastCalledWith(
      '/api/webauthn/credentials/credential%22%5D',
      {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': 'csrf-token' },
        credentials: 'include',
      }
    );
    expect(context.createdItems[0]?.item.removed).toBe(true);
    expect(context.body.children.at(-1)?.innerHTML).toContain('Deleted');
    expect(context.body.children.at(-1)?.innerHTML).not.toContain(
      'Could not delete'
    );
  });

  it('renders an escaped fallback item when the template is unavailable', async () => {
    const fallbackItem = new ElementFixture();
    const rename = new ElementFixture();
    const remove = new ElementFixture();
    fallbackItem.queries.set('.passkey-rename-btn', rename);
    fallbackItem.queries.set('.passkey-delete-btn', remove);
    const context = await setup({
      createElementFactory: (_tag, index) =>
        index === 0 ? fallbackItem : new ElementFixture(),
    });
    context.fetchMock.mockResolvedValue(
      response({
        ok: true,
        credentials: [
          credential({
            friendly_name: '<img src=x onerror=alert(1)>',
            last_used_at: '2026-08-03T12:00:00.000Z',
          }),
        ],
      })
    );

    await context.dispatch('DOMContentLoaded');

    expect(fallbackItem.innerHTML).toContain(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
    expect(fallbackItem.innerHTML).not.toContain(
      '<div class="passkey-name text-sm font-medium text-foreground"><img'
    );
    expect(fallbackItem.innerHTML).toContain('Single device');
    expect(fallbackItem.innerHTML).toContain('Last used:');
    expect(rename.addEventListener).toHaveBeenCalledWith(
      'click',
      expect.any(Function)
    );
    expect(remove.addEventListener).toHaveBeenCalledWith(
      'click',
      expect.any(Function)
    );
    context.confirmMock.mockReturnValue(false);
    await rename.trigger('click');
    await remove.trigger('click');
    expect(context.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when the item template has no credential root', async () => {
    const fallbackItem = new ElementFixture();
    const context = await setup({
      itemFactory: () => {
        const created = itemFixture();
        created.fragment.queries.set('.passkey-item', null);
        return created;
      },
      createElementFactory: (_tag, index) =>
        index === 0 ? fallbackItem : new ElementFixture(),
    });
    context.fetchMock.mockResolvedValue(
      response({
        ok: true,
        credentials: [credential({ device_type: 'multiDevice' })],
      })
    );

    await context.dispatch('DOMContentLoaded');

    expect(fallbackItem.innerHTML).toContain('Synced');
    expect(fallbackItem.innerHTML).toContain('M3 15a4 4');
    expect(fallbackItem.innerHTML).toContain('Never used');
  });

  it('tolerates optional template fields and actions being absent', async () => {
    const context = await setup({
      itemFactory: () =>
        itemFixture({ includeFields: false, includeActions: false }),
    });
    context.fetchMock.mockResolvedValue(
      response({
        ok: true,
        credentials: [credential({ device_type: 'multiDevice' })],
      })
    );

    await expect(context.dispatch('DOMContentLoaded')).resolves.toBeUndefined();
    expect(context.list.children).toHaveLength(1);
  });

  it.each([
    [{ ok: false, error: 'denied' }, 'server rejection'],
    [{ ok: false }, 'default server rejection'],
  ] as const)('shows an escaped load error for %s', async (result, _label) => {
    vi.useFakeTimers();
    const context = await setup({
      stateText: JSON.stringify(
        state({
          config: { ...state().config, debug: true },
          translations: {
            ...translations,
            errorLoading: '<b>Could not load</b>',
          },
        })
      ),
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    context.fetchMock.mockResolvedValue(response(result));

    await context.dispatch('DOMContentLoaded');

    const toast = context.body.children.at(-1);
    expect(toast?.innerHTML).toContain('&lt;b&gt;Could not load&lt;/b&gt;');
    expect(toast?.className).toContain('border-red-500');
    expect(consoleLog).toHaveBeenCalledWith(
      '[Passkeys] Error loading credentials',
      expect.any(Error)
    );
    vi.advanceTimersByTime(3000);
    expect(toast?.removed).toBe(true);
  });

  it('handles a network load failure without optional page controls', async () => {
    const context = await setup({
      includeList: false,
      includeLoading: false,
      includeEmpty: false,
      includeButtons: false,
    });
    context.fetchMock.mockRejectedValue(new Error('offline'));

    await expect(context.dispatch('DOMContentLoaded')).resolves.toBeUndefined();
    expect(context.body.children.at(-1)?.innerHTML).toContain('Could not load');
  });

  it('handles a populated response when the optional list is absent', async () => {
    const context = await setup({ includeList: false });
    context.fetchMock.mockResolvedValue(
      response({ ok: true, credentials: [credential()] })
    );
    await expect(context.dispatch('DOMContentLoaded')).resolves.toBeUndefined();
    expect(context.fetchMock).toHaveBeenCalledOnce();
  });

  it('handles an empty response without optional loading, empty, or list elements', async () => {
    const context = await setup({
      includeEmpty: false,
      includeLoading: false,
      includeList: false,
    });
    context.fetchMock.mockResolvedValue(response({ ok: true }));
    await expect(context.dispatch('DOMContentLoaded')).resolves.toBeUndefined();
    expect(context.fetchMock).toHaveBeenCalledOnce();
  });

  it('renders a populated response when the optional empty state is absent', async () => {
    const context = await setup({ includeEmpty: false });
    context.fetchMock.mockResolvedValue(
      response({ ok: true, credentials: [credential()] })
    );
    await expect(context.dispatch('DOMContentLoaded')).resolves.toBeUndefined();
    expect(context.list.children).toHaveLength(1);
  });

  it('renders an empty response when the optional empty state is absent', async () => {
    const context = await setup({ includeEmpty: false });
    context.fetchMock.mockResolvedValue(response({ ok: true }));

    await expect(context.dispatch('DOMContentLoaded')).resolves.toBeUndefined();

    expect(context.list.classList.add).toHaveBeenCalledWith('hidden');
  });

  it('renames a credential and closes the modal', async () => {
    vi.useFakeTimers();
    const context = await setup({
      itemFactory: () => itemFixture(),
      modalFactory: () => modalFixture(),
    });
    context.fetchMock
      .mockResolvedValueOnce(
        response({ ok: true, credentials: [credential()] })
      )
      .mockResolvedValueOnce(response({ ok: true }));
    await context.dispatch('DOMContentLoaded');

    await context.createdItems[0]?.rename.trigger('click');
    const modal = context.createdModals[0];
    expect(modal?.input.value).toBe('Laptop passkey');
    vi.advanceTimersByTime(100);
    expect(modal?.input.focused).toBe(true);
    expect(modal?.input.selected).toBe(true);

    modal!.input.value = '   ';
    await modal?.confirmButton.trigger('click');
    expect(context.fetchMock).toHaveBeenCalledTimes(1);
    expect(modal?.wrapper.removed).toBe(false);

    modal!.input.value = 'Office key';
    await modal?.confirmButton.trigger('click');

    expect(context.fetchMock).toHaveBeenLastCalledWith(
      '/api/webauthn/credentials/credential-1',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        },
        credentials: 'include',
        body: JSON.stringify({ friendlyName: 'Office key' }),
      }
    );
    expect(
      context.createdItems[0]?.item.queries.get('.passkey-name')?.textContent
    ).toBe('Office key');
    expect(modal?.wrapper.removed).toBe(true);
    expect(context.body.children.at(-1)?.innerHTML).toContain('Renamed');
  });

  it('renames credentials whose opaque IDs are unsafe in CSS selectors', async () => {
    const unsafeId = 'credential"]';
    const context = await setup({
      itemFactory: () => itemFixture(),
      modalFactory: () => modalFixture(),
    });
    context.fetchMock
      .mockResolvedValueOnce(
        response({
          ok: true,
          credentials: [credential({ credential_id: unsafeId })],
        })
      )
      .mockResolvedValueOnce(response({ ok: true }));
    await context.dispatch('DOMContentLoaded');
    await context.createdItems[0]?.rename.trigger('click');
    context.createdModals[0]!.input.value = 'Safe name';
    context.list.querySelector.mockImplementation(() => {
      throw new DOMException('Invalid selector', 'SyntaxError');
    });

    await context.createdModals[0]?.confirmButton.trigger('click');

    expect(
      context.createdItems[0]?.item.queries.get('.passkey-name')?.textContent
    ).toBe('Safe name');
    expect(context.body.children.at(-1)?.innerHTML).toContain('Renamed');
  });

  it('closes rename modals through cancel, Escape, and the backdrop only', async () => {
    const context = await setup({
      itemFactory: () => itemFixture(),
      modalFactory: () => modalFixture(),
    });
    context.fetchMock.mockResolvedValue(
      response({ ok: true, credentials: [credential()] })
    );
    await context.dispatch('DOMContentLoaded');

    await context.createdItems[0]?.rename.trigger('click');
    await context.createdModals[0]?.cancelButton.trigger('click');
    expect(context.createdModals[0]?.wrapper.removed).toBe(true);

    await context.createdItems[0]?.rename.trigger('click');
    await context.dispatch('keydown', { key: 'Enter' });
    expect(context.createdModals[1]?.wrapper.removed).toBe(false);
    await context.dispatch('keydown', { key: 'Escape' });
    expect(context.createdModals[1]?.wrapper.removed).toBe(true);

    await context.createdItems[0]?.rename.trigger('click');
    await context.createdModals[2]?.wrapper.trigger('click', {
      target: context.createdModals[2]?.wrapper,
    });
    expect(context.createdModals[2]?.wrapper.removed).toBe(false);
    await context.createdModals[2]?.wrapper.trigger('click', {
      target: context.createdModals[2]?.overlay,
    });
    expect(context.createdModals[2]?.wrapper.removed).toBe(true);
  });

  it('does not open a rename modal when its template is absent or malformed', async () => {
    const withoutTemplate = await setup({ itemFactory: () => itemFixture() });
    withoutTemplate.fetchMock.mockResolvedValue(
      response({ ok: true, credentials: [credential()] })
    );
    await withoutTemplate.dispatch('DOMContentLoaded');
    await withoutTemplate.createdItems[0]?.rename.trigger('click');
    expect(withoutTemplate.body.children).toHaveLength(0);

    const malformed = await setup({
      itemFactory: () => itemFixture(),
      modalFactory: () => {
        const created = modalFixture();
        created.fragment.queries.set('[role="dialog"]', null);
        return created;
      },
    });
    malformed.fetchMock.mockResolvedValue(
      response({ ok: true, credentials: [credential()] })
    );
    await malformed.dispatch('DOMContentLoaded');
    await malformed.createdItems[0]?.rename.trigger('click');
    expect(malformed.body.children).toHaveLength(0);
  });

  it('opens a modal safely when optional rename controls are absent', async () => {
    vi.useFakeTimers();
    const context = await setup({
      itemFactory: () => itemFixture(),
      modalFactory: () => modalFixture({ includeControls: false }),
    });
    context.fetchMock.mockResolvedValue(
      response({ ok: true, credentials: [credential()] })
    );
    await context.dispatch('DOMContentLoaded');

    await context.createdItems[0]?.rename.trigger('click');
    vi.advanceTimersByTime(100);

    expect(
      context.body.children.includes(context.createdModals[0]!.wrapper)
    ).toBe(true);
  });

  it('ignores a stale confirm control after the modal has closed', async () => {
    const context = await setup({
      itemFactory: () => itemFixture(),
      modalFactory: () => modalFixture(),
    });
    context.fetchMock.mockResolvedValue(
      response({ ok: true, credentials: [credential()] })
    );
    await context.dispatch('DOMContentLoaded');
    await context.createdItems[0]?.rename.trigger('click');
    const modal = context.createdModals[0];
    await context.dispatch('keydown', { key: 'Escape' });

    await modal?.confirmButton.trigger('click');

    expect(context.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remains stable when Escape closes a pending rename modal', async () => {
    const pendingPatch = deferred<ReturnType<typeof response>>();
    const context = await setup({
      itemFactory: () => itemFixture(),
      modalFactory: () => modalFixture(),
    });
    context.fetchMock
      .mockResolvedValueOnce(
        response({ ok: true, credentials: [credential()] })
      )
      .mockReturnValueOnce(pendingPatch.promise);
    await context.dispatch('DOMContentLoaded');
    await context.createdItems[0]?.rename.trigger('click');
    const modal = context.createdModals[0]!;
    modal.input.value = 'Pending name';

    const confirmation = modal.confirmButton.trigger('click');
    await Promise.resolve();
    await context.dispatch('keydown', { key: 'Escape' });
    pendingPatch.resolve(response({ ok: true }));
    await confirmation;

    expect(modal.wrapper.removed).toBe(true);
    expect(context.body.children.at(-1)?.innerHTML).toContain('Renamed');
  });

  it('handles a credential deleted while its rename is pending', async () => {
    const pendingPatch = deferred<ReturnType<typeof response>>();
    const context = await setup({
      itemFactory: () => itemFixture(),
      modalFactory: () => modalFixture(),
    });
    context.fetchMock
      .mockResolvedValueOnce(
        response({ ok: true, credentials: [credential()] })
      )
      .mockReturnValueOnce(pendingPatch.promise)
      .mockResolvedValueOnce(response({ ok: true }));
    context.confirmMock.mockReturnValue(true);
    await context.dispatch('DOMContentLoaded');
    await context.createdItems[0]?.rename.trigger('click');
    context.createdModals[0]!.input.value = 'Late name';

    const rename = context.createdModals[0]!.confirmButton.trigger('click');
    await Promise.resolve();
    await context.createdItems[0]?.remove.trigger('click');
    pendingPatch.resolve(response({ ok: true }));
    await rename;

    expect(context.createdItems[0]?.item.removed).toBe(true);
    expect(context.body.children.at(-1)?.innerHTML).toContain('Renamed');
  });

  it.each([{ ok: false, error: 'denied' }, { ok: false }] as const)(
    'shows an error when rename persistence fails with %s',
    async renameResult => {
      const context = await setup({
        itemFactory: () => itemFixture(),
        modalFactory: () => modalFixture(),
      });
      context.fetchMock
        .mockResolvedValueOnce(
          response({ ok: true, credentials: [credential()] })
        )
        .mockResolvedValueOnce(response(renameResult));
      await context.dispatch('DOMContentLoaded');
      await context.createdItems[0]?.rename.trigger('click');
      context.createdModals[0]!.input.value = 'New name';

      await context.createdModals[0]?.confirmButton.trigger('click');

      expect(context.body.children.at(-1)?.innerHTML).toContain(
        'Could not rename'
      );
      expect(
        context.createdItems[0]?.item.queries.get('.passkey-name')?.textContent
      ).toBe('Laptop passkey');
    }
  );

  it('does not delete when confirmation is cancelled', async () => {
    const context = await setup({ itemFactory: () => itemFixture() });
    context.fetchMock.mockResolvedValue(
      response({ ok: true, credentials: [credential()] })
    );
    context.confirmMock.mockReturnValue(false);
    await context.dispatch('DOMContentLoaded');

    await context.createdItems[0]?.remove.trigger('click');

    expect(context.confirmMock).toHaveBeenCalledWith(
      'Delete this passkey?\n\n"Laptop passkey"'
    );
    expect(context.fetchMock).toHaveBeenCalledTimes(1);
    expect(context.createdItems[0]?.item.removed).toBe(false);
  });

  it('keeps the non-empty list visible after deleting one credential', async () => {
    const context = await setup({ itemFactory: () => itemFixture() });
    context.fetchMock
      .mockResolvedValueOnce(
        response({
          ok: true,
          credentials: [
            credential(),
            credential({ credential_id: 'credential-2' }),
          ],
        })
      )
      .mockResolvedValueOnce(response({ ok: true }));
    context.confirmMock.mockReturnValue(true);
    await context.dispatch('DOMContentLoaded');

    await context.createdItems[0]?.remove.trigger('click');

    expect(context.createdItems[0]?.item.removed).toBe(true);
    expect(context.empty.classList.remove).not.toHaveBeenCalled();
    expect(context.body.children.at(-1)?.innerHTML).toContain('Deleted');
  });

  it('keeps deletion successful when the rendered item was already detached', async () => {
    const context = await setup({ itemFactory: () => itemFixture() });
    context.fetchMock
      .mockResolvedValueOnce(
        response({ ok: true, credentials: [credential()] })
      )
      .mockResolvedValueOnce(response({ ok: true }));
    context.confirmMock.mockReturnValue(true);
    await context.dispatch('DOMContentLoaded');
    context.createdItems[0]?.item.remove();

    await context.createdItems[0]?.remove.trigger('click');

    expect(context.empty.classList.remove).toHaveBeenCalledWith('hidden');
    expect(context.body.children.at(-1)?.innerHTML).toContain('Deleted');
  });

  it.each([{ ok: false, error: 'denied' }, { ok: false }] as const)(
    'preserves a credential when deletion fails with %s',
    async deleteResult => {
      const context = await setup({ itemFactory: () => itemFixture() });
      context.fetchMock
        .mockResolvedValueOnce(
          response({ ok: true, credentials: [credential()] })
        )
        .mockResolvedValueOnce(response(deleteResult));
      context.confirmMock.mockReturnValue(true);
      await context.dispatch('DOMContentLoaded');

      await context.createdItems[0]?.remove.trigger('click');

      expect(context.createdItems[0]?.item.removed).toBe(false);
      expect(context.body.children.at(-1)?.innerHTML).toContain(
        'Could not delete'
      );
    }
  );
});
