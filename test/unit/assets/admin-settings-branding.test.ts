import { afterEach, describe, expect, it, vi } from 'vitest';

interface DomEvent {
  preventDefault: ReturnType<typeof vi.fn>;
  target: ElementFixture;
}

type Listener = (event: DomEvent) => unknown;

interface FileFixture {
  name: string;
  size: number;
  type: string;
}

class ElementFixture {
  public readonly classList = {
    add: vi.fn(),
    remove: vi.fn(),
  };
  public readonly click = vi.fn();
  public closestResult: ElementFixture | null = null;
  public readonly dispatchEvent = vi.fn();
  public files: FileFixture[] | null = null;
  public readonly listeners = new Map<string, Listener>();
  public previousElementSibling: ElementFixture | null = null;
  public readonly queryResults = new Map<string, ElementFixture>();
  public src = '';
  public readonly style: Record<string, string> = {};
  public readonly submit = vi.fn();
  public textContent = '';
  public value = '';

  public addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, listener);
  }

  public closest(): ElementFixture | null {
    return this.closestResult;
  }

  public querySelector(selector: string): ElementFixture | null {
    return this.queryResults.get(selector) ?? null;
  }

  public async trigger(
    name: string,
    event: DomEvent = { preventDefault: vi.fn(), target: this }
  ): Promise<DomEvent> {
    await this.listeners.get(name)?.(event);
    return event;
  }
}

const uploadElements = [
  ['logo-upload', 'preview-logo', 'upload-logo-button', 'remove-logo-button'],
  [
    'logo-dark-upload',
    'preview-logo-dark',
    'upload-logo-dark-button',
    'remove-logo-dark-button',
  ],
  [
    'logo-icon-upload',
    'preview-logo-icon',
    'upload-logo-icon-button',
    'remove-logo-icon-button',
  ],
  [
    'logo-icon-dark-upload',
    'preview-logo-icon-dark',
    'upload-logo-icon-dark-button',
    'remove-logo-icon-dark-button',
  ],
  [
    'favicon-upload',
    'preview-favicon',
    'upload-favicon-button',
    'remove-favicon-button',
  ],
] as const;

const destructiveActions = [
  ['remove-logo-button', 'Failed to remove logo', 'Failed to remove logo'],
  [
    'remove-logo-dark-button',
    'Failed to remove dark mode logo',
    'Failed to remove dark mode logo',
  ],
  [
    'remove-logo-icon-button',
    'Failed to remove icon logo',
    'Failed to remove icon logo',
  ],
  [
    'remove-logo-icon-dark-button',
    'Failed to remove dark icon logo',
    'Failed to remove dark icon logo',
  ],
  [
    'remove-favicon-button',
    'Failed to remove favicon',
    'Failed to remove favicon',
  ],
  ['reset-colors-button', 'Failed to reset colors', 'Failed to reset colors'],
  ['reset-fonts-button', 'Failed to reset fonts', 'Failed to reset fonts'],
] as const;

interface DomOptions {
  allElements?: boolean;
  dialog?: Record<string, unknown>;
  fileUpload?: Record<string, unknown>;
  state?: string;
}

