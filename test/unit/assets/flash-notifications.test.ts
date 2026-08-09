import { afterEach, describe, expect, it, vi } from 'vitest';

type NotificationManagerConstructor = new () => object;

interface ToastFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  classList: { add: ReturnType<typeof vi.fn> };
  dataset: {
    timeout?: string;
    dismissible?: string;
  };
  parentNode: object | null;
  querySelector: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function toast(
  options: {
    timeout?: string;
    dismissible?: string;
    dismissButton?: { addEventListener: ReturnType<typeof vi.fn> } | null;
    progressBar?: { style: Record<string, string> } | null;
    attached?: boolean;
  } = {}
): ToastFixture {
  return {
    addEventListener: vi.fn(),
    classList: { add: vi.fn() },
    dataset: {
      timeout: options.timeout,
      dismissible: options.dismissible,
    },
    parentNode: options.attached === false ? null : {},
    querySelector: vi.fn((selector: string) =>
      selector === '.toast-dismiss'
        ? (options.dismissButton ?? null)
        : (options.progressBar ?? null)
    ),
    remove: vi.fn(),
  };
}

async function loadManager(
  options: {
    toasts?: ToastFixture[];
    errorScript?: {
      textContent: string | null;
      remove: ReturnType<typeof vi.fn>;
    } | null;
    dialog?: { showAlert: ReturnType<typeof vi.fn> };
  } = {}
) {
  vi.resetModules();
  let ready: (() => void) | undefined;
  const windowRoot: Record<string, unknown> = {};
  if (options.dialog) windowRoot.dialog = options.dialog;
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal('document', {
    addEventListener: vi.fn(
      (_name: string, listener: () => void) => (ready = listener)
    ),
    getElementById: vi.fn(() => options.errorScript ?? null),
    querySelectorAll: vi.fn(() => options.toasts ?? []),
  });

  const loaded = await import('../../../src/assets/js/flash.js');
  const Manager = loaded.NotificationManager as
    NotificationManagerConstructor | undefined;
  if (!Manager) throw new Error('NotificationManager is not exported');
  return { Manager, ready };
}

