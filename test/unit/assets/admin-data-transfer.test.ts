import { afterEach, describe, expect, it, vi } from 'vitest';
import { initAdminDataTransfer } from '../../../src/assets/js/admin/data-transfer/data-transfer.js';

const { parseCsv } = vi.hoisted(() => ({ parseCsv: vi.fn() }));

vi.mock('papaparse', () => ({
  default: { parse: parseCsv },
}));

class ClassListFixture {
  private readonly values = new Set<string>();

  public readonly add = vi.fn((...tokens: string[]) => {
    tokens.forEach(token => this.values.add(token));
  });
  public readonly remove = vi.fn((...tokens: string[]) => {
    tokens.forEach(token => this.values.delete(token));
  });
  public readonly toggle = vi.fn((token: string, force?: boolean) => {
    const enabled = force ?? !this.values.has(token);
    if (enabled) this.values.add(token);
    else this.values.delete(token);
    return enabled;
  });

  public contains(token: string): boolean {
    return this.values.has(token);
  }
}

class ElementFixture {
  public readonly children: ElementFixture[] = [];
  public readonly classList = new ClassListFixture();
  public readonly dataset: Record<string, string> = {};
  public readonly listeners = new Map<
    string,
    Array<(event: EventFixture) => unknown>
  >();
  public readonly style: Record<string, string> = {};
  public checked = false;
  public className = '';
  public disabled = false;
  public files: Array<{
    name: string;
    size: number;
    text: () => Promise<string>;
  }> = [];
  public textContent = '';
  public tabIndex = 0;
  public value = '';
  public readonly submit = vi.fn();
  public readonly focus = vi.fn();
  public closestResult: ElementFixture | null = null;
  private readonly attributes = new Map<string, string>();

  public get firstChild(): ElementFixture | null {
    return this.children[0] ?? null;
  }

  public addEventListener(
    type: string,
    listener: (event: EventFixture) => unknown
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    this.children.push(child);
    return child;
  }

