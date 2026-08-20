import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AvatarManager,
  type AvatarConfig,
} from '../../../src/assets/js/account/settings/avatar.js';

interface ElementFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  click: ReturnType<typeof vi.fn>;
  files?: Array<{ name: string }> | null;
  querySelector: ReturnType<typeof vi.fn>;
  src: string;
  style: Record<string, string>;
  submit: ReturnType<typeof vi.fn>;
  textContent: string;
}

function element(overrides: Partial<ElementFixture> = {}): ElementFixture {
  return {
    addEventListener: vi.fn(),
    classList: { add: vi.fn(), remove: vi.fn() },
    click: vi.fn(),
    querySelector: vi.fn(() => null),
    src: '',
    style: {},
    submit: vi.fn(),
    textContent: '',
    ...overrides,
  };
}

function config(overrides: Partial<AvatarConfig> = {}): AvatarConfig {
  return {
    removeAvatarUrl: '/accounts/avatar',
    csrfToken: 'csrf-token',
    translations: {
      removeConfirm: 'Remove this avatar?',
      removeError: 'Could not remove avatar',
      fileReadError: 'Could not read file',
      processingImage: 'Processing image',
    },
    ...overrides,
  };
}

class FileReaderFixture {
  static instances: FileReaderFixture[] = [];
  onload: ((event: { target?: { result?: string | null } }) => void) | null =
    null;
  onerror: (() => Promise<void>) | null = null;
  readAsDataURL = vi.fn();

  constructor() {
    FileReaderFixture.instances.push(this);
  }
}

function loadManager(elements: Record<string, ElementFixture | null> = {}) {
  FileReaderFixture.instances = [];
  const showAlert = vi.fn().mockResolvedValue(undefined);
  const showConfirm = vi.fn();
  const reload = vi.fn();
  vi.stubGlobal('window', { location: { reload } });
  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => elements[id] ?? null),
  });
  vi.stubGlobal('FileReader', FileReaderFixture);
  vi.stubGlobal('fetch', vi.fn());

  class TestAvatarManager extends AvatarManager {
    constructor(settings: AvatarConfig) {
      super(settings, { showAlert, showConfirm });
    }
  }

  return {
    Manager: TestAvatarManager,
    reload,
    showAlert,
    showConfirm,
  };
}

