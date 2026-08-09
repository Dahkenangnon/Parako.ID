import { afterEach, describe, expect, it, vi } from 'vitest';

interface ElementFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  click: ReturnType<typeof vi.fn>;
  listeners: Record<string, () => unknown>;
  previousElementSibling: ElementFixture | null;
  scrollHeight: number;
  src: string;
  style: { height: string };
}

interface InputFixture extends ElementFixture {
  files: Array<{ size: number; type: string }>;
  value: string;
}

interface FormFixture extends ElementFixture {
  reset: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
}

function makeElement(): ElementFixture {
  const element: ElementFixture = {
    addEventListener: vi.fn((name: string, listener: () => unknown) => {
      element.listeners[name] = listener;
    }),
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    click: vi.fn(),
    listeners: {},
    previousElementSibling: null,
    scrollHeight: 0,
    src: '',
    style: { height: '' },
  };
  return element;
}

function makeInput(): InputFixture {
  return {
    ...makeElement(),
    files: [],
    value: 'selected',
  };
}

function makeForm(): FormFixture {
  return {
    ...makeElement(),
    reset: vi.fn(),
    submit: vi.fn(),
  };
}

async function loadModule(
  options: {
    elements?: Record<string, ElementFixture>;
    form?: FormFixture | null;
    includeState?: boolean;
    state?: string;
    csrfInput?: { value: string } | null;
    textareas?: ElementFixture[];
    window?: Record<string, unknown>;
  } = {}
) {
  const elements = { ...(options.elements ?? {}) };
  const form = Object.hasOwn(options, 'form') ? options.form : makeForm();
  if (options.includeState !== false) {
    const state = makeElement() as ElementFixture & { textContent?: string };
    state.textContent = options.state ?? '{}';
    elements.___ADMIN_SETTINGS_STATE___ = state;
  }

  let ready: (() => void) | undefined;
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'DOMContentLoaded') ready = listener;
    }),
    getElementById: vi.fn((id: string) => elements[id] ?? null),
    querySelector: vi.fn((selector: string) => {
      if (selector === 'form') return form ?? null;
      if (selector === 'input[name="_csrf"]') return options.csrfInput ?? null;
      return null;
    }),
    querySelectorAll: vi.fn(() => options.textareas ?? []),
  });
  const windowRoot = options.window ?? {};
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false)
  );
  vi.stubGlobal('alert', vi.fn());

  await import('../../../src/assets/js/admin/settings/common.js');
  ready?.();

  return { elements, form, windowRoot };
}