  public closest(): ElementFixture | null {
    return this.closestResult;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeChild(child: ElementFixture): ElementFixture {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public async trigger(type: string, key = ''): Promise<EventFixture> {
    const event = new EventFixture(key);
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
    return event;
  }
}

class EventFixture {
  constructor(public readonly key = '') {}

  public readonly preventDefault = vi.fn();
}

class EventSourceFixture {
  public static instances: EventSourceFixture[] = [];
  public readonly close = vi.fn();
  public readonly listeners = new Map<
    string,
    Array<(event: { data: string }) => unknown>
  >();
  public onerror: (() => unknown) | null = null;

  constructor(public readonly url: string) {
    EventSourceFixture.instances.push(this);
  }

  public addEventListener(
    type: string,
    listener: (event: { data: string }) => unknown
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  public async emit(type: string, data = ''): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({ data });
    }
  }
}

const elementIds = [
  'import-file-input',
  'preview-area',
  'preview-total',
  'preview-valid',
  'preview-errors',
  'column-match-area',
  'column-match-body',
  'sample-header',
  'sample-body',
  'validation-errors',
  'error-list',
  'confirm-import-btn',
  'cancel-preview-btn',
  'progress-area',
  'progress-bar',
  'progress-percent',
  'progress-status',
  'result-area',
  'result-summary',
  'result-errors',
  'result-error-body',
  'new-import-btn',
  'include-secrets-checkbox',
  'export-btn',
  'import-panel',
  'export-panel',
];

interface SetupOptions {
  configText?: string | null;
  csrfToken?: string | null;
  format?: 'csv' | 'json';
  importColumns?: Array<Record<string, unknown>>;
  omitElements?: string[];
}

async function setup(options: SetupOptions = {}) {
  parseCsv.mockReset();
  EventSourceFixture.instances = [];

  const elements = new Map<string, ElementFixture>();
  for (const id of elementIds) {
    if (!options.omitElements?.includes(id)) {
      elements.set(id, new ElementFixture());
    }
  }

  const configNode = new ElementFixture();
  configNode.textContent =
    options.configText === undefined
      ? JSON.stringify({
          entityId: 'users',
          format: options.format ?? 'json',
          hasExport: true,
          hasImport: true,
          importColumns: options.importColumns ?? [
            {
              aliases: ['email_address'],
              field: 'email',
              header: 'Email',
              required: true,
            },
            { field: 'name', header: 'Name' },
          ],
        })
      : (options.configText ?? '');
  if (options.configText !== null) {
    elements.set('__ENTITY_CONFIG__', configNode);
  }

  const importTab = new ElementFixture();
  importTab.dataset.tab = 'import';
  importTab.setAttribute('aria-selected', 'true');
  const exportTab = new ElementFixture();
  exportTab.dataset.tab = 'export';
  exportTab.setAttribute('aria-selected', 'false');
  const tabs = [importTab, exportTab];

  const csrfMeta = new ElementFixture();
  csrfMeta.setAttribute('content', options.csrfToken ?? 'csrf-token');
  const documentFixture = {
    createElement: vi.fn(() => new ElementFixture()),
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    querySelector: vi.fn((selector: string) =>
      selector === 'meta[name="csrf-token"]' && options.csrfToken !== null
        ? csrfMeta
        : null
    ),
    querySelectorAll: vi.fn((selector: string) =>
      selector === '.tab-btn' ? tabs : []
    ),
  };

  const showAlert = vi.fn().mockResolvedValue(undefined);
  const showConfirm = vi.fn().mockResolvedValue(false);
  const fetchMock = vi.fn();
  const exportForm = new ElementFixture();
  const exportButton = elements.get('export-btn');
  if (exportButton) exportButton.closestResult = exportForm;
  vi.stubGlobal('document', documentFixture);
  vi.stubGlobal('window', { dialog: { showAlert, showConfirm } });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', EventSourceFixture);

  initAdminDataTransfer();

  return {
    elements,
    exportForm,
    fetchMock,
    showAlert,
    showConfirm,
    tabs,
  };
}

function upload(
  context: Awaited<ReturnType<typeof setup>>,
  name: string,
  text: string,
  size = text.length
): Promise<EventFixture> {
  const input = context.elements.get('import-file-input')!;
  input.files = [{ name, size, text: vi.fn().mockResolvedValue(text) }];
  return input.trigger('change');
}

function renderedText(element: ElementFixture | undefined): string[] {
  if (!element) return [];
  return [
    ...(element.textContent ? [element.textContent] : []),
    ...element.children.flatMap(child => renderedText(child)),
  ];
}

async function startEnqueuedImport(
  context: Awaited<ReturnType<typeof setup>>,
  jobId = 'job-1'
): Promise<EventSourceFixture> {
  context.fetchMock.mockResolvedValueOnce({
    json: vi.fn().mockResolvedValue({ jobId, phase: 'enqueued' }),
    ok: true,
    status: 202,
  });
  await upload(
    context,
    'users.json',
    JSON.stringify([{ email: 'user@example.test' }])
  );
  await context.elements.get('confirm-import-btn')!.trigger('click');
  return EventSourceFixture.instances.at(-1)!;
}

describe('admin data transfer browser controller', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([null, '', '{malformed'])(
    'stops safely for config %j',
    async configText => {
      const context = await setup({ configText });
      expect(
        context.elements.get('import-file-input')?.listeners.get('change')
      ).toBeUndefined();
    }
  );

  it('switches between import and export tabs accessibly', async () => {
    const context = await setup();

    await context.tabs[1].trigger('click');

    expect(context.tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(context.tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(
      context.elements.get('import-panel')?.classList.contains('hidden')
    ).toBe(true);
    expect(
      context.elements.get('export-panel')?.classList.contains('hidden')
    ).toBe(false);
  });

  it('supports arrow, Home, and End keyboard navigation between tabs', async () => {
    const context = await setup();

    expect(context.tabs.map(tab => tab.tabIndex)).toEqual([0, -1]);

    const arrowEvent = await context.tabs[0].trigger('keydown', 'ArrowRight');
    expect(arrowEvent.preventDefault).toHaveBeenCalledOnce();
    expect(context.tabs[1].focus).toHaveBeenCalledOnce();
    expect(context.tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
    expect(context.tabs.map(tab => tab.tabIndex)).toEqual([-1, 0]);

    await context.tabs[1].trigger('keydown', 'Home');
    expect(context.tabs[0].focus).toHaveBeenCalledOnce();

    await context.tabs[0].trigger('keydown', 'End');
    expect(context.tabs[1].focus).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized and incorrectly typed files', async () => {
    const context = await setup();
    const input = context.elements.get('import-file-input')!;

    await upload(context, 'users.json', '[]', 10 * 1024 * 1024 + 1);
    expect(context.showAlert).toHaveBeenLastCalledWith(
      'File Too Large',
      expect.stringContaining('Maximum file size is 10MB'),
      { variant: 'error' }
    );
    expect(input.value).toBe('');

    await upload(context, 'users.csv', 'email\na@example.test');
    expect(context.showAlert).toHaveBeenLastCalledWith(
      'Invalid File Type',
      'Expected .json file.',
      { variant: 'error' }
    );
  });

  it('ignores a file change when no file is selected', async () => {
    const context = await setup();
    await context.elements.get('import-file-input')!.trigger('change');
    expect(context.showAlert).not.toHaveBeenCalled();
  });

  it.each([
    ['{broken', 'Invalid JSON file. Please check the file format.'],
    ['{}', 'JSON file must contain an array of objects.'],
    ['[]', 'JSON file is empty.'],
  ])('reports invalid JSON input %#', async (contents, expected) => {
    const context = await setup();

    await upload(context, 'users.json', contents);

    expect(context.showAlert).toHaveBeenCalledWith('Parse Error', expected, {
      variant: 'error',
    });
    expect(
      context.elements.get('preview-area')?.classList.contains('hidden')
    ).toBe(true);
  });

  it('rejects JSON arrays containing non-object rows', async () => {
    const context = await setup();

    await expect(
      upload(context, 'users.json', '[null, 42]')
    ).resolves.toBeDefined();

    expect(context.showAlert).toHaveBeenCalledWith(
      'Parse Error',
      'JSON file must contain only objects.',
      { variant: 'error' }
    );
  });

  it('previews valid and invalid JSON rows without rendering null values', async () => {
    const context = await setup();

    await upload(
      context,
      'users.json',
      JSON.stringify([
        { email: 'valid@example.test', name: null },
        { email: '   ', name: 'Missing email' },
      ])
    );

    expect(context.elements.get('preview-total')?.textContent).toBe(
      '2 total rows'
    );
    expect(context.elements.get('preview-valid')?.textContent).toBe('1 valid');
    expect(context.elements.get('preview-errors')?.textContent).toBe(
      '1 errors'
    );
    expect(context.elements.get('confirm-import-btn')?.disabled).toBe(false);
    expect(
      context.elements.get('preview-area')?.classList.contains('hidden')
    ).toBe(false);
    expect(renderedText(context.elements.get('sample-body'))).toEqual(
      expect.arrayContaining(['valid@example.test', 'Missing email'])
    );
  });

  it('replaces stale sample markup when previewing a new file', async () => {
    const context = await setup();
    const staleHeader = new ElementFixture();
    const staleRow = new ElementFixture();
    context.elements.get('sample-header')!.appendChild(staleHeader);
    context.elements.get('sample-body')!.appendChild(staleRow);

    await upload(
      context,
      'users.json',
      JSON.stringify([{ email: 'fresh@example.test' }])
    );

    expect(context.elements.get('sample-header')?.children).not.toContain(
      staleHeader
    );
    expect(context.elements.get('sample-body')?.children).not.toContain(
      staleRow
    );
    expect(renderedText(context.elements.get('sample-body'))).toContain(
      'fresh@example.test'
    );
  });

  it('accepts a valid file when the optional preview container is absent', async () => {
    const context = await setup({ omitElements: ['preview-area'] });

    await expect(
      upload(
        context,
        'users.json',
        JSON.stringify([{ email: 'user@example.test' }])
      )
    ).resolves.toBeInstanceOf(EventFixture);

    expect(context.showAlert).not.toHaveBeenCalled();
  });

  it('keeps previewing when optional display elements are absent', async () => {
    const context = await setup({
      omitElements: [
        'import-panel',
        'export-panel',
        'preview-total',
        'preview-valid',
        'preview-errors',
        'sample-header',
        'sample-body',
        'confirm-import-btn',
      ],
    });

    await expect(context.tabs[1].trigger('click')).resolves.toBeInstanceOf(
      EventFixture
    );
    await expect(
      upload(
        context,
        'users.json',
        JSON.stringify([{ email: 'user@example.test' }])
      )
    ).resolves.toBeInstanceOf(EventFixture);

    expect(
      context.elements.get('preview-area')?.classList.contains('hidden')
    ).toBe(false);
  });

  it('posts JSON rows with CSRF protection and renders validation errors', async () => {
    const context = await setup();
    context.fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({
        errors: [
          {
            error: 'Email already exists',
            fields: { email: 'duplicate@example.test' },
            rowNumber: 1,
          },
          {
            error: 'Unmapped failure',
            rowNumber: 2,
          },
        ],
        phase: 'validation',
        totalRows: 2,
        valid: false,
      }),
      ok: true,
      status: 200,
    });
    await upload(
      context,
      'users.json',
      JSON.stringify([{ email: 'duplicate@example.test', name: 'Duplicate' }])
    );

    await context.elements.get('confirm-import-btn')!.trigger('click');

    expect(context.fetchMock).toHaveBeenCalledWith(
      '/admin/data-transfer/users/import',
      expect.objectContaining({
        body: JSON.stringify({
          rows: [{ email: 'duplicate@example.test', name: 'Duplicate' }],
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        },
        method: 'POST',
      })
    );
    expect(context.elements.get('confirm-import-btn')?.disabled).toBe(false);
    expect(
      context.elements.get('preview-area')?.classList.contains('hidden')
    ).toBe(true);
    expect(renderedText(context.elements.get('result-summary'))).toEqual(
      expect.arrayContaining([
        'Import Completed with Errors',
        'Total Rows: ',
        '2',
        'Errors: ',
      ])
    );
    expect(renderedText(context.elements.get('result-error-body'))).toEqual(
      expect.arrayContaining([
        '1',
        'Email already exists',
        'email: duplicate@example.test',
        '—',
      ])
    );
  });

  it('reports fatal CSV parser errors', async () => {
    const context = await setup({ format: 'csv' });
    parseCsv.mockReturnValueOnce({
      data: [],
      errors: [{ message: 'Unclosed quote' }],
      meta: { fields: [] },
    });

    await upload(context, 'users.csv', '"unterminated');

    expect(context.showAlert).toHaveBeenCalledWith(
      'Parse Error',
      'CSV parsing failed: Unclosed quote',
      { variant: 'error' }
    );
  });

  it('matches CSV fields by aliases and headers before previewing rows', async () => {
    const context = await setup({ format: 'csv' });
    parseCsv.mockReturnValueOnce({
      data: [{ email_address: 'user@example.test', Name: 'User' }],
      errors: [{ message: 'Recoverable warning' }],
      meta: { fields: ['email_address', 'Name'] },
    });

    await upload(context, 'users.csv', 'email_address,Name');

    expect(parseCsv).toHaveBeenCalledWith(
      'email_address,Name',
      expect.objectContaining({ header: true, skipEmptyLines: true })
    );
    const parserOptions = parseCsv.mock.calls[0]![1];
    expect(parserOptions.transformHeader(' Email ')).toBe('Email');
    expect(context.elements.get('preview-valid')?.textContent).toBe('1 valid');
    expect(context.elements.get('confirm-import-btn')?.disabled).toBe(false);
    expect(renderedText(context.elements.get('column-match-body'))).toEqual(
      expect.arrayContaining(['Email', '*', 'email_address', 'Matched', 'Name'])
    );
    expect(renderedText(context.elements.get('sample-body'))).toEqual(
      expect.arrayContaining(['user@example.test', 'User'])
    );
  });

  it('disables CSV import when a required column is missing', async () => {
    const context = await setup({ format: 'csv' });
    parseCsv.mockReturnValueOnce({
      data: [{}],
      errors: [],
      meta: {},
    });

    await upload(context, 'users.csv', 'Unknown\nUser');

    expect(context.elements.get('confirm-import-btn')?.disabled).toBe(true);
    expect(renderedText(context.elements.get('error-list'))).toEqual([
      'Required column "Email" not found in file.',
    ]);
    expect(renderedText(context.elements.get('column-match-body'))).toEqual(
      expect.arrayContaining(['—', 'Missing', 'Optional'])
    );
  });

  it('maps CSV rows for submission and uses an empty CSRF token when absent', async () => {
    const context = await setup({
      csrfToken: null,
      format: 'csv',
      importColumns: [{ field: 'email', header: 'Email', required: true }],
    });
    parseCsv.mockReturnValueOnce({
      data: [{ Email: 'user@example.test' }],
      errors: [],
      meta: { fields: ['Email'] },
    });
    context.fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({
        errors: [],
        phase: 'validation',
        totalRows: 1,
        valid: false,
      }),
      ok: true,
    });
    await upload(context, 'users.csv', 'Email\nuser@example.test');

    await context.elements.get('confirm-import-btn')!.trigger('click');

    const request = context.fetchMock.mock.calls[0]![1];
    expect(request.headers['X-CSRF-Token']).toBe('');
    expect(JSON.parse(request.body)).toEqual({
      rows: [{ email: 'user@example.test' }],
    });
  });

  it.each(['cancel-preview-btn', 'new-import-btn'])(
    'resets a prepared preview from %s',
    async buttonId => {
      const context = await setup();
      await upload(
        context,
        'users.json',
        JSON.stringify([{ email: 'user@example.test' }])
      );
      context.elements.get('import-file-input')!.value = 'selected';

      await context.elements.get(buttonId)!.trigger('click');

      expect(
        context.elements.get('preview-area')?.classList.contains('hidden')
      ).toBe(true);
      expect(context.elements.get('confirm-import-btn')?.disabled).toBe(true);
      expect(context.elements.get('import-file-input')?.value).toBe('');
    }
  );

  it('resets safely when optional import controls are absent', async () => {
    const context = await setup({
      omitElements: [
        'import-file-input',
        'preview-area',
        'progress-area',
        'result-area',
        'confirm-import-btn',
      ],
    });

    await expect(
      context.elements.get('cancel-preview-btn')!.trigger('click')
    ).resolves.toBeInstanceOf(EventFixture);
  });

  it('ignores import confirmation until rows have been parsed', async () => {
    const context = await setup();
    await context.elements.get('confirm-import-btn')!.trigger('click');
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      {
        json: vi
          .fn()
          .mockResolvedValue({ error: 'Import endpoint rejected rows' }),
        ok: false,
        status: 422,
      },
      'Import endpoint rejected rows',
    ],
    [
      {
        json: vi.fn().mockRejectedValue(new Error('bad JSON')),
        ok: false,
        status: 502,
      },
      'Import failed',
    ],
    [
      {
        json: vi.fn().mockResolvedValue({}),
        ok: false,
        status: 500,
      },
      'Server error: 500',
    ],
    [
      {
        json: vi.fn().mockResolvedValue({ phase: 'unknown' }),
        ok: true,
        status: 200,
      },
      'Unexpected server response',
    ],
  ])('reports import startup failure %#', async (response, expected) => {
    const context = await setup();
    context.fetchMock.mockResolvedValueOnce(response);
    await upload(
      context,
      'users.json',
      JSON.stringify([{ email: 'user@example.test' }])
    );

    await context.elements.get('confirm-import-btn')!.trigger('click');

    expect(context.showAlert).toHaveBeenCalledWith('Import Error', expected, {
      variant: 'error',
    });
    expect(context.elements.get('confirm-import-btn')?.disabled).toBe(false);
  });

