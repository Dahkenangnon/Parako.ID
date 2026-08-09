import { afterEach, describe, expect, it, vi } from 'vitest';

interface SelectFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  change?: () => void;
  form: { submit: ReturnType<typeof vi.fn> } | null;
}

interface TooltipFixture {
  className: string;
  parentNode: { removeChild: ReturnType<typeof vi.fn> } | null;
  style: { left: string; top: string };
  textContent: string;
}

interface TitledFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  getAttribute: ReturnType<typeof vi.fn>;
  getBoundingClientRect: ReturnType<typeof vi.fn>;
  mouseenter?: () => void;
  mouseleave?: () => void;
}

function makeTitled(title: string | null): TitledFixture {
  const element: TitledFixture = {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      if (_name === 'mouseenter') element.mouseenter = listener;
      if (_name === 'mouseleave') element.mouseleave = listener;
    }),
    getAttribute: vi.fn(() => title),
    getBoundingClientRect: vi.fn(() => ({ bottom: 25, left: 10 })),
  };
  return element;
}

function makeSelect(
  form: { submit: ReturnType<typeof vi.fn> } | null
): SelectFixture {
  const select: SelectFixture = {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      select.change = listener;
    }),
    form,
  };
  return select;
}

function setupDom(
  options: {
    limit?: SelectFixture | null;
    titled?: TitledFixture[];
    tooltip?: TooltipFixture;
    type?: SelectFixture | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  const tooltip =
    options.tooltip ??
    ({
      className: '',
      parentNode: null,
      style: { left: '', top: '' },
      textContent: '',
    } as TooltipFixture);
  const appendChild = vi.fn();
  const createElement = vi.fn(() => tooltip);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    body: { appendChild },
    createElement,
    getElementById: vi.fn((id: string) =>
      id === 'type' ? (options.type ?? null) : (options.limit ?? null)
    ),
    querySelectorAll: vi.fn(() => options.titled ?? []),
  });
  return { appendChild, createElement, runReady: () => ready?.(), tooltip };
}

describe('admin user activities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/users/activities.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely without filters or titled elements', async () => {
    const { runReady } = setupDom();
    await import('../../../src/assets/js/admin/users/activities.js');

    expect(runReady).not.toThrow();
  });

  it('submits each associated form when an activity filter changes', async () => {
    const typeForm = { submit: vi.fn() };
    const limitForm = { submit: vi.fn() };
    const type = makeSelect(typeForm);
    const limit = makeSelect(limitForm);
    const { runReady } = setupDom({ limit, type });
    await import('../../../src/assets/js/admin/users/activities.js');
    runReady();

    type.change?.();
    limit.change?.();

    expect(typeForm.submit).toHaveBeenCalledOnce();
    expect(limitForm.submit).toHaveBeenCalledOnce();
  });

  it('handles filter changes when the selects are detached from forms', async () => {
    const type = makeSelect(null);
    const limit = makeSelect(null);
    const { runReady } = setupDom({ limit, type });
    await import('../../../src/assets/js/admin/users/activities.js');
    runReady();

    expect(() => {
      type.change?.();
      limit.change?.();
    }).not.toThrow();
  });

  it('does not create a tooltip when the title is absent', async () => {
    const element = makeTitled(null);
    const { createElement, runReady } = setupDom({ titled: [element] });
    await import('../../../src/assets/js/admin/users/activities.js');
    runReady();

    element.mouseenter?.();
    element.mouseleave?.();

    expect(createElement).not.toHaveBeenCalled();
  });

  it('creates, positions, and removes a tooltip for titled activity text', async () => {
    const parent = { removeChild: vi.fn() };
    const tooltip: TooltipFixture = {
      className: '',
      parentNode: parent,
      style: { left: '', top: '' },
      textContent: '',
    };
    const element = makeTitled('Full activity details');
    const { appendChild, runReady } = setupDom({
      titled: [element],
      tooltip,
    });
    await import('../../../src/assets/js/admin/users/activities.js');
    runReady();

    element.mouseenter?.();

    expect(tooltip).toMatchObject({
      className:
        'absolute z-50 px-2 py-1 text-xs bg-card border border-border pointer-events-none',
      style: { left: '10px', top: '30px' },
      textContent: 'Full activity details',
    });
    expect(appendChild).toHaveBeenCalledWith(tooltip);

    element.mouseleave?.();
    element.mouseleave?.();

    expect(parent.removeChild).toHaveBeenCalledOnce();
    expect(parent.removeChild).toHaveBeenCalledWith(tooltip);
  });
});
