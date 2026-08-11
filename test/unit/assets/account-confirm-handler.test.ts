import { afterEach, describe, expect, it, vi } from 'vitest';

interface ConfirmUtilities {
  handleConfirmAction(
    button: ButtonFixture,
    translations: Record<string, string>
  ): Promise<boolean>;
  setupConfirmationHandlers(
    translations: Record<string, string>,
    debug?: boolean
  ): void;
}

interface ButtonFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  dataset: Record<string, string | undefined>;
  form: { submit: ReturnType<typeof vi.fn> } | null;
}

function button(overrides: Partial<ButtonFixture> = {}): ButtonFixture {
  return {
    addEventListener: vi.fn(),
    dataset: {},
    form: { submit: vi.fn() },
    ...overrides,
  };
}

async function loadUtilities(buttons: ButtonFixture[] = []) {
  vi.resetModules();
  const showConfirm = vi.fn();
  const windowRoot: {
    accountSettingsUtils?: ConfirmUtilities;
    dialog: object;
  } = {
    dialog: { showConfirm },
  };
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal('document', {
    querySelectorAll: vi.fn(() => buttons),
  });

  await import('../../../src/assets/js/account/settings/confirm-handler.js');

  if (!windowRoot.accountSettingsUtils) {
    throw new Error('Confirmation utilities were not published');
  }
  return { showConfirm, utilities: windowRoot.accountSettingsUtils };
}

describe('account settings confirmation handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses safe defaults when no translated confirmation is configured', async () => {
    const { showConfirm, utilities } = await loadUtilities();
    showConfirm.mockResolvedValue(true);

    await expect(utilities.handleConfirmAction(button(), {})).resolves.toBe(
      true
    );

    expect(showConfirm).toHaveBeenCalledWith(
      'Confirm Action',
      'Are you sure?',
      { variant: 'warning', confirmText: 'Confirm', cancelText: 'Cancel' }
    );
  });

  it('uses translated values and interpolates every provider placeholder', async () => {
    const { showConfirm, utilities } = await loadUtilities();
    showConfirm.mockResolvedValue(false);
    const target = button({
      dataset: {
        confirmTitle: 'Disconnect provider',
        confirmMessageKey: 'disconnect',
        confirmProvider: 'GitHub',
        confirmVariant: 'danger',
      },
    });

    await expect(
      utilities.handleConfirmAction(target, {
        disconnect: 'Disconnect {{provider}} from {{provider}}?',
      })
    ).resolves.toBe(false);

    expect(showConfirm).toHaveBeenCalledWith(
      'Disconnect provider',
      'Disconnect GitHub from GitHub?',
      { variant: 'danger', confirmText: 'Confirm', cancelText: 'Cancel' }
    );
  });

  it('leaves translated messages without interpolation markers unchanged', async () => {
    const { showConfirm, utilities } = await loadUtilities();
    showConfirm.mockResolvedValue(true);

    await utilities.handleConfirmAction(
      button({
        dataset: {
          confirmMessageKey: 'remove',
          confirmProvider: 'GitHub',
        },
      }),
      { remove: 'Remove this connection?' }
    );

    expect(showConfirm).toHaveBeenCalledWith(
      'Confirm Action',
      'Remove this connection?',
      expect.any(Object)
    );
  });

  it('submits a confirmed form and prevents the triggering click', async () => {
    const target = button();
    const { showConfirm, utilities } = await loadUtilities([target]);
    showConfirm.mockResolvedValue(true);
    utilities.setupConfirmationHandlers({}, false);
    const click = target.addEventListener.mock.calls[0]?.[1] as (
      event: Event
    ) => Promise<void>;
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Event;

    await click(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(target.form?.submit).toHaveBeenCalledOnce();
  });

  it('logs debug outcomes for confirmed and cancelled actions', async () => {
    const confirmed = button();
    const cancelled = button();
    const { showConfirm, utilities } = await loadUtilities([
      confirmed,
      cancelled,
    ]);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    showConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    utilities.setupConfirmationHandlers({}, true);
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Event;

    await confirmed.addEventListener.mock.calls[0]?.[1](event);
    await cancelled.addEventListener.mock.calls[0]?.[1](event);

    expect(consoleLog).toHaveBeenCalledWith(
      '[ConfirmHandler] User confirmed, submitting form'
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '[ConfirmHandler] User cancelled action'
    );
  });

  it('handles confirmation when the button is not associated with a form', async () => {
    const target = button({ form: null });
    const { showConfirm, utilities } = await loadUtilities([target]);
    showConfirm.mockResolvedValue(true);
    utilities.setupConfirmationHandlers({}, true);

    await target.addEventListener.mock.calls[0]?.[1]({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    expect(showConfirm).toHaveBeenCalledOnce();
  });

  it('leaves the form untouched when cancellation is not in debug mode', async () => {
    const target = button();
    const { showConfirm, utilities } = await loadUtilities([target]);
    showConfirm.mockResolvedValue(false);
    utilities.setupConfirmationHandlers({}, false);

    await target.addEventListener.mock.calls[0]?.[1]({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    expect(target.form?.submit).not.toHaveBeenCalled();
  });

  it('does not require a window global when evaluated outside a browser', async () => {
    vi.stubGlobal('window', undefined);
    vi.resetModules();

    await expect(
      import('../../../src/assets/js/account/settings/confirm-handler.js')
    ).resolves.toBeDefined();
  });
});