  it('uses a generic import error for a non-Error rejection', async () => {
    const context = await setup();
    context.fetchMock.mockRejectedValueOnce({ reason: 'offline' });
    await upload(
      context,
      'users.json',
      JSON.stringify([{ email: 'user@example.test' }])
    );

    await context.elements.get('confirm-import-btn')!.trigger('click');

    expect(context.showAlert).toHaveBeenCalledWith(
      'Import Error',
      'Failed to start import',
      { variant: 'error' }
    );
  });

  it('tracks an enqueued import through SSE progress and completion', async () => {
    const context = await setup();
    const source = await startEnqueuedImport(context);
    expect(source.url).toBe('/admin/data-transfer/users/import/job-1/progress');
    expect(context.elements.get('progress-percent')?.textContent).toBe('0%');
    await source.emit('progress', JSON.stringify({}));
    await source.emit('progress', '{malformed');
    expect(context.elements.get('progress-percent')?.textContent).toBe('0%');
    await source.emit('progress', JSON.stringify({ progress: 150 }));
    expect(context.elements.get('progress-percent')?.textContent).toBe('100%');
    expect(
      context.elements.get('progress-bar')?.getAttribute('aria-valuenow')
    ).toBe('100');
    expect(context.elements.get('progress-status')?.textContent).toBe(
      'Finalizing...'
    );

    await source.emit(
      'completed',
      JSON.stringify({
        durationMs: 1250,
        errorCount: 0,
        errors: [],
        skippedCount: 2,
        successCount: 1,
        totalRows: 1,
      })
    );

    expect(source.close).toHaveBeenCalledOnce();
    expect(
      context.elements.get('progress-area')?.classList.contains('hidden')
    ).toBe(true);
    expect(renderedText(context.elements.get('result-summary'))).toEqual(
      expect.arrayContaining(['Import Completed Successfully', '2', '1.3s'])
    );
    expect(
      context.elements.get('result-errors')?.classList.contains('hidden')
    ).toBe(true);
  });

