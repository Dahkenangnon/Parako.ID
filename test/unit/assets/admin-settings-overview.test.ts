import { afterEach, describe, expect, it, vi } from 'vitest';

interface ElementFixture {
  action: string;
  appendChild: ReturnType<typeof vi.fn>;
  children: ElementFixture[];
  className: string;
  focus: ReturnType<typeof vi.fn>;
  getAttribute: (name: string) => string | null;
  innerHTML: string;
  method: string;
  name: string;
  onclick?: () => void;
  removeChild: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  style: { display: string };
  submit: ReturnType<typeof vi.fn>;
  textContent: string;
  type: string;
  value: string;
}

interface DocumentEventFixture {
  key?: string;
  preventDefault?: () => void;
  target?: {
    closest?: (selector: string) =>
      | {
          dataset: Record<string, string | undefined>;
        }
      | undefined;
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function makeElement(attributes: Record<string, string> = {}): ElementFixture {
  const elementAttributes = { ...attributes };
  const children: ElementFixture[] = [];
  let html = '';
  let text = '';
  const element = {
    action: '',
    appendChild: vi.fn((child: ElementFixture) => {
      children.push(child);
      return child;
    }),
    children,
    className: '',
    focus: vi.fn(),
    getAttribute: vi.fn((name: string) => elementAttributes[name] ?? null),
    method: '',
    name: '',
    onclick: undefined,
    removeChild: vi.fn((child: ElementFixture) => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      return child;
    }),
    setAttribute: vi.fn((name: string, value: string) => {
      elementAttributes[name] = value;
    }),
    style: { display: '' },
    submit: vi.fn(),
    type: '',
    value: '',
  } as Omit<ElementFixture, 'innerHTML' | 'textContent'> &
    Partial<Pick<ElementFixture, 'innerHTML' | 'textContent'>>;
  Object.defineProperties(element, {
    innerHTML: {
      get: () => html,
      set: (value: string) => {
        html = value;
      },
      enumerable: true,
    },
    textContent: {
      get: () => text,
      set: (value: string) => {
        text = value;
        html = escapeHtml(value);
      },
      enumerable: true,
    },
  });
  return element as ElementFixture;
}

async function loadOverview(
  elements: Record<string, ElementFixture>,
  windowRoot: Record<string, unknown> = {}
) {
  let ready: (() => void) | undefined;
  const listeners: Record<string, (event: DocumentEventFixture) => void> = {};
  const body = makeElement();
  vi.stubGlobal('document', {
    addEventListener: vi.fn(
      (
        name: string,
        listener: ((event: DocumentEventFixture) => void) | (() => void)
      ) => {
        if (name === 'DOMContentLoaded') ready = listener as () => void;
        else
          listeners[name] = listener as (event: DocumentEventFixture) => void;
      }
    ),
    removeEventListener: vi.fn((name: string) => {
      delete listeners[name];
    }),
    getElementById: vi.fn((id: string) => elements[id] ?? null),
    createElement: vi.fn(() => makeElement()),
    activeElement: elements.__activeElement ?? null,
    querySelector: vi.fn((selector: string) =>
      selector === 'meta[name="csrf-token"]'
        ? (elements.__csrfMeta ?? null)
        : null
    ),
    body,
  });
  vi.stubGlobal('window', windowRoot);

  await import('../../../src/assets/js/admin/settings/overview.js');
  ready?.();
  return { body, listeners, windowRoot };
}

describe('admin settings overview manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('shows an error when the health endpoint returns a non-success status', async () => {
    const section = makeElement();
    const results = makeElement();
    const badge = makeElement();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({
          status: 'healthy',
          checks: {},
          provider: 'database',
          responseTime: 1,
        }),
      })
    );
    const windowRoot: Record<string, unknown> = {};
    await loadOverview(
      {
        healthCheckSection: section,
        healthCheckResults: results,
        healthStatusBadge: badge,
      },
      windowRoot
    );

    await (windowRoot.checkHealth as () => Promise<void>)();

    expect(badge.innerHTML).toContain('Error');
    expect(results.innerHTML).toContain('Failed to perform health check');
  });

  it('toggles version history, refreshes icons, and hides health results', async () => {
    const history = makeElement();
    const toggleText = makeElement();
    const health = makeElement();
    const createIcons = vi.fn();
    const windowRoot: Record<string, unknown> = {
      lucide: { createIcons },
    };
    await loadOverview(
      {
        versionHistory: history,
        historyToggleText: toggleText,
        healthCheckSection: health,
      },
      windowRoot
    );

    (windowRoot.toggleVersionHistory as () => void)();
    expect(history.style.display).toBe('none');
    expect(toggleText.textContent).toBe('History');

    (windowRoot.toggleVersionHistory as () => void)();
    expect(history.style.display).toBe('block');
    expect(toggleText.textContent).toBe('Hide');
    expect(createIcons).toHaveBeenCalledOnce();

    (windowRoot.hideHealthCheck as () => void)();
    expect(health.style.display).toBe('none');
  });

  it('safely handles absent optional overview elements', async () => {
    const windowRoot: Record<string, unknown> = {};
    await loadOverview({}, windowRoot);

    expect(() => {
      (windowRoot.toggleVersionHistory as () => void)();
      (windowRoot.hideHealthCheck as () => void)();
    }).not.toThrow();
    await expect(
      (windowRoot.checkHealth as () => Promise<void>)()
    ).resolves.toBeUndefined();
  });

  it('supports history without label text and forms with optional CSRF metadata', async () => {
    const history = makeElement();
    const emptyMeta = makeElement();
    const elements: Record<string, ElementFixture> = {
      versionHistory: history,
      __csrfMeta: emptyMeta,
    };
    const windowRoot: Record<string, unknown> = {};
    const { body } = await loadOverview(elements, windowRoot);

    expect(() => {
      (windowRoot.toggleVersionHistory as () => void)();
      (windowRoot.toggleVersionHistory as () => void)();
    }).not.toThrow();

    const withEmptyCsrf = (windowRoot.reloadConfig as () => Promise<void>)();
    body.children.at(-1)?.children[0]?.children[2]?.children[1]?.onclick?.();
    await withEmptyCsrf;
    expect(body.children.at(-1)?.children[0]).toMatchObject({
      name: '_csrf',
      value: '',
    });

    delete elements.__csrfMeta;
    const withoutCsrf = (windowRoot.reloadConfig as () => Promise<void>)();
    body.children.at(-1)?.children[0]?.children[2]?.children[1]?.onclick?.();
    await withoutCsrf;
    expect(body.children.at(-1)?.children).toHaveLength(0);
  });

  it('submits reload and rollback forms with CSRF and supplied data', async () => {
    const meta = makeElement({ content: 'csrf-token' });
    const trigger = makeElement();
    const windowRoot: Record<string, unknown> = {};
    const { body } = await loadOverview(
      { __csrfMeta: meta, __activeElement: trigger },
      windowRoot
    );

    const reload = (windowRoot.reloadConfig as () => Promise<void>)();
    const reloadBackdrop = body.children[0];
    const reloadDialog = reloadBackdrop?.children[0];
    const reloadTitle = reloadDialog?.children[0]?.children[0];
    const reloadClose = reloadDialog?.children[0]?.children[1];
    const reloadDescription = reloadDialog?.children[1];
    const reloadCancel = reloadDialog?.children[2]?.children[0];
    const reloadConfirm = reloadDialog?.children[2]?.children[1];

    expect(reloadDialog?.getAttribute('role')).toBe('dialog');
    expect(reloadDialog?.getAttribute('aria-modal')).toBe('true');
    expect(reloadDialog?.getAttribute('aria-labelledby')).toBe(
      reloadTitle?.getAttribute('id')
    );
    expect(reloadDialog?.getAttribute('aria-describedby')).toBe(
      reloadDescription?.getAttribute('id')
    );
    expect(reloadClose?.getAttribute('aria-label')).toBe('Close');
    expect(reloadCancel?.focus).toHaveBeenCalledOnce();
    expect(reloadConfirm?.focus).not.toHaveBeenCalled();
    reloadConfirm?.onclick?.();
    await reload;
    expect(trigger.focus).toHaveBeenCalledOnce();

    const reloadForm = body.children[0];
    expect(reloadForm?.method).toBe('POST');
    expect(reloadForm?.action).toBe('/admin/settings/reload');
    expect(reloadForm?.children[0]).toMatchObject({
      type: 'hidden',
      name: '_csrf',
      value: 'csrf-token',
    });
    expect(reloadForm?.submit).toHaveBeenCalledOnce();

    const rollback = (
      windowRoot.confirmRollback as (
        versionId: string,
        versionNumber: string
      ) => Promise<void>
    )('version-id', '7');
    const rollbackBackdrop = body.children.at(-1);
    expect(
      rollbackBackdrop?.children[0]?.children[0]?.children[0]?.textContent
    ).toBe('Rollback to v7');
    rollbackBackdrop?.children[0]?.children[2]?.children[1]?.onclick?.();
    await rollback;

    const rollbackForm = body.children.at(-1);
    expect(rollbackForm?.action).toBe('/admin/settings/rollback');
    expect(rollbackForm?.children[1]).toMatchObject({
      type: 'hidden',
      name: 'versionId',
      value: 'version-id',
    });
  });

  it('supports every confirmation dismissal and export outcome', async () => {
    const location = { href: '' };
    const windowRoot: Record<string, unknown> = { location };
    const { body, listeners } = await loadOverview({}, windowRoot);

    const cancelledReload = (windowRoot.reloadConfig as () => Promise<void>)();
    body.children[0]?.children[0]?.children[2]?.children[0]?.onclick?.();
    await cancelledReload;
    expect(body.children).toHaveLength(0);

    const closedRollback = (
      windowRoot.confirmRollback as (
        id: string,
        version: string
      ) => Promise<void>
    )('ignored', '1');
    body.children[0]?.children[0]?.children[0]?.children[1]?.onclick?.();
    await closedRollback;
    expect(body.children).toHaveLength(0);

    const escapedExport = (windowRoot.exportConfig as () => Promise<void>)();
    listeners.keydown?.({ key: 'Enter' });
    expect(body.children).toHaveLength(1);
    listeners.keydown?.({ key: 'Escape' });
    await escapedExport;
    expect(location.href).toBe('');

    const confirmedExport = (windowRoot.exportConfig as () => Promise<void>)();
    body.children[0]?.children[0]?.children[2]?.children[1]?.onclick?.();
    await confirmedExport;
    expect(location.href).toBe('/admin/settings/export');
  });

  it('handles settings actions through CSP-safe data attributes', async () => {
    const location = { href: '' };
    const { body, listeners } = await loadOverview({}, { location });
    const preventDefault = vi.fn();
    const action = { dataset: { settingsAction: 'export' } };

    listeners.click?.({
      preventDefault,
      target: { closest: vi.fn().mockReturnValue(action) },
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    body.children[0]?.children[0]?.children[2]?.children[1]?.onclick?.();
    await vi.waitFor(() => {
      expect(location.href).toBe('/admin/settings/export');
    });
  });

  it('routes every supported settings action and ignores incomplete actions', async () => {
    const location = { href: '' };
    const { body, listeners } = await loadOverview({}, { location });
    const dispatch = (
      settingsAction?: string,
      extra: Record<string, string | undefined> = {}
    ) => {
      const preventDefault = vi.fn();
      listeners.click?.({
        preventDefault,
        target: settingsAction
          ? {
              closest: vi.fn().mockReturnValue({
                dataset: { settingsAction, ...extra },
              }),
            }
          : undefined,
      });
      return preventDefault;
    };

    expect(dispatch()).not.toHaveBeenCalled();
    expect(dispatch('unknown')).toHaveBeenCalledOnce();
    expect(dispatch('check-health')).toHaveBeenCalledOnce();
    expect(dispatch('toggle-history')).toHaveBeenCalledOnce();
    expect(dispatch('hide-health')).toHaveBeenCalledOnce();

    dispatch('rollback', { settingsVersionId: 'version-1' });
    expect(body.children).toHaveLength(0);

    dispatch('export');
    body.children[0]?.children[0]?.children[2]?.children[0]?.onclick?.();
    await Promise.resolve();

    dispatch('reload');
    body.children[0]?.children[0]?.children[2]?.children[0]?.onclick?.();
    await Promise.resolve();

    dispatch('rollback', {
      settingsVersionId: 'version-1',
      settingsVersionNumber: '12',
    });
    body.children[0]?.children[0]?.children[2]?.children[0]?.onclick?.();
    await Promise.resolve();

    expect(body.children).toHaveLength(0);
    expect(location.href).toBe('');
  });

  it('renders healthy, failed, and unconfigured checks with escaped data', async () => {
    const section = makeElement();
    const results = makeElement();
    const badge = makeElement();
    const createIcons = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'healthy',
          checks: {
            configLoaded: true,
            databaseConnectivity: true,
            smtpConnectivity: false,
            oidcIssuerReachable: null,
            '<custom>': true,
          },
          provider: '<script>alert(1)</script>',
          responseTime: 9,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'degraded',
          checks: {},
          provider: 'sqlite',
          responseTime: 12,
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const windowRoot: Record<string, unknown> = {
      lucide: { createIcons },
    };
    await loadOverview(
      {
        healthCheckSection: section,
        healthCheckResults: results,
        healthStatusBadge: badge,
      },
      windowRoot
    );

    await (windowRoot.checkHealth as () => Promise<void>)();
    expect(section.style.display).toBe('block');
    expect(badge.innerHTML).toContain('Healthy');
    expect(results.innerHTML).toContain('Configuration loaded');
    expect(results.innerHTML).toContain('Database connection');
    expect(results.innerHTML).not.toContain('MongoDB connection');
    expect(results.innerHTML).toContain('Failed');
    expect(results.innerHTML).toContain('Not Configured');
    expect(results.innerHTML).toContain('&lt;custom&gt;');
    expect(results.innerHTML).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(results.innerHTML).not.toContain('<script>');

    await (windowRoot.checkHealth as () => Promise<void>)();
    expect(badge.innerHTML).toContain('Unhealthy');
    expect(createIcons).toHaveBeenCalled();
  });

  it('renders a safe fallback for non-Error health failures', async () => {
    const results = makeElement();
    const badge = makeElement();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('offline'));
    const windowRoot: Record<string, unknown> = {
      lucide: { createIcons: 'not a function' },
    };
    await loadOverview(
      {
        healthCheckSection: makeElement(),
        healthCheckResults: results,
        healthStatusBadge: badge,
      },
      windowRoot
    );

    await (windowRoot.checkHealth as () => Promise<void>)();

    expect(results.innerHTML).toContain('An unknown error occurred');
  });
});
