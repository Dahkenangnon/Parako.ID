import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  initializeRecoveryCodesPage,
  RecoveryCodesManager,
  type RecoveryCodesConfig,
} from '../../../src/assets/js/account/recovery-codes.js';
import dialogService from '../../../src/assets/js/utils/dialog.js';

interface ElementFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  disabled: boolean;
  download: string;
  href: string;
  innerHTML: string;
  select: ReturnType<typeof vi.fn>;
  style: Record<string, string>;
  value: string;
}

function element(overrides: Partial<ElementFixture> = {}): ElementFixture {
  return {
    addEventListener: vi.fn(),
    click: vi.fn(),
    disabled: false,
    download: '',
    href: '',
    innerHTML: '',
    select: vi.fn(),
    style: {},
    value: '',
    ...overrides,
  };
}

function config(
  overrides: Partial<RecoveryCodesConfig> = {}
): RecoveryCodesConfig {
  return {
    codes: ['alpha', 'bravo'],
    translations: {
      fileContentTitle: 'Backup codes',
      fileContentGenerated: 'Generated',
      fileContentImportant: 'Store these securely',
      fileContentTotalCodes: 'Total',
      downloadedFeedback: 'Downloaded',
      copiedFeedback: 'Copied',
      copyFailedError: 'Could not copy the codes',
    },
    ...overrides,
  };
}