  it('completes an import when optional progress and result displays are absent', async () => {
    const context = await setup({
      omitElements: [
        'progress-bar',
        'progress-percent',
        'progress-status',
        'result-area',
      ],
    });
    const source = await startEnqueuedImport(context);

    await expect(
      source.emit(
        'completed',
        JSON.stringify({
          durationMs: 10,
          errorCount: 0,
          errors: [],
          skippedCount: 0,
          successCount: 1,
          totalRows: 1,
        })
      )
    ).resolves.toBeUndefined();

    expect(source.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['failed', JSON.stringify({}), 'Import failed'],
    ['failed', '{malformed', 'Import failed'],
    [
      'timeout',
      '',
      'Import timed out. Check the admin activity log for results.',
    ],
  ])(
    'renders terminal SSE failure from %s %#',
    async (event, data, expected) => {
      const context = await setup();
      const source = await startEnqueuedImport(context);

      await source.emit(event, data);

      expect(context.showAlert).toHaveBeenCalledWith(
        'Import Failed',
        expected,
        { variant: 'error' }
      );
      expect(renderedText(context.elements.get('result-summary'))).toEqual(
        expect.arrayContaining(['Import Failed', expected])
      );
      await source.emit('progress', JSON.stringify({ progress: 75 }));
      await source.emit(
        'completed',
        JSON.stringify({
          durationMs: 1,
          errorCount: 0,
          errors: [],
          skippedCount: 0,
          successCount: 1,
          totalRows: 1,
        })
      );
      await source.emit('failed', JSON.stringify({ error: 'ignored' }));
      await source.emit('completed', '{malformed');
      source.onerror?.();
      expect(context.showAlert).toHaveBeenCalledTimes(1);
    }
  );

  it('reports an import failure when optional result markup is absent', async () => {
    const context = await setup({
      omitElements: ['result-area', 'result-summary'],
    });
    const source = await startEnqueuedImport(context);

    await source.emit('failed', JSON.stringify({ error: 'Worker stopped' }));

    expect(context.showAlert).toHaveBeenCalledWith(
      'Import Failed',
      'Worker stopped',
      { variant: 'error' }
    );
  });

  it('falls back to polling when a completed SSE payload is malformed', async () => {
    const context = await setup();
    const source = await startEnqueuedImport(context, 'job-poll-complete');
    context.fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({
        result: {
          durationMs: 500,
          errorCount: 0,
          errors: [],
          skippedCount: 0,
          successCount: 1,
          totalRows: 1,
        },
        state: 'completed',
      }),
      ok: true,
    });

    await source.emit('completed', '{malformed');
    await vi.waitFor(() => expect(context.fetchMock).toHaveBeenCalledTimes(2));

    expect(context.fetchMock).toHaveBeenLastCalledWith(
      '/admin/data-transfer/users/import/job-poll-complete/status'
    );
    expect(renderedText(context.elements.get('result-summary'))).toEqual(
      expect.arrayContaining(['Import Completed Successfully'])
    );
  });

  it('polls after an SSE connection error and reports a failed job', async () => {
    const context = await setup();
    const source = await startEnqueuedImport(context, 'job-poll-failed');
    context.fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({ error: '', state: 'failed' }),
      ok: true,
    });

    source.onerror?.();
    await vi.waitFor(() =>
      expect(context.showAlert).toHaveBeenCalledWith(
        'Import Failed',
        'Import failed',
        { variant: 'error' }
      )
    );

    expect(source.close).toHaveBeenCalledOnce();
  });

  it('preserves the worker error reported by polling', async () => {
    const context = await setup();
    const source = await startEnqueuedImport(context, 'job-poll-custom-error');
    context.fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({
        error: 'Database write failed',
        state: 'failed',
      }),
      ok: true,
    });

    source.onerror?.();

    await vi.waitFor(() =>
      expect(context.showAlert).toHaveBeenCalledWith(
        'Import Failed',
        'Database write failed',
        { variant: 'error' }
      )
    );
  });

  it('ignores a stale polling callback after SSE completes the import', async () => {
    const intervalCallbacks: Array<() => Promise<void>> = [];
    vi.spyOn(globalThis, 'setInterval').mockImplementation(handler => {
      intervalCallbacks.push(handler as () => Promise<void>);
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const context = await setup();
    const source = await startEnqueuedImport(context, 'job-stale-poll');
    context.fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({ progress: 50, state: 'active' }),
      ok: true,
    });

    source.onerror?.();
    await vi.waitFor(() => expect(context.fetchMock).toHaveBeenCalledTimes(2));
    await source.emit(
      'completed',
      JSON.stringify({
        durationMs: 10,
        errorCount: 0,
        errors: [],
        skippedCount: 0,
        successCount: 1,
        totalRows: 1,
      })
    );

    await intervalCallbacks[0]!();

    expect(context.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('updates progress from polling and tolerates transient polling failures', async () => {
    vi.useFakeTimers();
    const context = await setup();
    const source = await startEnqueuedImport(context, 'job-poll-progress');
    context.fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ state: 'active' }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ progress: -25, state: 'active' }),
        ok: true,
      });

    source.onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetchMock).toHaveBeenCalledTimes(2);
    source.onerror?.();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(context.elements.get('progress-percent')?.textContent).toBe('0%');

    await source.emit('timeout');
  });

  it('starts polling when the SSE connection stays silent', async () => {
    vi.useFakeTimers();
    const context = await setup();
    const source = await startEnqueuedImport(context, 'job-safety-fallback');
    context.fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({ progress: 25, state: 'active' }),
      ok: true,
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(context.fetchMock).toHaveBeenLastCalledWith(
      '/admin/data-transfer/users/import/job-safety-fallback/status'
    );
    expect(context.elements.get('progress-percent')?.textContent).toBe('25%');

    await source.emit('failed', JSON.stringify({ error: 'Stopped' }));
  });

  it('requires confirmation before submitting an export containing secrets', async () => {
    const context = await setup();
    const checkbox = context.elements.get('include-secrets-checkbox')!;

    const uncheckedEvent = await context.exportForm.trigger('submit');
    expect(uncheckedEvent.preventDefault).not.toHaveBeenCalled();

    checkbox.checked = true;
    const cancelledEvent = await context.exportForm.trigger('submit');
    expect(cancelledEvent.preventDefault).toHaveBeenCalledOnce();
    expect(context.showConfirm).toHaveBeenCalledWith(
      'Export Secrets',
      expect.stringContaining('sensitive internal data'),
      expect.objectContaining({ variant: 'warning' })
    );
    expect(context.exportForm.submit).not.toHaveBeenCalled();

    context.showConfirm.mockResolvedValueOnce(true);
    await context.exportForm.trigger('submit');
    expect(context.exportForm.submit).toHaveBeenCalledOnce();
  });
});
