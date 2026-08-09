import { afterEach, describe, expect, it, vi } from 'vitest';

interface ModalFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  click?: (event: { target: unknown }) => void;
}

interface DaysFixture {
  value: string;
}

interface FormFixture {
  action: string;
  appendChild: ReturnType<typeof vi.fn>;
  method: string;
  submit: ReturnType<typeof vi.fn>;
}

interface MetaFixture {
  getAttribute: ReturnType<typeof vi.fn>;
}

function makeModal(): ModalFixture {
  const modal: ModalFixture = {
    addEventListener: vi.fn(
      (_name: string, listener: (event: { target: unknown }) => void) => {
        modal.click = listener;
      }
    ),
    classList: { add: vi.fn(), remove: vi.fn() },
  };
  return modal;
}

function setupDom(
  options: {
    csrfInput?: { value: string } | null;
    csrfMeta?: MetaFixture | null;
    days?: DaysFixture | null;
    modal?: ModalFixture | null;
    stateText?: string | null;
  } = {}
) {
  const listeners = new Map<string, (event?: unknown) => void>();
  const browserWindow: Record<string, unknown> = {};
  const form: FormFixture = {
    action: '',
    appendChild: vi.fn(),
    method: '',
    submit: vi.fn(),
  };
  const inputs: Array<{ name: string; type: string; value: string }> = [];
  const appendChild = vi.fn();
  const createElement = vi.fn((tagName: string) => {
    if (tagName === 'form') return form;
    const input = { name: '', type: '', value: '' };
    inputs.push(input);
    return input;
  });
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    body: { appendChild },
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      listeners.set(_name, listener as (event?: unknown) => void);
    }),
    createElement,
    getElementById: vi.fn((id: string) =>
      id === 'clearOldModal'
        ? (options.modal ?? null)
        : id === 'days'
          ? (options.days ?? null)
          : id === '___ADMIN_ACTIVITIES_STATE___' &&
              options.stateText !== undefined
            ? { textContent: options.stateText }
            : null
    ),
    querySelector: vi.fn((selector: string) =>
      selector === 'input[name="_csrf"]'
        ? (options.csrfInput ?? null)
        : selector === 'meta[name="csrf-token"]'
          ? (options.csrfMeta ?? null)
          : null
    ),
  });
  return {
    appendChild,
    browserWindow,
    createElement,
    dispatch: (name: string, event?: unknown) => listeners.get(name)?.(event),
    form,
    inputs,
    runReady: () => listeners.get('DOMContentLoaded')?.(),
  };
}