function loadManager(
  options: {
    copyButton?: ElementFixture | null;
    downloadButton?: ElementFixture | null;
    clipboard?: { writeText: ReturnType<typeof vi.fn> };
    execCommand?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const created: ElementFixture[] = [];
  const appended: ElementFixture[] = [];
  const removed: ElementFixture[] = [];
  const showAlert = vi
    .spyOn(dialogService, 'showAlert')
    .mockResolvedValue(undefined);
  const execCommand = options.execCommand ?? vi.fn(() => true);
  const documentRoot = {
    addEventListener: vi.fn(),
    body: {
      appendChild: vi.fn((node: ElementFixture) => appended.push(node)),
      removeChild: vi.fn((node: ElementFixture) => removed.push(node)),
    },
    createElement: vi.fn(() => {
      const node = element();
      created.push(node);
      return node;
    }),
    execCommand,
    getElementById: vi.fn((id: string) => {
      if (id === 'copy-all-codes') return options.copyButton ?? null;
      if (id === 'download-codes') return options.downloadButton ?? null;
      return null;
    }),
  };
  vi.stubGlobal('document', documentRoot);
  vi.stubGlobal('navigator', { clipboard: options.clipboard });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovery-codes');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  const Manager = RecoveryCodesManager;
  return {
    Manager,
    appended,
    created,
    documentRoot,
    execCommand,
    removed,
    showAlert,
  };
}

describe('account recovery codes manager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes an empty page and logs only in debug mode', async () => {
    const { Manager } = loadManager();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    new Manager(config()).initialize();
    new Manager(config({ debug: true })).initialize();

    expect(consoleLog).toHaveBeenCalledOnce();
    expect(consoleLog).toHaveBeenCalledWith(
      '[RecoveryCodesManager]',
      'Initializing RecoveryCodesManager with',
      2,
      'codes'
    );
  });

  it('downloads a formatted text file and restores button feedback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:34:56.000Z'));
    const downloadButton = element({ disabled: true, innerHTML: 'Download' });
    const { Manager, appended, created, removed } = loadManager({
      downloadButton,
    });
    new Manager(config({ debug: true })).initialize();
    const click = downloadButton.addEventListener.mock
      .calls[0]?.[1] as () => void;

    click();

    const anchor = created[0];
    expect(anchor?.href).toBe('blob:recovery-codes');
    expect(anchor?.download).toBe('backup-codes-2026-08-03.txt');
    expect(anchor?.click).toHaveBeenCalledOnce();
    expect(appended).toEqual([anchor]);
    expect(removed).toEqual([anchor]);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recovery-codes');
    expect(downloadButton.innerHTML).toBe('Downloaded');
    expect(downloadButton.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(downloadButton.innerHTML).toBe('Download');
    expect(downloadButton.disabled).toBe(true);
  });

  it('copies codes with the secure Clipboard API and restores feedback', async () => {
    vi.useFakeTimers();
    const copyButton = element({ innerHTML: 'Copy' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { Manager } = loadManager({
      copyButton,
      clipboard: { writeText },
    });
    new Manager(config()).initialize();
    const click = copyButton.addEventListener.mock
      .calls[0]?.[1] as () => Promise<void>;

    await click();

    expect(writeText).toHaveBeenCalledWith('alpha\nbravo');
    expect(copyButton.innerHTML).toBe('Copied');
    expect(copyButton.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(copyButton.innerHTML).toBe('Copy');
    expect(copyButton.disabled).toBe(false);
  });

  it('uses the legacy clipboard fallback when the Clipboard API is unavailable', async () => {
    const copyButton = element();
    const { Manager, appended, created, execCommand, removed } = loadManager({
      copyButton,
    });
    new Manager(config()).initialize();

    await copyButton.addEventListener.mock.calls[0]?.[1]();

    const textarea = created[0];
    expect(textarea?.value).toBe('alpha\nbravo');
    expect(textarea?.style).toMatchObject({
      position: 'fixed',
      left: '-9999px',
      top: '-9999px',
    });
    expect(textarea?.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(appended).toEqual([textarea]);
    expect(removed).toEqual([textarea]);
  });

  it('reports a failed legacy clipboard copy instead of false success', async () => {
    const copyButton = element();
    const execCommand = vi.fn(() => false);
    const { Manager, showAlert } = loadManager({
      copyButton,
      execCommand,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    new Manager(config()).initialize();

    await copyButton.addEventListener.mock.calls[0]?.[1]();

    expect(showAlert).toHaveBeenCalledWith(
      'Copy Failed',
      'Could not copy the codes',
      { variant: 'error' }
    );
    expect(copyButton.innerHTML).not.toBe('Copied');
  });

  it('reports Clipboard API rejection through the application dialog', async () => {
    const copyButton = element();
    const failure = new Error('clipboard denied');
    const { Manager, showAlert } = loadManager({
      copyButton,
      clipboard: { writeText: vi.fn().mockRejectedValue(failure) },
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    new Manager(config()).initialize();

    await copyButton.addEventListener.mock.calls[0]?.[1]();

    expect(consoleError).toHaveBeenCalledWith('Failed to copy codes:', failure);
    expect(showAlert).toHaveBeenCalledOnce();
  });

  it('auto-initializes from DOM codes rather than JSON code state', async () => {
    const copyButton = element();
    const codeElements = [
      { getAttribute: vi.fn(() => 'first') },
      { getAttribute: vi.fn(() => null) },
      { getAttribute: vi.fn(() => 'second') },
    ];
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      getElementById: vi.fn((id: string) => {
        if (id === '___RECOVERY_CODES_STATE___') {
          return {
            textContent: JSON.stringify(config({ codes: ['injected'] })),
          };
        }
        if (id === 'recovery-codes-data') {
          return { querySelectorAll: vi.fn(() => codeElements) };
        }
        if (id === 'copy-all-codes') return copyButton;
        return null;
      }),
    });
    initializeRecoveryCodesPage();
    await copyButton.addEventListener.mock.calls[0]?.[1]();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('first\nsecond');
  });

  it.each([
    ['missing configuration', null, undefined],
    ['malformed configuration', { textContent: '{' }, undefined],
    ['blank configuration', { textContent: null }, undefined],
    [
      'missing codes',
      { textContent: JSON.stringify(config({ codes: [] })) },
      null,
    ],
    [
      'empty DOM codes',
      { textContent: JSON.stringify(config({ codes: ['injected'] })) },
      { querySelectorAll: vi.fn(() => []) },
    ],
  ])('rejects %s during auto-initialization', async (_name, state, codes) => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      getElementById: vi.fn((id: string) =>
        id === '___RECOVERY_CODES_STATE___' ? state : codes
      ),
    });
    initializeRecoveryCodesPage();

    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('is statically importable outside a browser document', () => {
    expect(RecoveryCodesManager).toEqual(expect.any(Function));
  });
});