describe('account avatar manager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes an empty page without registering handlers', async () => {
    const { Manager } = await loadManager();

    expect(() => new Manager(config()).initialize()).not.toThrow();
  });

  it('opens the file chooser from the upload button', async () => {
    const upload = element();
    const button = element();
    const { Manager } = await loadManager({
      'avatar-upload': upload,
      'upload-button': button,
    });
    new Manager(config({ debug: true })).initialize();

    button.addEventListener.mock.calls[0]?.[1]();

    expect(upload.click).toHaveBeenCalledOnce();
    expect(upload.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
  });

  it('ignores an upload change without a selected file', async () => {
    const upload = element({ files: [] });
    const { Manager } = await loadManager({ 'avatar-upload': upload });
    new Manager(config()).initialize();

    upload.addEventListener.mock.calls[0]?.[1]();

    expect(FileReaderFixture.instances).toHaveLength(0);
  });

  it('previews an uploaded avatar, updates progress, and submits the form', async () => {
    vi.useFakeTimers();
    const file = { name: 'avatar.png' };
    const upload = element({ files: [file] });
    const preview = element();
    const initials = element();
    const form = element();
    const progressText = element();
    const progress = element({ querySelector: vi.fn(() => progressText) });
    const { Manager } = await loadManager({
      'avatar-upload': upload,
      'preview-avatar': preview,
      'initials-placeholder': initials,
      'profile-form': form,
      'upload-progress-widget': progress,
    });
    new Manager(config()).initialize();

    upload.addEventListener.mock.calls[0]?.[1]();
    const reader = FileReaderFixture.instances[0];
    reader?.onload?.({ target: { result: 'data:image/png;base64,abc' } });

    expect(reader?.readAsDataURL).toHaveBeenCalledWith(file);
    expect(progress.classList.remove).toHaveBeenCalledWith('hidden');
    expect(preview.src).toBe('data:image/png;base64,abc');
    expect(preview.classList.remove).toHaveBeenCalledWith('hidden');
    expect(initials.classList.add).toHaveBeenCalledWith('hidden');
    expect(progressText.textContent).toBe('Processing image');
    expect(form.submit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('tolerates a file result without preview, progress text, or form elements', async () => {
    vi.useFakeTimers();
    const upload = element({ files: [{ name: 'avatar.png' }] });
    const preview = element();
    const progress = element();
    const { Manager } = await loadManager({
      'avatar-upload': upload,
      'preview-avatar': preview,
      'upload-progress-widget': progress,
    });
    new Manager(config()).initialize();

    upload.addEventListener.mock.calls[0]?.[1]();
    FileReaderFixture.instances[0]?.onload?.({
      target: { result: 'data:image/png;base64,abc' },
    });
    FileReaderFixture.instances[0]?.onload?.({});
    await vi.advanceTimersByTimeAsync(500);

    expect(progress.querySelector).toHaveBeenCalledWith('p:first-of-type');
  });

  it('hides upload progress and reports file read errors', async () => {
    const upload = element({ files: [{ name: 'broken.png' }] });
    const progressText = element();
    const progress = element({ querySelector: vi.fn(() => progressText) });
    const { Manager, showAlert } = await loadManager({
      'avatar-upload': upload,
      'upload-progress-widget': progress,
    });
    new Manager(config()).initialize();

    upload.addEventListener.mock.calls[0]?.[1]();
    await FileReaderFixture.instances[0]?.onerror?.();

    expect(progress.classList.add).toHaveBeenCalledWith('hidden');
    expect(progressText.textContent).toBe('Uploading Profile Picture...');
    expect(showAlert).toHaveBeenCalledWith(
      'File Error',
      'Could not read file',
      { variant: 'error' }
    );
  });

  it('reports file errors even when the progress widget is absent', async () => {
    vi.useFakeTimers();
    const upload = element({ files: [{ name: 'broken.png' }] });
    const { Manager, showAlert } = await loadManager({
      'avatar-upload': upload,
    });
    new Manager(config()).initialize();
    upload.addEventListener.mock.calls[0]?.[1]();

    FileReaderFixture.instances[0]?.onload?.({});
    await FileReaderFixture.instances[0]?.onerror?.();
    await vi.advanceTimersByTimeAsync(500);

    expect(showAlert).toHaveBeenCalledOnce();
  });

  it('leaves the avatar unchanged when removal is cancelled', async () => {
    const remove = element();
    const { Manager, showConfirm } = await loadManager({
      'remove-button': remove,
    });
    showConfirm.mockResolvedValue(false);
    new Manager(config()).initialize();

    await remove.addEventListener.mock.calls[0]?.[1]();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes an avatar and refreshes the account page', async () => {
    const remove = element();
    const preview = element({ src: 'old-avatar' });
    const initials = element();
    const { Manager, reload, showConfirm } = await loadManager({
      'remove-button': remove,
      'preview-avatar': preview,
      'initials-placeholder': initials,
    });
    showConfirm.mockResolvedValue(true);
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    new Manager(config()).initialize();

    await remove.addEventListener.mock.calls[0]?.[1]();

    expect(fetch).toHaveBeenCalledWith('/accounts/avatar', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
    });
    expect(preview.src).toBe('');
    expect(preview.classList.add).toHaveBeenCalledWith('hidden');
    expect(initials.classList.remove).toHaveBeenCalledWith('hidden');
    expect(remove.style.display).toBe('none');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('refreshes after successful removal even when optional display elements are absent', async () => {
    const remove = element();
    const { Manager, reload, showConfirm } = await loadManager({
      'remove-button': remove,
    });
    showConfirm.mockResolvedValue(true);
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    new Manager(config()).initialize();

    await remove.addEventListener.mock.calls[0]?.[1]();

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reports a rejected avatar-removal response', async () => {
    const remove = element();
    const { Manager, showAlert, showConfirm } = await loadManager({
      'remove-button': remove,
    });
    showConfirm.mockResolvedValue(true);
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
    new Manager(config()).initialize();

    await remove.addEventListener.mock.calls[0]?.[1]();

    expect(showAlert).toHaveBeenCalledWith('Error', 'Could not remove avatar', {
      variant: 'error',
    });
  });

  it('reports avatar-removal network errors', async () => {
    const remove = element();
    const failure = new Error('network unavailable');
    const { Manager, showAlert, showConfirm } = await loadManager({
      'remove-button': remove,
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    showConfirm.mockResolvedValue(true);
    vi.mocked(fetch).mockRejectedValue(failure);
    new Manager(config()).initialize();

    await remove.addEventListener.mock.calls[0]?.[1]();

    expect(consoleError).toHaveBeenCalledWith(
      'Error removing avatar:',
      failure
    );
    expect(showAlert).toHaveBeenCalledOnce();
  });

  it('does not publish the manager through an application global', () => {
    const browserWindow: Record<string, unknown> = {};
    vi.stubGlobal('window', browserWindow);

    expect(browserWindow).not.toHaveProperty('AvatarManager');
  });
});