function setupDom(options: DomOptions = {}) {
  let ready: (() => void) | undefined;
  const elements = new Map<string, ElementFixture>();
  const upload = new ElementFixture();
  const preview = new ElementFixture();
  const placeholder = new ElementFixture();
  const file = {
    name: 'icon.png',
    size: 1024,
    type: 'image/png',
  };
  upload.files = [file];
  elements.set('logo-icon-upload', upload);
  elements.set('preview-logo-icon', preview);
  elements.set('no-logo-icon-text', placeholder);

  if (options.allElements) {
    elements.clear();
    const form = new ElementFixture();
    const companyName = new ElementFixture();
    companyName.value = 'Parako';
    elements.set('branding-form', form);
    elements.set('companyName', companyName);

    uploadElements.forEach(
      ([uploadId, previewId, uploadButtonId, removeId]) => {
        const input = new ElementFixture();
        const image = new ElementFixture();
        const empty = new ElementFixture();
        image.previousElementSibling = empty;
        elements.set(uploadId, input);
        elements.set(previewId, image);
        elements.set(uploadButtonId, new ElementFixture());
        elements.set(removeId, new ElementFixture());
      }
    );

    [
      'no-logo-dark-text',
      'no-logo-icon-text',
      'no-logo-icon-dark-text',
      'no-favicon-text',
      'reset-colors-button',
      'randomize-colors-button',
      'reset-fonts-button',
      'fonts-sans',
      'fonts-heading',
      'fonts-mono',
      'preview-sans',
      'preview-heading',
      'preview-mono',
    ].forEach(id => elements.set(id, new ElementFixture()));
  }

  if (options.state !== undefined) {
    const state = new ElementFixture();
    state.textContent = options.state;
    elements.set('___ADMIN_BRANDING_STATE___', state);
  }

  const validateImageFile = vi.fn(() => ({
    error: 'invalid icon',
    valid: false,
  }));
  const showAlert = vi.fn().mockResolvedValue(undefined);

  const browserWindow = {
    FileUpload: options.fileUpload ?? {
      createImagePreview: vi.fn(),
      validateImageFile,
    },
    FormData: class {
      public append(): void {}
    },
    dialog: options.dialog ?? { showAlert },
    location: { reload: vi.fn() },
  };
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'DOMContentLoaded') ready = listener;
    }),
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    querySelector: vi.fn((selector: string) =>
      selector === 'input[name="_csrf"]'
        ? (elements.get('_csrf') ?? null)
        : null
    ),
  });

  return {
    browserWindow,
    elements,
    file,
    get: (id: string) => elements.get(id)!,
    runReady: () => ready?.(),
    showAlert,
    upload,
    validateImageFile,
  };
}

async function loadBranding(dom: ReturnType<typeof setupDom>): Promise<void> {
  await import('../../../src/assets/js/admin/settings/branding.js');
  dom.runReady();
}

