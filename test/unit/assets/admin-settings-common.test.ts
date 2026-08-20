import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeAdminSettingsPage,
  type DialogPort,
} from '../../../src/assets/js/admin/settings/common.js';
import { FileUpload } from '../../../src/assets/js/utils/file-upload.js';

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
    dialog?: DialogPort | null;
    elements?: Record<string, ElementFixture>;
    fileUpload?: Partial<typeof FileUpload>;
    form?: FormFixture | null;
    includeState?: boolean;
    state?: string;
    csrfInput?: { value: string } | null;
    resetButtons?: ElementFixture[];
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

  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    getElementById: vi.fn((id: string) => elements[id] ?? null),
    querySelector: vi.fn((selector: string) => {
      if (selector === 'form') return form ?? null;
      if (selector === 'input[name="_csrf"]') return options.csrfInput ?? null;
      return null;
    }),
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === '[data-settings-reset]') {
        return options.resetButtons ?? [];
      }
      if (selector === 'textarea') {
        return options.textareas ?? [];
      }
      return [];
    }),
  });
  const windowRoot = options.window ?? {};
  const fileUpload = options.fileUpload;
  if (fileUpload?.validateImageFile) {
    vi.spyOn(FileUpload, 'validateImageFile').mockImplementation(
      fileUpload.validateImageFile
    );
  }
  if (fileUpload?.createImagePreview) {
    vi.spyOn(FileUpload, 'createImagePreview').mockImplementation(
      fileUpload.createImagePreview
    );
  }
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false)
  );
  vi.stubGlobal('alert', vi.fn());

  initializeAdminSettingsPage(options.dialog ?? null);

  return { elements, form, windowRoot };
}

describe('admin settings common manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
      dialog: { showAlert },
    });

    await expect(logoUpload.listeners.change?.()).resolves.toBeUndefined();
    expect(alert).toHaveBeenCalledWith('File size must be less than 5MB');
    expect(logoUpload.value).toBe('');
  });

  it('resets the selected form and auto-resizes textareas', async () => {
    const form = makeForm();
    const resetButton = makeElement();
    const textarea = makeElement();
    textarea.scrollHeight = 73;
    const showConfirm = vi.fn().mockResolvedValue(true);
    const dialog = { showConfirm };

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
      resetButtons: [resetButton],
      textareas: [textarea],
      dialog,
    });

    textarea.listeners.input?.call(textarea);
    await resetButton.listeners.click?.();

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
    const rejectedResetButton = makeElement();
    const rejectedConfirm = vi.fn().mockRejectedValue(new Error('offline'));
    const rejectedDialog = { showConfirm: rejectedConfirm };
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    await loadModule({
      form: rejectedForm,
      resetButtons: [rejectedResetButton],
      dialog: rejectedDialog,
    });
    vi.mocked(confirm).mockReturnValue(true);

    await rejectedResetButton.listeners.click?.();
    expect(rejectedForm.reset).toHaveBeenCalledOnce();

    const cancelledForm = makeForm();
    const cancelledResetButton = makeElement();
    await loadModule({
      form: cancelledForm,
      resetButtons: [cancelledResetButton],
    });
    vi.mocked(confirm).mockReturnValue(false);
    await cancelledResetButton.listeners.click?.();
    expect(cancelledForm.reset).not.toHaveBeenCalled();

    vi.mocked(confirm).mockReturnValue(true);
    const noFormResetButton = makeElement();
    await loadModule({
      form: null,
      resetButtons: [noFormResetButton],
    });
    await expect(
      noFormResetButton.listeners.click?.()
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
    const createImagePreview = vi
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValue({ success: true });
    const showAlert = vi.fn().mockResolvedValue(undefined);

    await loadModule({
      elements: {
        'branding-form': form,
        'logo-upload': logoUpload,
        'preview-logo': preview,
        'upload-logo-button': uploadButton,
      },
      fileUpload: { validateImageFile, createImagePreview },
      dialog: { showAlert },
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
    expect(form.submit).not.toHaveBeenCalled();

    await logoUpload.listeners.change?.();
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

    await loadModule({
      elements: { 'logo-upload': logoUpload, 'preview-logo': preview },
      state: JSON.stringify({ features: { hasLogoUpload: false } }),
    });
    expect(logoUpload.listeners.change).toBeUndefined();

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

  it('leaves logo controls to the dedicated branding manager', async () => {
    const logoUpload = makeInput();
    const preview = makeElement();
    const removeButton = makeElement();
    const resetButton = makeElement();

    await loadModule({
      elements: {
        ___ADMIN_BRANDING_STATE___: makeElement(),
        'logo-upload': logoUpload,
        'preview-logo': preview,
        'remove-logo-button': removeButton,
      },
      resetButtons: [resetButton],
      state: JSON.stringify({ features: { hasLogoUpload: true } }),
    });

    expect(logoUpload.listeners.change).toBeUndefined();
    expect(removeButton.listeners.click).toBeUndefined();
    expect(resetButton.listeners.click).toEqual(expect.any(Function));
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
      dialog: { showConfirm },
      window: { location: { reload } },
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
    const dialog = { showConfirm };
    const windowRoot = { location: { reload } };
    await loadModule({
      elements: { 'remove-logo-button': cancelledButton },
      state: JSON.stringify({
        routes: { removeLogo: '' },
        features: { hasLogoUpload: true },
      }),
      csrfInput: { value: 'csrf-input' },
      dialog,
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
      dialog: { showConfirm, showAlert },
      window: { location: { reload: vi.fn() } },
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
    const resetButton = makeElement();
    await loadModule({
      resetButtons: [resetButton],
      state: '{broken',
    });

    expect(errorSpy).toHaveBeenCalledWith(
      '[AdminSettingsManager] Initialization failed:',
      expect.any(SyntaxError)
    );
    expect(resetButton.listeners.click).toEqual(expect.any(Function));
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

    const emptyResetButton = makeElement();
    await loadModule({
      resetButtons: [emptyResetButton],
      state: '',
    });
    expect(emptyResetButton.listeners.click).toEqual(expect.any(Function));
  });
});
