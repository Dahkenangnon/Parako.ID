import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  initializeUserDataManagementPage,
  UserDataManagementManager,
} from '../../../src/assets/js/admin/users/data-mgmt.js';

interface TestFile {
  name: string;
  size: number;
  type: string;
}

interface DomEvent {
  preventDefault: ReturnType<typeof vi.fn>;
  target: unknown;
}

class ControlFixture {
  public checked = false;
  public readonly classList = { toggle: vi.fn() };
  public readonly dataset: Record<string, string> = {};
  public disabled = false;
  public files: TestFile[] | undefined;
  public innerHTML = '';
  public closestResult: {
    querySelector: (selector: string) => { textContent: string } | null;
  } | null = null;
  public readonly closest = vi.fn(() => this.closestResult);
  public readonly setAttribute = vi.fn();
  public readonly submit = vi.fn();
  public value = '';
  private readonly listeners = new Map<
    string,
    Array<(event: DomEvent) => void | Promise<void>>
  >();

  constructor(public id = '') {}

  public addEventListener(
    name: string,
    listener: (event: DomEvent) => void | Promise<void>
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public async trigger(
    name: string,
    event: DomEvent = { preventDefault: vi.fn(), target: this }
  ): Promise<DomEvent> {
    for (const listener of this.listeners.get(name) ?? []) {
      await listener(event);
    }
    return event;
  }
}

function setupDom(
  options: {
    confirmed?: boolean;
    controls?: Record<string, ControlFixture | null>;
    lucide?: boolean;
    panels?: ControlFixture[];
    tabs?: ControlFixture[];
  } = {}
) {
  const showAlert = vi.fn().mockResolvedValue(undefined);
  const showConfirm = vi.fn().mockResolvedValue(options.confirmed ?? false);
  const createIcons = vi.fn();
  vi.stubGlobal('window', {
    lucide: options.lucide === false ? undefined : { createIcons },
  });
  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => options.controls?.[id] ?? null),
    querySelectorAll: vi.fn((selector: string) =>
      selector === '.data-tab-btn'
        ? (options.tabs ?? [])
        : (options.panels ?? [])
    ),
  });
  return {
    createIcons,
    runReady: () =>
      initializeUserDataManagementPage({ showAlert, showConfirm }),
    showAlert,
    showConfirm,
  };
}