describe('admin settings common manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back to the native alert when the dialog rejects', async () => {
    const logoUpload = makeInput();
    const preview = makeElement();
    logoUpload.files = [{ size: 6 * 1024 * 1024, type: 'image/png' }];
    const showAlert = vi.fn().mockRejectedValue(new Error('dialog failed'));

    await loadModule({
      elements: {
        'logo-upload': logoUpload,
        'preview-logo': preview,
      },
      window: { dialog: { showAlert } },
    });

    await expect(logoUpload.listeners.change?.()).resolves.toBeUndefined();
    expect(alert).toHaveBeenCalledWith('File size must be less than 5MB');
    expect(logoUpload.value).toBe('');
  });

  it('resets the selected form and auto-resizes textareas', async () => {
    const form = makeForm();
    const textarea = makeElement();
    textarea.scrollHeight = 73;
    const showConfirm = vi.fn().mockResolvedValue(true);
    const windowRoot = { dialog: { showConfirm } };

    await loadModule({
      elements: { 'branding-form': form },
      form: null,
      state: JSON.stringify({
        translations: {
          resetFormTitle: 'Start over',
          resetFormMessage: 'Discard changes?',
          resetFormConfirm: 'Discard',
          resetFormCancel: 'Keep editing',
        },
        features: { hasLogoUpload: false },
      }),
      textareas: [textarea],
      window: windowRoot,
    });

    textarea.listeners.input?.call(textarea);
    await (
      windowRoot as typeof windowRoot & { resetForm: () => Promise<void> }
    ).resetForm();

    expect(textarea.style.height).toBe('73px');
    expect(showConfirm).toHaveBeenCalledWith('Start over', 'Discard changes?', {
      variant: 'warning',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
    });
    expect(form.reset).toHaveBeenCalledOnce();
  });

  it('uses native reset confirmation when the dialog is absent or rejects', async () => {
    const rejectedForm = makeForm();
    const rejectedConfirm = vi.fn().mockRejectedValue(new Error('offline'));
    const rejectedWindow = { dialog: { showConfirm: rejectedConfirm } };
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    await loadModule({ form: rejectedForm, window: rejectedWindow });
    vi.mocked(confirm).mockReturnValue(true);

    await (
      rejectedWindow as typeof rejectedWindow & {
        resetForm: () => Promise<void>;
      }
    ).resetForm();
    expect(rejectedForm.reset).toHaveBeenCalledOnce();

    vi.resetModules();
    const cancelledForm = makeForm();
    const nativeWindow: Record<string, unknown> = {};
    await loadModule({ form: cancelledForm, window: nativeWindow });
    vi.mocked(confirm).mockReturnValue(false);
    await (nativeWindow.resetForm as () => Promise<void>)();
    expect(cancelledForm.reset).not.toHaveBeenCalled();

    vi.resetModules();
    vi.mocked(confirm).mockReturnValue(true);
    const noFormWindow: Record<string, unknown> = {};
    await loadModule({ form: null, window: noFormWindow });
    await expect(
      (noFormWindow.resetForm as () => Promise<void>)()
    ).resolves.toBeUndefined();
  });

  it('validates and previews logos through the shared FileUpload API', async () => {
    const logoUpload = makeInput();
    const preview = makeElement();
    const placeholder = makeElement();
    const uploadButton = makeElement();
    const form = makeForm();
    preview.previousElementSibling = placeholder;
    logoUpload.files = [{ size: 42, type: 'image/png' }];
    const validateImageFile = vi
      .fn()
      .mockReturnValueOnce({ valid: false, error: 'Bad image' })
      .mockReturnValueOnce({ valid: false })
      .mockReturnValue({ valid: true });
    const createImagePreview = vi.fn().mockResolvedValue({ success: true });
    const showAlert = vi.fn().mockResolvedValue(undefined);

    await loadModule({
      elements: {
        'branding-form': form,
        'logo-upload': logoUpload,
        'preview-logo': preview,
        'upload-logo-button': uploadButton,
      },
      window: {
        FileUpload: { validateImageFile, createImagePreview },
        dialog: { showAlert },
      },
    });

    uploadButton.listeners.click?.();
    expect(logoUpload.click).toHaveBeenCalledOnce();

    await logoUpload.listeners.change?.();
    expect(showAlert).toHaveBeenLastCalledWith(
      'Invalid File Type',
      'Bad image',
      {
        variant: 'error',
      }
    );

    logoUpload.value = 'again';
    await logoUpload.listeners.change?.();
    expect(showAlert).toHaveBeenLastCalledWith(
      'Invalid File Type',
      'Please upload a valid image file (JPG, PNG, GIF, WebP, or SVG)',
      { variant: 'error' }
    );

    await logoUpload.listeners.change?.();
    expect(validateImageFile).toHaveBeenLastCalledWith(
      logoUpload.files[0],
      5 * 1024 * 1024
    );
    expect(createImagePreview).toHaveBeenCalledWith(
      logoUpload.files[0],
      preview,
      placeholder
    );
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('uses manual logo validation and preview when FileUpload is unavailable', async () => {
    const logoUpload = makeInput();
    const preview = makeElement();
    const placeholder = makeElement();
    const form = makeForm();
    preview.previousElementSibling = placeholder;
    const readers: Array<{
      onload?: (event: { target: { result: string | null } }) => void;
    }> = [];
    class Reader {
      public onload?: (event: { target: { result: string | null } }) => void;
      constructor() {
        readers.push(this);
      }
      public readAsDataURL(): void {}
    }
    vi.stubGlobal('FileReader', Reader);

    await loadModule({
      elements: {
        'branding-form': form,
        'logo-upload': logoUpload,
        'preview-logo': preview,
      },
    });

    logoUpload.files = [{ size: 6 * 1024 * 1024, type: 'image/png' }];
    await logoUpload.listeners.change?.();
    expect(alert).toHaveBeenLastCalledWith('File size must be less than 5MB');

    logoUpload.value = 'invalid';
    logoUpload.files = [{ size: 42, type: 'text/plain' }];
    await logoUpload.listeners.change?.();
    expect(alert).toHaveBeenLastCalledWith(
      'Please upload a valid image file (JPG, PNG, GIF, WebP, or SVG)'
    );

    logoUpload.files = [{ size: 42, type: 'image/svg+xml' }];
    await logoUpload.listeners.change?.();
    readers[0]?.onload?.({ target: { result: null } });
    expect(form.submit).not.toHaveBeenCalled();
    readers[0]?.onload?.({
      target: { result: 'data:image/svg+xml;base64,AA==' },
    });
    expect(preview.src).toContain('data:image/svg+xml');
    expect(preview.classList.remove).toHaveBeenCalledWith('hidden');
    expect(placeholder.classList.add).toHaveBeenCalledWith('hidden');
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('skips logo setup when required elements or the feature are absent', async () => {
    const logoUpload = makeInput();
    const preview = makeElement();

    await loadModule({
      elements: { 'logo-upload': logoUpload },
      state: JSON.stringify({ features: { hasLogoUpload: true } }),
    });
    expect(logoUpload.listeners.change).toBeUndefined();

    vi.resetModules();
    await loadModule({
      elements: { 'logo-upload': logoUpload, 'preview-logo': preview },
      state: JSON.stringify({ features: { hasLogoUpload: false } }),
    });
    expect(logoUpload.listeners.change).toBeUndefined();

    vi.resetModules();
    const emptyUpload = makeInput();
    const emptyPreview = makeElement();
    const emptyForm = makeForm();
    await loadModule({
      elements: {
        'branding-form': emptyForm,
        'logo-upload': emptyUpload,
        'preview-logo': emptyPreview,
      },
    });
    await expect(emptyUpload.listeners.change?.()).resolves.toBeUndefined();
    expect(emptyForm.submit).not.toHaveBeenCalled();
  });

  it('removes a logo through the configured route and refreshes the page', async () => {
    const removeButton = makeElement();
    const preview = makeElement();
    const placeholder = makeElement();
    preview.src = 'data:image/png;base64,AA==';
    preview.previousElementSibling = placeholder;
    const showConfirm = vi.fn().mockResolvedValue(true);
    const reload = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await loadModule({
      elements: {
        'remove-logo-button': removeButton,
        'preview-logo': preview,
      },
      state: JSON.stringify({
        csrfToken: 'csrf-state',
        routes: { removeLogo: '/custom/remove-logo' },
        features: { hasLogoUpload: true },
      }),
      window: { dialog: { showConfirm }, location: { reload } },
    });

    await removeButton.listeners.click?.();

    expect(showConfirm).toHaveBeenCalledWith(
      'Remove Logo',
      'Are you sure you want to remove the logo?',
      {
        variant: 'danger',
        confirmText: 'Remove',
        cancelText: 'Cancel',
      }
    );
    expect(fetchMock).toHaveBeenCalledWith('/custom/remove-logo', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-state',
      },
    });
    expect(preview.src).toBe('');
    expect(preview.classList.add).toHaveBeenCalledWith('hidden');
    expect(placeholder.classList.remove).toHaveBeenCalledWith('hidden');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('supports cancellation and native confirmation for logo removal', async () => {
    const cancelledButton = makeElement();
    const showConfirm = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('dialog offline'));
    const reload = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const windowRoot = { dialog: { showConfirm }, location: { reload } };
    await loadModule({
      elements: { 'remove-logo-button': cancelledButton },
      state: JSON.stringify({
        routes: { removeLogo: '' },
        features: { hasLogoUpload: true },
      }),
      csrfInput: { value: 'csrf-input' },
      window: windowRoot,
    });

    await cancelledButton.listeners.click?.();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.mocked(confirm).mockReturnValue(true);
    await cancelledButton.listeners.click?.();
    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/settings/branding/remove-logo',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-input' }),
      })
    );
    expect(reload).toHaveBeenCalledOnce();

    vi.resetModules();
    const nativeButton = makeElement();
    const nativeReload = vi.fn();
    vi.mocked(confirm).mockReturnValue(false);
    await loadModule({
      elements: { 'remove-logo-button': nativeButton },
      state: JSON.stringify({ features: { hasLogoUpload: true } }),
      window: { location: { reload: nativeReload } },
    });
    await nativeButton.listeners.click?.();
    expect(nativeReload).not.toHaveBeenCalled();
  });

  it('shows server-provided and fallback removal errors', async () => {
    const removeButton = makeElement();
    const showConfirm = vi.fn().mockResolvedValue(true);
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: vi.fn().mockResolvedValue({ message: 'Logo is locked' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: vi.fn().mockRejectedValue(new Error('invalid JSON')),
      });
    vi.stubGlobal('fetch', fetchMock);

    await loadModule({
      elements: { 'remove-logo-button': removeButton },
      state: JSON.stringify({ features: { hasLogoUpload: true } }),
      window: {
        dialog: { showConfirm, showAlert },
        location: { reload: vi.fn() },
      },
    });

    await removeButton.listeners.click?.();
    expect(showAlert).toHaveBeenLastCalledWith(
      'Failed to remove logo',
      'Logo is locked',
      { variant: 'error' }
    );

    await removeButton.listeners.click?.();
    expect(showAlert).toHaveBeenLastCalledWith(
      'Failed to remove logo',
      'Failed to remove logo',
      { variant: 'error' }
    );
  });

  it('reports network failures while removing a logo', async () => {
    const removeButton = makeElement();
    const failure = new Error('network down');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

    await loadModule({
      elements: { 'remove-logo-button': removeButton },
      state: JSON.stringify({ features: { hasLogoUpload: true } }),
      window: { location: { reload: vi.fn() } },
    });
    vi.mocked(confirm).mockReturnValue(true);

    await removeButton.listeners.click?.();

    expect(errorSpy).toHaveBeenCalledWith(
      '[AdminSettingsManager] Remove logo error:',
      failure
    );
    expect(alert).toHaveBeenCalledWith('Failed to remove logo');
  });

  it('falls back to defaults when page state is malformed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const windowRoot: Record<string, unknown> = {};

    await loadModule({ state: '{broken', window: windowRoot });

    expect(errorSpy).toHaveBeenCalledWith(
      '[AdminSettingsManager] Initialization failed:',
      expect.any(SyntaxError)
    );
    expect(windowRoot.resetForm).toEqual(expect.any(Function));
  });

  it('infers logo support without state and tolerates an empty state payload', async () => {
    const inferredUpload = makeInput();
    const inferredPreview = makeElement();
    await loadModule({
      includeState: false,
      elements: {
        'logo-upload': inferredUpload,
        'preview-logo': inferredPreview,
      },
    });
    expect(inferredUpload.listeners.change).toEqual(expect.any(Function));

    vi.resetModules();
    const emptyWindow: Record<string, unknown> = {};
    await loadModule({ state: '', window: emptyWindow });
    expect(emptyWindow.resetForm).toEqual(expect.any(Function));
  });
});