describe('admin branding settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('validates icon logos with the intended five-megabyte limit', async () => {
    const dom = setupDom();

    await loadBranding(dom);
    await dom.upload.trigger('change');

    expect(dom.validateImageFile).toHaveBeenCalledWith(
      dom.file,
      5 * 1024 * 1024
    );
    expect(dom.showAlert).toHaveBeenCalledWith('Invalid File', 'invalid icon', {
      variant: 'error',
    });
  });

  it('wires every upload action and the form validation listener', async () => {
    const dom = setupDom({ allElements: true });

    await loadBranding(dom);

    for (const [uploadId, , uploadButtonId] of uploadElements) {
      await dom.get(uploadButtonId).trigger('click');
      expect(dom.get(uploadId).click).toHaveBeenCalledOnce();
      expect(dom.get(uploadId).listeners.has('change')).toBe(true);
    }
    expect(dom.get('branding-form').listeners.has('submit')).toBe(true);
    expect(dom.get('reset-colors-button').listeners.has('click')).toBe(true);
    expect(dom.get('randomize-colors-button').listeners.has('click')).toBe(
      true
    );
    expect(dom.get('reset-fonts-button').listeners.has('click')).toBe(true);
  });

  it('previews and submits a valid primary logo through FileUpload', async () => {
    const validateImageFile = vi.fn(() => ({ valid: true }));
    const createImagePreview = vi.fn().mockResolvedValue({ success: true });
    const dom = setupDom({
      allElements: true,
      fileUpload: { createImagePreview, validateImageFile },
    });
    const file = { name: 'logo.png', size: 1024, type: 'image/png' };
    dom.get('logo-upload').files = [file];

    await loadBranding(dom);
    await dom.get('logo-upload').trigger('change');

    expect(validateImageFile).toHaveBeenCalledWith(file, 5 * 1024 * 1024);
    expect(createImagePreview).toHaveBeenCalledWith(
      file,
      dom.get('preview-logo'),
      dom.get('preview-logo').previousElementSibling
    );
    expect(dom.get('branding-form').submit).toHaveBeenCalledOnce();
  });

  it.each([
    ['logo-upload', 'preview-logo'],
    ['logo-dark-upload', 'preview-logo-dark'],
    ['logo-icon-upload', 'preview-logo-icon'],
    ['logo-icon-dark-upload', 'preview-logo-icon-dark'],
  ] as const)(
    'rejects invalid image utility validation for %s',
    async (uploadId, _previewId) => {
      const validateImageFile = vi.fn(() => ({ valid: false }));
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const dom = setupDom({
        allElements: true,
        dialog: { showAlert },
        fileUpload: { createImagePreview: vi.fn(), validateImageFile },
      });
      dom.get(uploadId).files = [
        { name: 'invalid.png', size: 1024, type: 'image/png' },
      ];

      await loadBranding(dom);
      await dom.get(uploadId).trigger('change');

      expect(showAlert).toHaveBeenCalledWith(
        'Invalid File',
        'Please upload a valid image file',
        { variant: 'error' }
      );
      expect(dom.get(uploadId).value).toBe('');
    }
  );

  it.each([
    [
      'logo-dark-upload',
      'preview-logo-dark',
      'remove-logo-dark-button',
      '/admin/settings/branding/logo-dark',
    ],
    [
      'logo-icon-upload',
      'preview-logo-icon',
      'remove-logo-icon-button',
      '/admin/settings/branding/logo-icon',
    ],
    [
      'logo-icon-dark-upload',
      'preview-logo-icon-dark',
      'remove-logo-icon-dark-button',
      '/admin/settings/branding/logo-icon-dark',
    ],
  ] as const)(
    'uploads %s through its configured AJAX endpoint',
    async (uploadId, previewId, removeId, endpoint) => {
      const dom = setupDom({
        allElements: true,
        fileUpload: {
          createImagePreview: vi.fn(),
          validateImageFile: vi.fn(() => ({ valid: true })),
        },
        state: JSON.stringify({ csrfToken: 'csrf-token' }),
      });
      dom.get(uploadId).files = [
        { name: 'asset.png', size: 1024, type: 'image/png' },
      ];
      const fetchMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true, url: '/asset.png' }),
        ok: true,
      });
      vi.stubGlobal('fetch', fetchMock);

      await loadBranding(dom);
      await dom.get(uploadId).trigger('change');

      expect(fetchMock).toHaveBeenCalledWith(
        endpoint,
        expect.objectContaining({
          headers: { 'X-CSRF-Token': 'csrf-token' },
          method: 'POST',
        })
      );
      expect(dom.get(previewId).src).toBe('/asset.png');
      expect(dom.get(previewId).classList.remove).toHaveBeenCalledWith(
        'hidden'
      );
      expect(dom.get(removeId).classList.remove).toHaveBeenCalledWith('hidden');
    }
  );

  it('uploads a valid favicon by extension when its MIME type is generic', async () => {
    const dom = setupDom({
      allElements: true,
      state: JSON.stringify({ csrfToken: 'csrf-token' }),
    });
    dom.get('favicon-upload').files = [
      { name: 'favicon.ICO', size: 1024, type: 'application/octet-stream' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true, url: '/favicon.ico' }),
        ok: true,
      })
    );

    await loadBranding(dom);
    await dom.get('favicon-upload').trigger('change');

    expect(dom.get('preview-favicon').src).toBe('/favicon.ico');
    expect(dom.get('no-favicon-text').classList.add).toHaveBeenCalledWith(
      'hidden'
    );
  });

  it.each([
    [
      'remove-logo-dark-button',
      'preview-logo-dark',
      'no-logo-dark-text',
      '/admin/settings/branding/remove-logo-dark',
    ],
    [
      'remove-logo-icon-button',
      'preview-logo-icon',
      'no-logo-icon-text',
      '/admin/settings/branding/remove-logo-icon',
    ],
    [
      'remove-logo-icon-dark-button',
      'preview-logo-icon-dark',
      'no-logo-icon-dark-text',
      '/admin/settings/branding/remove-logo-icon-dark',
    ],
    [
      'remove-favicon-button',
      'preview-favicon',
      'no-favicon-text',
      '/admin/settings/branding/remove-favicon',
    ],
  ] as const)(
    'removes the configured asset through %s',
    async (buttonId, previewId, placeholderId, endpoint) => {
      const showConfirm = vi.fn().mockResolvedValue(true);
      const dom = setupDom({
        allElements: true,
        dialog: { showAlert: vi.fn(), showConfirm },
        state: JSON.stringify({ csrfToken: 'csrf-token' }),
      });
      dom.get(previewId).src = '/old-asset.png';
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      await loadBranding(dom);
      await dom.get(buttonId).trigger('click');

      expect(fetchMock).toHaveBeenCalledWith(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        },
        method: 'DELETE',
      });
      expect(dom.get(previewId).src).toBe('');
      expect(dom.get(previewId).classList.add).toHaveBeenCalledWith('hidden');
      expect(dom.get(placeholderId).classList.remove).toHaveBeenCalledWith(
        'hidden'
      );
      expect(dom.get(buttonId).classList.add).toHaveBeenCalledWith('hidden');
    }
  );

  it('removes the primary logo and reloads after confirmation', async () => {
    const showConfirm = vi.fn().mockResolvedValue(true);
    const dom = setupDom({
      allElements: true,
      dialog: { showAlert: vi.fn(), showConfirm },
      state: JSON.stringify({ csrfToken: 'csrf-token' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    await loadBranding(dom);
    await dom.get('remove-logo-button').trigger('click');

    expect(dom.get('preview-logo').src).toBe('');
    expect(
      dom.get('preview-logo').previousElementSibling?.classList.remove
    ).toHaveBeenCalledWith('hidden');
    expect(dom.browserWindow.location.reload).toHaveBeenCalledOnce();
  });

  it('does not remove an asset when confirmation is declined', async () => {
    const showConfirm = vi.fn().mockResolvedValue(false);
    const dom = setupDom({
      allElements: true,
      dialog: { showAlert: vi.fn(), showConfirm },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await loadBranding(dom);
    await dom.get('remove-logo-dark-button').trigger('click');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to native confirmation when the dialog rejects', async () => {
    const dom = setupDom({
      allElements: true,
      dialog: {
        showAlert: vi.fn(),
        showConfirm: vi.fn().mockRejectedValue(new Error('dialog unavailable')),
      },
    });
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    await loadBranding(dom);
    await dom.get('remove-logo-button').trigger('click');

    expect(confirm).toHaveBeenCalledWith(
      'Are you sure you want to remove the logo?'
    );
  });

  it.each([
    ['reset-colors-button', '/admin/settings/branding/reset-colors'],
    ['reset-fonts-button', '/admin/settings/branding/reset-fonts'],
  ] as const)('resets settings through %s', async (buttonId, endpoint) => {
    const dom = setupDom({
      allElements: true,
      dialog: {
        showAlert: vi.fn(),
        showConfirm: vi.fn().mockResolvedValue(true),
      },
      state: JSON.stringify({ csrfToken: 'csrf-token' }),
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await loadBranding(dom);
    await dom.get(buttonId).trigger('click');

    expect(fetchMock).toHaveBeenCalledWith(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      method: 'POST',
    });
    expect(dom.browserWindow.location.reload).toHaveBeenCalledOnce();
  });

  it('updates each live font preview with its configured fallback chain', async () => {
    const dom = setupDom({ allElements: true });
    dom.get('fonts-sans').value = '';
    dom.get('fonts-heading').value = '';
    dom.get('fonts-mono').value = '';

    await loadBranding(dom);
    await dom.get('fonts-sans').trigger('change');
    await dom.get('fonts-heading').trigger('change');
    await dom.get('fonts-mono').trigger('change');

    expect(dom.get('preview-sans').style.fontFamily).toBe(
      'system-ui, sans-serif'
    );
    expect(dom.get('preview-heading').style.fontFamily).toBe(
      'system-ui, sans-serif'
    );
    expect(dom.get('preview-mono').style.fontFamily).toBe('monospace');
  });

  it('blocks submission without a company name and accepts a valid name', async () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const dom = setupDom({
      allElements: true,
      dialog: { showAlert },
    });

    await loadBranding(dom);
    dom.get('companyName').value = '   ';
    const invalidEvent = await dom.get('branding-form').trigger('submit');
    expect(invalidEvent.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Validation Error',
      'Company name is required.',
      { variant: 'error' }
    );

    dom.get('companyName').value = 'Parako';
    const validEvent = await dom.get('branding-form').trigger('submit');
    expect(validEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('loads CSRF from the form and survives malformed serialized state', async () => {
    const dom = setupDom({ allElements: true, state: '{invalid' });
    const csrf = new ElementFixture();
    csrf.value = 'form-csrf';
    dom.elements.set('_csrf', csrf);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await loadBranding(dom);

    expect(consoleError).toHaveBeenCalledWith(
      '[BrandingSettingsManager] Initialization failed:',
      expect.any(SyntaxError)
    );
    expect(dom.get('branding-form').listeners.has('submit')).toBe(true);
  });

  it('ignores upload change events without a selected file', async () => {
    const dom = setupDom({ allElements: true });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await loadBranding(dom);
    for (const [uploadId] of uploadElements) {
      await dom.get(uploadId).trigger('change');
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'logo-upload',
    'logo-dark-upload',
    'logo-icon-upload',
    'logo-icon-dark-upload',
  ] as const)(
    'manually rejects oversized and unsupported files for %s',
    async uploadId => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const dom = setupDom({
        allElements: true,
        dialog: { showAlert },
        fileUpload: {},
      });
      await loadBranding(dom);

      dom.get(uploadId).files = [
        { name: 'large.png', size: 5 * 1024 * 1024 + 1, type: 'image/png' },
      ];
      await dom.get(uploadId).trigger('change');
      expect(showAlert).toHaveBeenCalledWith(
        'File Too Large',
        'File size must be less than 5MB',
        { variant: 'error' }
      );

      dom.get(uploadId).files = [
        { name: 'asset.txt', size: 1024, type: 'text/plain' },
      ];
      await dom.get(uploadId).trigger('change');
      expect(showAlert).toHaveBeenCalledWith(
        'Invalid File Type',
        expect.stringContaining('valid image file'),
        { variant: 'error' }
      );
      expect(dom.get(uploadId).value).toBe('');
    }
  );

  it('previews and submits a manually validated primary logo', async () => {
    const dom = setupDom({ allElements: true, fileUpload: {} });
    dom.get('logo-upload').files = [
      { name: 'logo.webp', size: 1024, type: 'image/webp' },
    ];
    class FileReaderFixture {
      public onload: ((event: { target: { result: string } }) => void) | null =
        null;

      public readAsDataURL(): void {
        this.onload?.({ target: { result: 'data:image/webp;base64,preview' } });
      }
    }
    vi.stubGlobal('FileReader', FileReaderFixture);

    await loadBranding(dom);
    await dom.get('logo-upload').trigger('change');

    expect(dom.get('preview-logo').src).toBe('data:image/webp;base64,preview');
    expect(dom.get('preview-logo').classList.remove).toHaveBeenCalledWith(
      'hidden'
    );
    expect(
      dom.get('preview-logo').previousElementSibling?.classList.add
    ).toHaveBeenCalledWith('hidden');
    expect(dom.get('branding-form').submit).toHaveBeenCalledOnce();
  });

  it.each([
    'logo-dark-upload',
    'logo-icon-upload',
    'logo-icon-dark-upload',
  ] as const)('uploads a manually validated image for %s', async uploadId => {
    const dom = setupDom({ allElements: true, fileUpload: {} });
    dom.get(uploadId).files = [
      { name: 'asset.svg', size: 1024, type: 'image/svg+xml' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true, url: '/asset.svg' }),
        ok: true,
      })
    );

    await loadBranding(dom);
    await dom.get(uploadId).trigger('change');

    expect(dom.get(uploadId).value).toBe('');
  });

  it('rejects oversized and unsupported favicons', async () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const dom = setupDom({
      allElements: true,
      dialog: { showAlert },
    });
    await loadBranding(dom);

    dom.get('favicon-upload').files = [
      { name: 'large.png', size: 1024 * 1024 + 1, type: 'image/png' },
    ];
    await dom.get('favicon-upload').trigger('change');
    expect(showAlert).toHaveBeenCalledWith(
      'File Too Large',
      'Favicon must be less than 1MB',
      { variant: 'error' }
    );

    dom.get('favicon-upload').files = [
      { name: 'favicon.txt', size: 1024, type: 'text/plain' },
    ];
    await dom.get('favicon-upload').trigger('change');
    expect(showAlert).toHaveBeenCalledWith(
      'Invalid File Type',
      'Please upload an ICO, PNG, or SVG file',
      { variant: 'error' }
    );
  });

  it.each([
    ['logo-icon-upload', 'Upload Failed'],
    ['logo-dark-upload', 'Upload Failed'],
  ] as const)(
    'reports rejected AJAX upload responses for %s',
    async (uploadId, title) => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const dom = setupDom({
        allElements: true,
        dialog: { showAlert },
        fileUpload: {
          createImagePreview: vi.fn(),
          validateImageFile: vi.fn(() => ({ valid: true })),
        },
      });
      dom.get(uploadId).files = [
        { name: 'asset.png', size: 1024, type: 'image/png' },
      ];
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ error: 'upload rejected' }),
          ok: false,
        })
      );

      await loadBranding(dom);
      await dom.get(uploadId).trigger('change');

      expect(showAlert).toHaveBeenCalledWith(title, 'upload rejected', {
        variant: 'error',
      });
    }
  );

  it.each(['logo-icon-upload', 'logo-dark-upload'] as const)(
    'reports network upload failures for %s',
    async uploadId => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const dom = setupDom({
        allElements: true,
        dialog: { showAlert },
        fileUpload: {
          createImagePreview: vi.fn(),
          validateImageFile: vi.fn(() => ({ valid: true })),
        },
      });
      dom.get(uploadId).files = [
        { name: 'asset.png', size: 1024, type: 'image/png' },
      ];
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadBranding(dom);
      await dom.get(uploadId).trigger('change');

      expect(showAlert).toHaveBeenCalledWith('Error', 'Failed to upload file', {
        variant: 'error',
      });
    }
  );

  it('uses native confirmation when the dialog API is unavailable', async () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const dom = setupDom({ allElements: true, dialog: { showAlert } });
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    await loadBranding(dom);
    for (const [buttonId] of destructiveActions) {
      await dom.get(buttonId).trigger('click');
    }

    expect(confirm).toHaveBeenCalledTimes(destructiveActions.length);
  });

  it('falls back to native confirmation for every rejected dialog', async () => {
    const dom = setupDom({
      allElements: true,
      dialog: {
        showAlert: vi.fn(),
        showConfirm: vi.fn().mockRejectedValue(new Error('dialog failed')),
      },
    });
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    await loadBranding(dom);
    for (const [buttonId] of destructiveActions) {
      await dom.get(buttonId).trigger('click');
    }

    expect(confirm).toHaveBeenCalledTimes(destructiveActions.length);
  });

  it.each(destructiveActions)(
    'shows the safe default response error for %s',
    async (buttonId, responseMessage) => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const dom = setupDom({
        allElements: true,
        dialog: {
          showAlert,
          showConfirm: vi.fn().mockResolvedValue(true),
        },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: vi.fn().mockRejectedValue(new Error('not json')),
          ok: false,
        })
      );

      await loadBranding(dom);
      await dom.get(buttonId).trigger('click');

      expect(showAlert).toHaveBeenCalledWith(
        expect.stringContaining('Failed'),
        responseMessage,
        { variant: 'error' }
      );
    }
  );

  it.each(destructiveActions)(
    'reports the network failure for %s',
    async (buttonId, _responseMessage, networkMessage) => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const dom = setupDom({
        allElements: true,
        dialog: {
          showAlert,
          showConfirm: vi.fn().mockResolvedValue(true),
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadBranding(dom);
      await dom.get(buttonId).trigger('click');

      expect(showAlert).toHaveBeenCalledWith('Error', networkMessage, {
        variant: 'error',
      });
    }
  );

  it('randomizes and synchronizes light and dark color controls', async () => {
    const dom = setupDom({ allElements: true });
    const form = dom.get('branding-form');
    const colorNames = [
      'primary',
      'primaryForeground',
      'secondary',
      'accent',
      'destructive',
      'success',
      'warning',
      'info',
      'background',
      'foreground',
      'card',
      'muted',
      'border',
      'input',
      'ring',
      'sidebar',
      'sidebarForeground',
      'sidebarPrimary',
      'sidebarAccent',
    ];
    const colorPicker = new ElementFixture();

    for (const mode of ['light', 'dark']) {
      for (const colorName of colorNames) {
        const input = new ElementFixture();
        if (colorName === 'primary') {
          const container = new ElementFixture();
          container.queryResults.set('input[type="color"]', colorPicker);
          input.closestResult = container;
        }
        form.queryResults.set(
          `input[type="text"][name="colors[${mode}][${colorName}]"]`,
          input
        );
      }
    }

    vi.stubGlobal(
      'Event',
      class {
        public constructor(
          public readonly type: string,
          public readonly options: { bubbles: boolean }
        ) {}
      }
    );
    const random = vi.spyOn(Math, 'random');
    await loadBranding(dom);

    for (const value of [0, 0.25, 0.5, 0.75, 0.99]) {
      random.mockReturnValue(value);
      await dom.get('randomize-colors-button').trigger('click');
    }

    const primary = form.queryResults.get(
      'input[type="text"][name="colors[light][primary]"]'
    )!;
    expect(primary.value).toMatch(/^#[0-9a-f]{6}$/);
    expect(primary.dispatchEvent).toHaveBeenCalled();
    expect(colorPicker.value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('uses configured font values in each live preview', async () => {
    const dom = setupDom({ allElements: true });
    dom.get('fonts-sans').value = 'Inter';
    dom.get('fonts-heading').value = 'Poppins';
    dom.get('fonts-mono').value = 'Fira Code';

    await loadBranding(dom);
    await dom.get('fonts-sans').trigger('change');
    await dom.get('fonts-heading').trigger('change');
    await dom.get('fonts-mono').trigger('change');

    expect(dom.get('preview-sans').style.fontFamily).toBe('Inter');
    expect(dom.get('preview-heading').style.fontFamily).toBe('Poppins');
    expect(dom.get('preview-mono').style.fontFamily).toBe('Fira Code');
  });

  it('falls back to the native alert when the dialog API is unavailable', async () => {
    const dom = setupDom({ allElements: true, dialog: {} });
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    dom.get('companyName').value = '';

    await loadBranding(dom);
    await dom.get('branding-form').trigger('submit');

    expect(alert).toHaveBeenCalledWith('Company name is required.');
  });

  it('initializes upload inputs when optional action buttons are absent', async () => {
    const dom = setupDom({ allElements: true });
    for (const [, , buttonId] of uploadElements) {
      dom.elements.delete(buttonId);
    }

    await loadBranding(dom);

    for (const [uploadId] of uploadElements) {
      expect(dom.get(uploadId).listeners.has('change')).toBe(true);
    }
  });

  it('skips icon upload setup when a required element is absent', async () => {
    const dom = setupDom({ allElements: true });
    dom.elements.delete('logo-icon-upload');

    await loadBranding(dom);

    expect(dom.get('upload-logo-icon-button').listeners.size).toBe(0);
  });

  it('does not submit a manual logo preview without reader output', async () => {
    const dom = setupDom({ allElements: true, fileUpload: {} });
    dom.get('logo-upload').files = [
      { name: 'logo.webp', size: 1024, type: 'image/webp' },
    ];
    class EmptyFileReaderFixture {
      public onload: ((event: { target: { result: string } }) => void) | null =
        null;

      public readAsDataURL(): void {
        this.onload?.({ target: { result: '' } });
      }
    }
    vi.stubGlobal('FileReader', EmptyFileReaderFixture);

    await loadBranding(dom);
    await dom.get('logo-upload').trigger('change');

    expect(dom.get('branding-form').submit).not.toHaveBeenCalled();
  });

  it.each([
    ['remove-logo-button', 'preview-logo'],
    ['remove-logo-dark-button', 'preview-logo-dark'],
    ['remove-logo-icon-button', 'preview-logo-icon'],
    ['remove-logo-icon-dark-button', 'preview-logo-icon-dark'],
    ['remove-favicon-button', 'preview-favicon'],
  ] as const)(
    'removes an asset through %s when its optional preview is absent',
    async (buttonId, previewId) => {
      const dom = setupDom({
        allElements: true,
        dialog: {
          showAlert: vi.fn(),
          showConfirm: vi.fn().mockResolvedValue(true),
        },
      });
      dom.elements.delete(previewId);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      await loadBranding(dom);
      await dom.get(buttonId).trigger('click');

      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  it.each(['logo-icon-upload', 'logo-dark-upload'] as const)(
    'uses the safe default response error for %s',
    async uploadId => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const dom = setupDom({
        allElements: true,
        dialog: { showAlert },
        fileUpload: {
          createImagePreview: vi.fn(),
          validateImageFile: vi.fn(() => ({ valid: true })),
        },
      });
      dom.get(uploadId).files = [
        { name: 'asset.png', size: 1024, type: 'image/png' },
      ];
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ success: false }),
          ok: false,
        })
      );

      await loadBranding(dom);
      await dom.get(uploadId).trigger('change');

      expect(showAlert).toHaveBeenCalledWith(
        'Upload Failed',
        'Failed to upload file',
        { variant: 'error' }
      );
    }
  );

  it('ignores absent color inputs and tolerates a missing color picker', async () => {
    const dom = setupDom({ allElements: true });
    const input = new ElementFixture();
    input.closestResult = new ElementFixture();
    dom
      .get('branding-form')
      .queryResults.set(
        'input[type="text"][name="colors[light][primary]"]',
        input
      );
    vi.stubGlobal(
      'Event',
      class {
        public constructor(
          public readonly type: string,
          public readonly options: { bubbles: boolean }
        ) {}
      }
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);

    await loadBranding(dom);
    await dom.get('randomize-colors-button').trigger('click');

    expect(input.value).toMatch(/^#[0-9a-f]{6}$/);
    expect(input.dispatchEvent).toHaveBeenCalledOnce();
  });

  it('loads CSRF from the form when serialized state is empty', async () => {
    const dom = setupDom({
      allElements: true,
      dialog: {
        showAlert: vi.fn(),
        showConfirm: vi.fn().mockResolvedValue(true),
      },
      state: '',
    });
    const csrf = new ElementFixture();
    csrf.value = 'form-csrf';
    dom.elements.set('_csrf', csrf);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await loadBranding(dom);
    await dom.get('reset-colors-button').trigger('click');

    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/settings/branding/reset-colors',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRF-Token': 'form-csrf' }),
      })
    );
  });
});
