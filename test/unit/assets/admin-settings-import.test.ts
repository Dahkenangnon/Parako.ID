import { afterEach, describe, expect, it, vi } from 'vitest';

interface DomEvent {
  target?: ElementFixture;
}

type DomListener = (event: DomEvent) => unknown;

class ClassListFixture {
  private readonly values = new Set<string>();

  public add(...names: string[]): void {
    names.forEach(name => this.values.add(name));
  }

  public remove(...names: string[]): void {
    names.forEach(name => this.values.delete(name));
  }

  public contains(name: string): boolean {
    return this.values.has(name);
  }
}

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public className = '';
  public readonly classList = new ClassListFixture();
  public disabled = false;
  public files: unknown[] = [];
  private html = '';
  public readonly listeners = new Map<string, DomListener[]>();
  public parentElement: ElementFixture | null = null;
  public readonly scrollIntoView = vi.fn();
  private text = '';
  public type = '';
  public value = '';
  public readonly focus = vi.fn();

  public constructor(
    private readonly queryHandler?: (selector: string) => ElementFixture | null
  ) {}

  public get innerHTML(): string {
    return this.html;
  }

  public set innerHTML(value: string) {
    this.html = value;
  }

  public get textContent(): string {
    return this.text;
  }

  public set textContent(value: string) {
    this.text = value;
    this.html = value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  public addEventListener(name: string, listener: DomListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public querySelector(selector: string): ElementFixture | null {
    return this.queryHandler?.(selector) ?? null;
  }

  public remove(): void {
    if (this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string, event: DomEvent = { target: this }): void {
    this.listeners.get(name)?.forEach(listener => listener.call(this, event));
  }
}

class FileReaderFixture {
  public static instances: FileReaderFixture[] = [];
  public onerror: (() => void) | null = null;
  public onload: ((event: { target?: { result?: unknown } }) => void) | null =
    null;
  public readonly readAsText = vi.fn();

  public constructor() {
    FileReaderFixture.instances.push(this);
  }

  public fail(): void {
    this.onerror?.();
  }

  public succeed(result: unknown): void {
    this.onload?.({ target: { result } });
  }

  public succeedWithoutTarget(): void {
    this.onload?.({});
  }
}

interface DomOptions {
  closeButton?: boolean;
  csrfToken?: string;
  lucide?: 'callable' | 'invalid' | 'missing';
}

function setupDom(options: DomOptions = {}) {
  let ready: (() => void) | undefined;
  const createdElements: ElementFixture[] = [];
  const elements = new Map<string, ElementFixture>();
  const closeButton = new ElementFixture();
  const queryHandler = (selector: string) =>
    options.closeButton && selector === '.close-notification'
      ? closeButton
      : null;
  const body = new ElementFixture(queryHandler);
  const createIcons = vi.fn();
  const browserWindow: Record<string, unknown> = {
    location: { href: 'https://admin.example.test/settings/import' },
  };
  if (options.lucide === 'callable') browserWindow.lucide = { createIcons };
  if (options.lucide === 'invalid') browserWindow.lucide = {};
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('FileReader', FileReaderFixture);
  const csrfMeta = new ElementFixture();
  if (options.csrfToken !== undefined)
    csrfMeta.setAttribute('content', options.csrfToken);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'DOMContentLoaded') ready = listener;
    }),
    body,
    createElement: vi.fn(() => {
      const element = new ElementFixture(queryHandler);
      createdElements.push(element);
      return element;
    }),
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    querySelector: vi.fn((selector: string) =>
      selector === 'meta[name="csrf-token"]' && options.csrfToken !== undefined
        ? csrfMeta
        : null
    ),
  });

  return {
    browserWindow,
    closeButton,
    createIcons,
    createdElements,
    elements,
    runReady: () => ready?.(),
  };
}

function addField(
  elements: Map<string, ElementFixture>,
  id: string,
  value = ''
): ElementFixture {
  const field = new ElementFixture();
  field.value = value;
  elements.set(id, field);
  return field;
}

function addImportFields(dom: ReturnType<typeof setupDom>, json = '{}') {
  const file = addField(dom.elements, 'configFile');
  const textarea = addField(dom.elements, 'configJson', json);
  const preview = addField(dom.elements, 'previewSection');
  preview.classList.add('hidden');
  const impact = addField(dom.elements, 'impactContent');
  const diff = addField(dom.elements, 'diffContent');
  const apply = addField(dom.elements, 'applyButton');
  apply.innerHTML = 'Apply';
  return { apply, diff, file, impact, preview, textarea };
}

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: vi
      .fn()
      .mockResolvedValue(
        typeof body === 'string' ? body : JSON.stringify(body)
      ),
  };
}