describe('admin activities manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/activities/index.js')
    ).resolves.toBeDefined();
  });

  it('initializes with defaults when optional page elements are absent', async () => {
    const { browserWindow, createElement, dispatch, runReady } = setupDom();
    await import('../../../src/assets/js/admin/activities/index.js');

    expect(runReady).not.toThrow();
    expect(browserWindow).toMatchObject({
      AdminActivitiesManager: expect.any(Function),
      clearOldActivities: expect.any(Function),
      hideClearOldModal: expect.any(Function),
      showClearOldModal: expect.any(Function),
    });
    expect(() =>
      (browserWindow.clearOldActivities as () => void)()
    ).not.toThrow();
    expect(() => {
      (browserWindow.showClearOldModal as () => void)();
      (browserWindow.hideClearOldModal as () => void)();
      dispatch('keydown', { key: 'Enter' });
    }).not.toThrow();
    expect(createElement).not.toHaveBeenCalled();
  });

  it('opens and closes the clear-old modal from every supported control', async () => {
    const modal = makeModal();
    const { browserWindow, dispatch, runReady } = setupDom({ modal });
    await import('../../../src/assets/js/admin/activities/index.js');
    runReady();

    (browserWindow.showClearOldModal as () => void)();
    expect(modal.classList.remove).toHaveBeenCalledWith('hidden');

    (browserWindow.hideClearOldModal as () => void)();
    dispatch('keydown', { key: 'Escape' });
    modal.click?.({ target: modal });
    modal.click?.({ target: {} });

    expect(modal.classList.add).toHaveBeenCalledTimes(3);
    expect(modal.classList.add).toHaveBeenCalledWith('hidden');
  });

  it.each(['', '0', '-1', '1.5', '1 day', '9007199254740992'])(
    'rejects invalid retention days %j instead of coercing them',
    async value => {
      const alert = vi.fn();
      vi.stubGlobal('alert', alert);
      const { browserWindow, createElement, runReady } = setupDom({
        days: { value },
      });
      await import('../../../src/assets/js/admin/activities/index.js');
      runReady();

      (browserWindow.clearOldActivities as () => void)();

      expect(alert).toHaveBeenCalledWith('Please enter a valid number of days');
      expect(createElement).not.toHaveBeenCalled();
    }
  );

  it('submits valid whole days to the configured route with the page CSRF token', async () => {
    const { appendChild, browserWindow, form, inputs, runReady } = setupDom({
      csrfInput: { value: 'page-csrf' },
      days: { value: ' 30 ' },
      stateText: JSON.stringify({
        csrfToken: 'configured-csrf',
        routes: { clearOld: '/custom/clear-old' },
        translations: { invalidDays: 'Choose whole days' },
      }),
    });
    await import('../../../src/assets/js/admin/activities/index.js');
    runReady();

    (browserWindow.clearOldActivities as () => void)();

    expect(form).toMatchObject({
      action: '/custom/clear-old',
      method: 'POST',
    });
    expect(inputs).toEqual([
      { name: 'days', type: 'hidden', value: '30' },
      { name: '_csrf', type: 'hidden', value: 'page-csrf' },
    ]);
    expect(form.appendChild).toHaveBeenCalledTimes(2);
    expect(appendChild).toHaveBeenCalledWith(form);
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('falls back to the configured CSRF token when the meta token is empty', async () => {
    const csrfMeta = { getAttribute: vi.fn(() => null) };
    const { browserWindow, inputs, runReady } = setupDom({
      csrfMeta,
      days: { value: '7' },
      stateText: JSON.stringify({
        csrfToken: 'configured-csrf',
        routes: { clearOld: '/admin/activities/clear-old' },
        translations: {},
      }),
    });
    await import('../../../src/assets/js/admin/activities/index.js');
    runReady();

    (browserWindow.clearOldActivities as () => void)();

    expect(csrfMeta.getAttribute).toHaveBeenCalledWith('content');
    expect(inputs[1]?.value).toBe('configured-csrf');
  });

  it('uses the meta CSRF token when the hidden token is empty', async () => {
    const csrfMeta = { getAttribute: vi.fn(() => 'meta-csrf') };
    const { browserWindow, inputs, runReady } = setupDom({
      csrfInput: { value: '' },
      csrfMeta,
      days: { value: '7' },
    });
    await import('../../../src/assets/js/admin/activities/index.js');
    runReady();

    (browserWindow.clearOldActivities as () => void)();

    expect(inputs[1]?.value).toBe('meta-csrf');
  });

  it('uses the safe route fallback and an empty token when no CSRF source exists', async () => {
    const { browserWindow, form, inputs, runReady } = setupDom({
      days: { value: '1' },
      stateText: JSON.stringify({
        csrfToken: '',
        routes: { clearOld: '' },
        translations: {},
      }),
    });
    await import('../../../src/assets/js/admin/activities/index.js');
    runReady();

    (browserWindow.clearOldActivities as () => void)();

    expect(form.action).toBe('/admin/activities/clear-old');
    expect(inputs[1]?.value).toBe('');
  });

  it('logs malformed persisted state and initializes with safe defaults', async () => {
    const alert = vi.fn();
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.stubGlobal('alert', alert);
    const { browserWindow, runReady } = setupDom({
      days: { value: 'invalid' },
      stateText: '{bad json',
    });
    await import('../../../src/assets/js/admin/activities/index.js');

    expect(runReady).not.toThrow();
    (browserWindow.clearOldActivities as () => void)();

    expect(error).toHaveBeenCalledWith(
      '[AdminActivitiesManager] Initialization failed:',
      expect.any(SyntaxError)
    );
    expect(alert).toHaveBeenCalledWith('Please enter a valid number of days');
  });

  it('uses defaults when the persisted state element is blank', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { browserWindow, runReady } = setupDom({
      days: { value: 'invalid' },
      stateText: '',
    });
    await import('../../../src/assets/js/admin/activities/index.js');
    runReady();

    (browserWindow.clearOldActivities as () => void)();

    expect(alert).toHaveBeenCalledWith('Please enter a valid number of days');
  });

  it('initializes in a document-only environment without exporting globals', async () => {
    const { runReady } = setupDom();
    vi.stubGlobal('window', undefined);

    await expect(
      import('../../../src/assets/js/admin/activities/index.js')
    ).resolves.toBeDefined();
    expect(runReady).not.toThrow();
  });
});