describe('flash notification manager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes an empty page on DOM readiness', async () => {
    const { ready } = await loadManager();

    expect(() => ready?.()).not.toThrow();
  });

  it('dismisses an attached manual toast after its animation', async () => {
    vi.useFakeTimers();
    const dismissButton = { addEventListener: vi.fn() };
    const target = toast({ dismissButton });
    const { Manager } = await loadManager({ toasts: [target] });
    new Manager();

    dismissButton.addEventListener.mock.calls[0]?.[1]();

    expect(target.classList.add).toHaveBeenCalledWith('dismissing');
    expect(target.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(target.remove).toHaveBeenCalledOnce();
  });

  it('ignores a detached toast that has no active timer', async () => {
    vi.useFakeTimers();
    const dismissButton = { addEventListener: vi.fn() };
    const target = toast({ dismissButton, attached: false });
    const { Manager } = await loadManager({ toasts: [target] });
    new Manager();

    dismissButton.addEventListener.mock.calls[0]?.[1]();
    await vi.runAllTimersAsync();

    expect(target.classList.add).not.toHaveBeenCalled();
  });

  it('does not remove a toast twice when it detaches during dismissal', async () => {
    vi.useFakeTimers();
    const dismissButton = { addEventListener: vi.fn() };
    const target = toast({ dismissButton });
    const { Manager } = await loadManager({ toasts: [target] });
    new Manager();

    dismissButton.addEventListener.mock.calls[0]?.[1]();
    target.parentNode = null;
    await vi.advanceTimersByTimeAsync(300);

    expect(target.remove).not.toHaveBeenCalled();
  });

  it('auto-dismisses eligible toasts and ignores disabled or zero timeouts', async () => {
    vi.useFakeTimers();
    const automatic = toast({ timeout: '500' });
    const disabled = toast({ timeout: '500', dismissible: 'false' });
    const permanent = toast({ timeout: '0' });
    const { Manager } = await loadManager({
      toasts: [automatic, disabled, permanent],
    });
    new Manager();

    await vi.advanceTimersByTimeAsync(800);

    expect(automatic.remove).toHaveBeenCalledOnce();
    expect(disabled.remove).not.toHaveBeenCalled();
    expect(permanent.remove).not.toHaveBeenCalled();
  });

  it('pauses and resumes a toast timer with its remaining duration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const progressBar = { style: {} as Record<string, string> };
    const target = toast({ timeout: '1000', progressBar });
    const { Manager } = await loadManager({ toasts: [target] });
    new Manager();
    const mouseenter = target.addEventListener.mock.calls.find(
      call => call[0] === 'mouseenter'
    )?.[1] as () => void;
    const mouseleave = target.addEventListener.mock.calls.find(
      call => call[0] === 'mouseleave'
    )?.[1] as () => void;

    vi.setSystemTime(1_400);
    mouseenter();
    mouseenter();
    expect(progressBar.style.animationPlayState).toBe('paused');

    mouseleave();
    expect(progressBar.style.animationPlayState).toBe('running');
    await vi.advanceTimersByTimeAsync(899);
    expect(target.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(target.remove).toHaveBeenCalledOnce();

    mouseleave();
  });

  it('does not resume a timer whose remaining duration has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const target = toast({ timeout: '100' });
    const { Manager } = await loadManager({ toasts: [target] });
    new Manager();
    const mouseenter = target.addEventListener.mock.calls[0]?.[1] as () => void;
    const mouseleave = target.addEventListener.mock.calls[1]?.[1] as () => void;

    vi.setSystemTime(1_200);
    mouseenter();
    mouseleave();

    expect(target.remove).not.toHaveBeenCalled();
  });

  it('handles timer controls when no progress bar exists', async () => {
    vi.useFakeTimers();
    const target = toast({ timeout: '1000' });
    const { Manager } = await loadManager({ toasts: [target] });
    new Manager();
    const mouseenter = target.addEventListener.mock.calls[0]?.[1] as () => void;
    const mouseleave = target.addEventListener.mock.calls[1]?.[1] as () => void;

    mouseenter();
    mouseleave();

    expect(target.querySelector).toHaveBeenCalledWith('.toast-progress-bar');
  });

  it('displays serialized errors sequentially with default and custom titles', async () => {
    const order: string[] = [];
    const showAlert = vi.fn(async (title: string) => {
      order.push(title);
    });
    const errorScript = {
      textContent: JSON.stringify([
        { type: 'error', message: 'First failure' },
        { type: 'error', title: 'Custom', message: 'Second failure' },
      ]),
      remove: vi.fn(),
    };
    const { Manager } = await loadManager({
      dialog: { showAlert },
      errorScript,
    });

    new Manager();
    await vi.waitFor(() => expect(showAlert).toHaveBeenCalledTimes(2));

    expect(errorScript.remove).toHaveBeenCalledOnce();
    expect(order).toEqual(['Error', 'Custom']);
    expect(showAlert).toHaveBeenNthCalledWith(1, 'Error', 'First failure', {
      variant: 'error',
      buttonText: 'OK',
    });
  });

  it('falls back to console errors when the dialog utility is unavailable', async () => {
    const errorScript = {
      textContent: JSON.stringify([
        { type: 'error', message: 'Default title' },
        { type: 'error', title: 'Named', message: 'Named error' },
      ]),
      remove: vi.fn(),
    };
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { Manager } = await loadManager({ errorScript });

    new Manager();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(3));

    expect(consoleError).toHaveBeenCalledWith('[Error] Error: Default title');
    expect(consoleError).toHaveBeenCalledWith('[Error] Named: Named error');
  });

  it.each([
    ['malformed', '{'],
    ['blank', null],
  ])('handles %s serialized error data', async (_name, textContent) => {
    const errorScript = { textContent, remove: vi.fn() };
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { Manager } = await loadManager({ errorScript });

    new Manager();
    if (textContent === null) {
      await Promise.resolve();
      expect(consoleError).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    }
    expect(errorScript.remove).toHaveBeenCalledTimes(
      textContent === null ? 1 : 0
    );
  });

  it('can be imported outside a browser document', async () => {
    vi.resetModules();
    vi.stubGlobal('document', undefined);

    const loaded = await import('../../../src/assets/js/flash.js');

    expect(loaded.NotificationManager).toEqual(expect.any(Function));
  });
});