async function loadManager(dom: ReturnType<typeof setupDom>): Promise<void> {
  await import('../../../src/assets/js/admin/settings/import.js');
  dom.runReady();
}

function findCreated(
  dom: ReturnType<typeof setupDom>,
  text: string
): ElementFixture {
  const element = dom.createdElements.find(item => item.textContent === text);
  expect(element).toBeDefined();
  return element as ElementFixture;
}

async function confirmApply(
  dom: ReturnType<typeof setupDom>,
  action: 'confirm' | 'cancel' | 'backdrop' | 'backdrop-child' = 'confirm'
): Promise<void> {
  const applyPromise = (
    dom.browserWindow.applyConfigImport as () => Promise<void>
  )();
  if (action === 'backdrop' || action === 'backdrop-child') {
    const backdrop = dom.createdElements.find(item =>
      item.className.startsWith('fixed inset-0')
    );
    expect(backdrop).toBeDefined();
    backdrop?.trigger('click', {
      target: action === 'backdrop' ? backdrop : new ElementFixture(),
    });
    if (action === 'backdrop-child')
      findCreated(dom, 'Cancel').trigger('click');
  } else {
    findCreated(
      dom,
      action === 'confirm' ? 'Yes, Apply Changes' : 'Cancel'
    ).trigger('click');
  }
  await applyPromise;
}