describe('admin user data management', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is statically importable without a browser document', () => {
    expect(UserDataManagementManager).toBeTypeOf('function');
  });

  it('initializes safely when all optional page controls are absent', async () => {
    const { runReady } = setupDom();

    expect(runReady).not.toThrow();
  });

  it('switches tab accessibility and panel visibility while ignoring unbound tabs', async () => {
    const importTab = new ControlFixture();
    importTab.dataset.tab = 'import';
    const exportTab = new ControlFixture();
    exportTab.dataset.tab = 'export';
    const unboundTab = new ControlFixture();
    const importPanel = new ControlFixture('import-panel');
    const exportPanel = new ControlFixture('export-panel');
    const { runReady } = setupDom({
      panels: [importPanel, exportPanel],
      tabs: [importTab, exportTab, unboundTab],
    });
    runReady();

    await unboundTab.trigger('click');
    expect(importTab.setAttribute).not.toHaveBeenCalled();

    await importTab.trigger('click');

    expect(importTab.setAttribute).toHaveBeenCalledWith(
      'aria-selected',
      'true'
    );
    expect(exportTab.setAttribute).toHaveBeenCalledWith(
      'aria-selected',
      'false'
    );
    expect(importTab.classList.toggle).toHaveBeenCalledWith(
      'border-primary',
      true
    );
    expect(exportTab.classList.toggle).toHaveBeenCalledWith(
      'border-transparent',
      true
    );
    expect(importPanel.classList.toggle).toHaveBeenCalledWith('hidden', false);
    expect(exportPanel.classList.toggle).toHaveBeenCalledWith('hidden', true);
  });

  it('ignores an empty file selection', async () => {
    const csvFile = new ControlFixture();
    csvFile.files = [];
    const { runReady, showAlert } = setupDom({
      controls: { csvFile },
    });
    runReady();

    await csvFile.trigger('change');

    expect(showAlert).not.toHaveBeenCalled();
    expect(csvFile.value).toBe('');
  });

  it('rejects a CSV file larger than ten megabytes and clears the selection', async () => {
    const csvFile = new ControlFixture();
    csvFile.files = [
      { name: 'users.csv', size: 10 * 1024 * 1024 + 1, type: 'text/csv' },
    ];
    csvFile.value = 'users.csv';
    const { runReady, showAlert } = setupDom({ controls: { csvFile } });
    runReady();

    await csvFile.trigger('change');

    expect(showAlert).toHaveBeenCalledWith(
      'File Too Large',
      expect.stringContaining('Maximum file size is 10MB.'),
      { variant: 'error' }
    );
    expect(csvFile.value).toBe('');
  });

  it('rejects a file that has neither a CSV extension nor CSV media type', async () => {
    const csvFile = new ControlFixture();
    csvFile.files = [{ name: 'users.txt', size: 1024, type: 'text/plain' }];
    csvFile.value = 'users.txt';
    const { runReady, showAlert } = setupDom({ controls: { csvFile } });
    runReady();

    await csvFile.trigger('change');

    expect(showAlert).toHaveBeenCalledWith(
      'Invalid File Type',
      'Please select a CSV file.\nAccepted: .csv files only',
      { variant: 'error' }
    );
    expect(csvFile.value).toBe('');
  });

  it.each([
    { name: 'USERS.CSV', type: 'application/octet-stream' },
    { name: 'users.data', type: 'text/csv' },
  ])('accepts a CSV selected by extension or media type: $name', async file => {
    const csvFile = new ControlFixture();
    csvFile.files = [{ ...file, size: 1024 }];
    csvFile.value = file.name;
    const { runReady, showAlert } = setupDom({ controls: { csvFile } });
    runReady();

    await csvFile.trigger('change');

    expect(showAlert).not.toHaveBeenCalled();
    expect(csvFile.value).toBe(file.name);
  });

  it('blocks an import submission when no file is selected', async () => {
    const csvFile = new ControlFixture();
    csvFile.files = [];
    const importForm = new ControlFixture();
    const { runReady, showAlert } = setupDom({
      controls: { csvFile, importForm },
    });
    runReady();

    const event = await importForm.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'No File Selected',
      'Please select a CSV file to import.',
      { variant: 'warning' }
    );
  });

  it('blocks an import submission when the selected file is oversized', async () => {
    const csvFile = new ControlFixture();
    csvFile.files = [
      { name: 'users.csv', size: 10 * 1024 * 1024 + 1, type: 'text/csv' },
    ];
    const importForm = new ControlFixture();
    const { runReady, showAlert } = setupDom({
      controls: { csvFile, importForm },
    });
    runReady();

    const event = await importForm.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'File Too Large',
      'Maximum file size is 10MB.',
      { variant: 'error' }
    );
  });

  it('allows a valid import and shows its loading state', async () => {
    const csvFile = new ControlFixture();
    csvFile.files = [{ name: 'users.csv', size: 1024, type: 'text/csv' }];
    const importBtn = new ControlFixture();
    const importForm = new ControlFixture();
    const { runReady, showAlert } = setupDom({
      controls: { csvFile, importBtn, importForm },
    });
    runReady();

    const event = await importForm.trigger('submit');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(showAlert).not.toHaveBeenCalled();
    expect(importBtn.disabled).toBe(true);
    expect(importBtn.innerHTML).toContain('animate-spin');
    expect(importBtn.innerHTML).toContain('Importing...');
  });

  it('allows a valid import when its optional submit button is absent', async () => {
    const csvFile = new ControlFixture();
    csvFile.files = [{ name: 'users.csv', size: 1024, type: 'text/csv' }];
    const importForm = new ControlFixture();
    const { runReady } = setupDom({ controls: { csvFile, importForm } });
    runReady();

    const event = await importForm.trigger('submit');

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('shows and then clears the export loading state after download starts', async () => {
    vi.useFakeTimers();
    const exportBtn = new ControlFixture();
    const exportForm = new ControlFixture();
    const { createIcons, runReady, showConfirm } = setupDom({
      controls: { exportBtn, exportForm },
    });
    runReady();

    const event = await exportForm.trigger('submit');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(showConfirm).not.toHaveBeenCalled();
    expect(exportBtn.disabled).toBe(true);
    expect(exportBtn.innerHTML).toContain('Exporting...');

    await vi.advanceTimersByTimeAsync(2000);

    expect(exportBtn.disabled).toBe(false);
    expect(exportBtn.innerHTML).toContain('Export to CSV');
    expect(createIcons).toHaveBeenCalledOnce();
  });

  it('allows an ordinary export when its optional button is absent', async () => {
    const exportForm = new ControlFixture();
    const { runReady } = setupDom({ controls: { exportForm } });
    runReady();

    const event = await exportForm.trigger('submit');

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('restores an ordinary export without requiring the optional icon library', async () => {
    vi.useFakeTimers();
    const exportBtn = new ControlFixture();
    const exportForm = new ControlFixture();
    const { createIcons, runReady } = setupDom({
      controls: { exportBtn, exportForm },
      lucide: false,
    });
    runReady();

    await exportForm.trigger('submit');
    await vi.advanceTimersByTimeAsync(2000);

    expect(exportBtn.disabled).toBe(false);
    expect(createIcons).not.toHaveBeenCalled();
  });

  it('cancels a password export after presenting its security warning', async () => {
    const exportForm = new ControlFixture();
    const includePasswords = new ControlFixture();
    includePasswords.checked = true;
    const { runReady, showConfirm } = setupDom({
      controls: { exportForm, includePasswords },
    });
    runReady();

    const event = await exportForm.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showConfirm).toHaveBeenCalledWith(
      'Sensitive Data Export',
      expect.stringContaining('- Password hashes (encrypted)'),
      {
        variant: 'warning',
        confirmText: 'Export',
        cancelText: 'Cancel',
      }
    );
    expect(exportForm.submit).not.toHaveBeenCalled();
  });

  it('submits a confirmed export containing all selected sensitive data', async () => {
    const exportForm = new ControlFixture();
    const includePasswords = new ControlFixture();
    includePasswords.checked = true;
    const includeSensitiveData = new ControlFixture();
    includeSensitiveData.checked = true;
    const { runReady, showConfirm } = setupDom({
      confirmed: true,
      controls: { exportForm, includePasswords, includeSensitiveData },
    });
    runReady();

    const event = await exportForm.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    const message = showConfirm.mock.calls[0]?.[1] as string;
    expect(message).toContain('- Password hashes (encrypted)');
    expect(message).toContain('- Personal information (phone, address, etc.)');
    expect(exportForm.submit).toHaveBeenCalledOnce();
  });

  it('describes personal information when it is the only sensitive export option', async () => {
    const exportForm = new ControlFixture();
    const includeSensitiveData = new ControlFixture();
    includeSensitiveData.checked = true;
    const { runReady, showConfirm } = setupDom({
      controls: { exportForm, includeSensitiveData },
    });
    runReady();

    await exportForm.trigger('submit');

    const message = showConfirm.mock.calls[0]?.[1] as string;
    expect(message).not.toContain('Password hashes');
    expect(message).toContain('- Personal information (phone, address, etc.)');
  });

  it('cancels clearing import errors and reports the visible error count', async () => {
    const clearLogForm = new ControlFixture();
    clearLogForm.closestResult = {
      querySelector: vi.fn(() => ({ textContent: '3 errors' })),
    };
    const { runReady, showConfirm } = setupDom({
      controls: { 'clear-log-form': clearLogForm },
    });
    runReady();

    const event = await clearLogForm.trigger('submit');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showConfirm).toHaveBeenCalledWith(
      'Clear All Import Errors',
      expect.stringContaining('remove 3 errors error logs'),
      {
        variant: 'danger',
        confirmText: 'Clear All',
        cancelText: 'Cancel',
      }
    );
    expect(clearLogForm.submit).not.toHaveBeenCalled();
  });

  it('submits confirmed log clearing and falls back when no count is visible', async () => {
    const clearLogForm = new ControlFixture();
    const { runReady, showConfirm } = setupDom({
      confirmed: true,
      controls: { 'clear-log-form': clearLogForm },
    });
    runReady();

    await clearLogForm.trigger('submit');

    expect(showConfirm.mock.calls[0]?.[1]).toContain('remove all error logs');
    expect(clearLogForm.submit).toHaveBeenCalledOnce();
  });
});