describe('admin settings import manager', () => {
  afterEach(() => {
    FileReaderFixture.instances = [];
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('applies exactly the configuration that was successfully previewed', async () => {
    vi.useFakeTimers();
    const dom = setupDom();
    const textarea = addField(dom.elements, 'configJson', '{"safe":true}');
    addField(dom.elements, 'previewSection');
    addField(dom.elements, 'impactContent');
    addField(dom.elements, 'diffContent');
    addField(dom.elements, 'applyButton');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            success: true,
            diff: [],
            impact: { requiresRestart: false },
            changeCount: 0,
          })
        ),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
      });
    vi.stubGlobal('fetch', fetchMock);

    await import('../../../src/assets/js/admin/settings/import.js');
    dom.runReady();
    await (dom.browserWindow.previewImport as () => Promise<void>)();

    textarea.value = '{"safe":false}';
    const applyPromise = (
      dom.browserWindow.applyConfigImport as () => Promise<void>
    )();
    const confirmButton = await vi.waitFor(() => {
      const button = dom.createdElements.find(
        element => element.textContent === 'Yes, Apply Changes'
      );
      expect(button).toBeDefined();
      return button as ElementFixture;
    });
    confirmButton.trigger('click');
    await applyPromise;

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/admin/settings/import/apply',
      expect.objectContaining({
        body: JSON.stringify({ config: { safe: true } }),
      })
    );
  });

  it('loads valid files and contains invalid or unreadable files', async () => {
    const dom = setupDom({ lucide: 'callable' });
    const fields = addImportFields(dom);
    await loadManager(dom);

    (dom.browserWindow.loadFromFile as () => void)();
    expect(FileReaderFixture.instances).toHaveLength(0);

    fields.file.files = [{}];
    (dom.browserWindow.loadFromFile as () => void)();
    FileReaderFixture.instances
      .at(-1)
      ?.succeed('{"issuer":"https://idp.example.test"}');
    expect(fields.textarea.value).toContain('issuer');

    (dom.browserWindow.loadFromFile as () => void)();
    FileReaderFixture.instances.at(-1)?.succeed('{invalid');
    (dom.browserWindow.loadFromFile as () => void)();
    const parse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'invalid';
    });
    FileReaderFixture.instances.at(-1)?.succeed('{}');
    parse.mockRestore();
    (dom.browserWindow.loadFromFile as () => void)();
    FileReaderFixture.instances.at(-1)?.succeedWithoutTarget();
    (dom.browserWindow.loadFromFile as () => void)();
    FileReaderFixture.instances.at(-1)?.fail();

    expect(dom.createIcons).toHaveBeenCalled();
    expect(
      dom.createdElements.some(element =>
        element.innerHTML.includes('Failed to read file')
      )
    ).toBe(true);
  });

  it('clears available fields and invalidates the current preview', async () => {
    const dom = setupDom();
    const fields = addImportFields(dom, '{"value":1}');
    fields.file.value = 'config.json';
    await loadManager(dom);

    (dom.browserWindow.clearForm as () => void)();

    expect(fields.file.value).toBe('');
    expect(fields.textarea.value).toBe('');
    expect(fields.preview.classList.contains('hidden')).toBe(true);
    await (dom.browserWindow.applyConfigImport as () => Promise<void>)();
    expect(
      dom.createdElements.some(element =>
        element.innerHTML.includes('No preview data available')
      )
    ).toBe(true);
  });

  it('clears safely when optional form elements are absent', async () => {
    const dom = setupDom();
    await loadManager(dom);

    expect(() => (dom.browserWindow.clearForm as () => void)()).not.toThrow();
  });

  it('rejects empty and malformed configuration before previewing', async () => {
    const dom = setupDom();
    const fields = addImportFields(dom, '   ');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await loadManager(dom);

    await (dom.browserWindow.previewImport as () => Promise<void>)();
    fields.textarea.value = '{invalid';
    await (dom.browserWindow.previewImport as () => Promise<void>)();
    fields.textarea.value = '{}';
    const parse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'invalid';
    });
    await (dom.browserWindow.previewImport as () => Promise<void>)();
    parse.mockRestore();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      dom.createdElements.some(element =>
        element.innerHTML.includes('Invalid JSON format')
      )
    ).toBe(true);
  });

  it('renders restart impact, escaped services, warnings, and every diff type', async () => {
    const dom = setupDom({ csrfToken: 'csrf-token', lucide: 'callable' });
    const fields = addImportFields(dom, '{"setting":true}');
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        success: true,
        diff: [
          { field: '<added>', changeType: 'added', newValue: '<new>' },
          {
            field: 'modified',
            changeType: 'modified',
            oldValue: false,
            newValue: true,
          },
          { field: 'removed', changeType: 'removed', oldValue: 'old' },
        ],
        impact: {
          requiresRestart: true,
          affectedServices: ['<worker>'],
          warnings: ['<warning>'],
        },
        changeCount: 3,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await loadManager(dom);

    await (dom.browserWindow.previewImport as () => Promise<void>)();

    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/settings/import/preview',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-token' }),
      })
    );
    expect(fields.preview.classList.contains('hidden')).toBe(false);
    expect(fields.preview.scrollIntoView).toHaveBeenCalled();
    expect(fields.impact.innerHTML).toContain('Server Restart Required');
    expect(fields.impact.innerHTML).toContain('&lt;worker&gt;');
    expect(fields.impact.innerHTML).toContain('&lt;warning&gt;');
    expect(fields.diff.innerHTML).toContain('&lt;added&gt;');
    expect(fields.diff.innerHTML).toContain('bg-green-50');
    expect(fields.diff.innerHTML).toContain('bg-blue-50');
    expect(fields.diff.innerHTML).toContain('bg-red-50');
    expect(dom.createIcons).toHaveBeenCalled();
  });

  it('renders empty results without optional preview targets', async () => {
    const dom = setupDom({ lucide: 'invalid' });
    addField(dom.elements, 'configJson', '{}');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          success: true,
          diff: [],
          impact: {
            requiresRestart: false,
            affectedServices: [],
            warnings: [],
          },
          changeCount: 0,
        })
      )
    );
    await loadManager(dom);

    await expect(
      (dom.browserWindow.previewImport as () => Promise<void>)()
    ).resolves.toBeUndefined();
  });

  it.each([
    ['server rejection', response('denied', false, 403), 'Server returned 403'],
    ['invalid response JSON', response('{invalid'), 'invalid JSON'],
    [
      'unsuccessful message',
      response({ success: false, message: 'not allowed' }),
      'not allowed',
    ],
    [
      'unsuccessful error',
      response({ success: false, error: 'invalid config' }),
      'invalid config',
    ],
    ['unsuccessful fallback', response({ success: false }), 'Preview failed'],
  ])('contains preview %s', async (_name, fetchResponse, expected) => {
    const dom = setupDom();
    const fields = addImportFields(dom, '{}');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse));
    await loadManager(dom);

    await (dom.browserWindow.previewImport as () => Promise<void>)();

    expect(fields.preview.classList.contains('hidden')).toBe(true);
    expect(
      dom.createdElements.some(element => element.innerHTML.includes(expected))
    ).toBe(true);
  });

  it.each([[new Error('offline')], ['offline']])(
    'contains a thrown preview failure %#',
    async failure => {
      const dom = setupDom();
      addImportFields(dom, '{}');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
      await loadManager(dom);

      await expect(
        (dom.browserWindow.previewImport as () => Promise<void>)()
      ).resolves.toBeUndefined();
    }
  );

  it.each(['cancel', 'backdrop', 'backdrop-child'] as const)(
    'does not apply when confirmation closes through %s',
    async action => {
      const dom = setupDom();
      addImportFields(dom, '{}');
      const fetchMock = vi.fn().mockResolvedValue(
        response({
          success: true,
          diff: [],
          impact: { requiresRestart: false },
          changeCount: 0,
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      await loadManager(dom);
      await (dom.browserWindow.previewImport as () => Promise<void>)();

      await confirmApply(dom, action);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('returns safely when the apply button is absent after confirmation', async () => {
    const dom = setupDom();
    addField(dom.elements, 'configJson', '{}');
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        success: true,
        diff: [],
        impact: { requiresRestart: false },
        changeCount: 0,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await loadManager(dom);
    await (dom.browserWindow.previewImport as () => Promise<void>)();

    await confirmApply(dom);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies a restart-requiring preview and redirects after success', async () => {
    vi.useFakeTimers();
    const dom = setupDom({ csrfToken: 'csrf-token', lucide: 'callable' });
    const fields = addImportFields(dom, '{"setting":true}');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          success: true,
          diff: [{ field: 'setting', changeType: 'added', newValue: true }],
          impact: { requiresRestart: true },
          changeCount: 1,
        })
      )
      .mockResolvedValueOnce(response({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    await loadManager(dom);
    await (dom.browserWindow.previewImport as () => Promise<void>)();

    await confirmApply(dom);

    expect(fields.apply.disabled).toBe(true);
    expect(fields.apply.innerHTML).toContain('Applying');
    expect(
      dom.createdElements.some(element =>
        element.textContent.includes('WARNING')
      )
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect((dom.browserWindow.location as { href: string }).href).toBe(
      '/admin/settings'
    );
  });

  it.each([
    ['server rejection', response('denied', false, 500), 'Server returned 500'],
    ['invalid response JSON', response('{invalid'), 'invalid JSON'],
    [
      'unsuccessful message',
      response({ success: false, message: 'apply denied' }),
      'apply denied',
    ],
    [
      'unsuccessful fallback',
      response({ success: false }),
      'Failed to apply configuration',
    ],
  ])(
    'restores the apply button after %s',
    async (_name, applyResponse, expected) => {
      const dom = setupDom();
      const fields = addImportFields(dom, '{}');
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response({
            success: true,
            diff: [],
            impact: { requiresRestart: false },
            changeCount: 0,
          })
        )
        .mockResolvedValueOnce(applyResponse);
      vi.stubGlobal('fetch', fetchMock);
      await loadManager(dom);
      await (dom.browserWindow.previewImport as () => Promise<void>)();

      await confirmApply(dom);

      expect(fields.apply.disabled).toBe(false);
      expect(fields.apply.innerHTML).toBe('Apply');
      expect(
        dom.createdElements.some(element =>
          element.innerHTML.includes(expected)
        )
      ).toBe(true);
    }
  );

  it.each([[new Error('offline')], ['offline']])(
    'contains a thrown apply failure %#',
    async failure => {
      const dom = setupDom();
      const fields = addImportFields(dom, '{}');
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response({
            success: true,
            diff: [],
            impact: { requiresRestart: false },
            changeCount: 0,
          })
        )
        .mockRejectedValueOnce(failure);
      vi.stubGlobal('fetch', fetchMock);
      await loadManager(dom);
      await (dom.browserWindow.previewImport as () => Promise<void>)();

      await confirmApply(dom);
      expect(fields.apply.disabled).toBe(false);
    }
  );

  it('supports notification close and auto-removal without duplicate cleanup', async () => {
    vi.useFakeTimers();
    const dom = setupDom({ closeButton: true });
    addImportFields(dom);
    await loadManager(dom);

    await (dom.browserWindow.applyConfigImport as () => Promise<void>)();
    const firstNotification = dom.createdElements.find(element =>
      element.className.startsWith('fixed top-4')
    );
    expect(firstNotification?.parentElement).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(firstNotification?.parentElement).toBeNull();

    await (dom.browserWindow.applyConfigImport as () => Promise<void>)();
    const notification = dom.createdElements
      .filter(element => element.className.startsWith('fixed top-4'))
      .at(-1);
    dom.closeButton.trigger('click');
    expect(notification?.parentElement).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
  });
});
