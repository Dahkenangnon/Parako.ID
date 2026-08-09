import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event?: Partial<Event>) => void;

interface Rect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface ElementFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  className: string;
  clientWidth: number;
  getAttribute: ReturnType<typeof vi.fn>;
  getBoundingClientRect: ReturnType<typeof vi.fn>;
  listeners: Map<string, Listener>;
  remove: ReturnType<typeof vi.fn>;
  scrollWidth: number;
  setAttribute: ReturnType<typeof vi.fn>;
  style: Record<string, string>;
  textContent: string | null;
}

interface TooltipApi {
  copyWithFeedback(
    text: string,
    target: ElementFixture | string,
    successMessage?: string,
    errorMessage?: string
  ): Promise<boolean>;
  hide(): void;
  init(): void;
  initDataTooltips(): void;
  initTruncateTooltips(): void;
  show(
    target: ElementFixture | string,
    options:
      | string
      | {
          className?: string;
          delay?: number;
          duration?: number;
          position?: 'top' | 'bottom' | 'left' | 'right';
          text: string;
        }
  ): void;
  showTemporary(
    target: ElementFixture | string,
    text: string,
    duration?: number
  ): void;
}

const defaultTargetRect: Rect = {
  bottom: 120,
  height: 20,
  left: 100,
  right: 150,
  top: 100,
  width: 50,
};

function makeElement(
  overrides: Partial<
    Pick<ElementFixture, 'clientWidth' | 'scrollWidth' | 'textContent'>
  > & {
    attributes?: Record<string, string | null>;
    rect?: Rect;
  } = {}
): ElementFixture {
  const listeners = new Map<string, Listener>();
  const attributes = overrides.attributes ?? {};
  return {
    addEventListener: vi.fn((name: string, callback: Listener) => {
      listeners.set(name, callback);
    }),
    classList: { add: vi.fn(), remove: vi.fn() },
    className: '',
    clientWidth: overrides.clientWidth ?? 100,
    getAttribute: vi.fn((name: string) => attributes[name] ?? null),
    getBoundingClientRect: vi.fn(() => overrides.rect ?? defaultTargetRect),
    listeners,
    remove: vi.fn(),
    scrollWidth: overrides.scrollWidth ?? 100,
    setAttribute: vi.fn(),
    style: {},
    textContent: overrides.textContent ?? '',
  };
}

function setupDom(
  options: {
    dataElements?: ElementFixture[];
    selectorTarget?: ElementFixture | null;
    tooltipRect?: Rect;
    truncateElements?: ElementFixture[];
  } = {}
) {
  const appended: ElementFixture[] = [];
  const documentListeners = new Map<string, Listener>();
  const created: ElementFixture[] = [];
  const tooltipRect = options.tooltipRect ?? {
    bottom: 20,
    height: 20,
    left: 0,
    right: 80,
    top: 0,
    width: 80,
  };
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  const browserWindow: Record<string, unknown> = {
    innerHeight: 400,
    innerWidth: 500,
  };

  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('navigator', { clipboard });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    })
  );
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, callback: Listener) => {
      documentListeners.set(name, callback);
    }),
    body: {
      appendChild: vi.fn((element: ElementFixture) => appended.push(element)),
    },
    createElement: vi.fn(() => {
      const element = makeElement({ rect: tooltipRect });
      created.push(element);
      return element;
    }),
    querySelector: vi.fn(() => options.selectorTarget ?? null),
    querySelectorAll: vi.fn((selector: string) =>
      selector === '[data-tooltip]'
        ? (options.dataElements ?? [])
        : (options.truncateElements ?? [])
    ),
  });

  return {
    appended,
    browserWindow,
    clipboard,
    created,
    documentListeners,
  };
}

async function loadTooltip(): Promise<TooltipApi> {
  await import('../../../src/assets/js/utils/tooltip.js');
  return (window as unknown as { Tooltip: TooltipApi }).Tooltip;
}

function dispatch(element: ElementFixture, name: string): void {
  element.listeners.get(name)?.();
}

describe('tooltip utility', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('can be imported when browser globals are unavailable', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/utils/tooltip.js')
    ).resolves.toBeDefined();
  });

  it('keeps the newest delayed show request', async () => {
    vi.useFakeTimers();
    const target = makeElement();
    const { appended } = setupDom();
    const tooltip = await loadTooltip();

    tooltip.show(target, { delay: 200, text: 'old' });
    tooltip.show(target, { delay: 200, text: 'new' });
    await vi.advanceTimersByTimeAsync(200);

    expect(appended.map(element => element.textContent)).toEqual(['new']);
  });

  it('registers its browser API and initializes both declarative behaviors', async () => {
    const dataElement = makeElement({
      attributes: { 'data-tooltip': 'Help' },
    });
    const truncatedElement = makeElement({
      clientWidth: 50,
      scrollWidth: 100,
      textContent: 'Full value',
    });
    const { browserWindow, documentListeners } = setupDom({
      dataElements: [dataElement],
      truncateElements: [truncatedElement],
    });
    const tooltip = await loadTooltip();

    expect(browserWindow.Tooltip).toBe(tooltip);
    documentListeners.get('DOMContentLoaded')?.();

    expect(dataElement.listeners.has('focus')).toBe(true);
    expect(truncatedElement.listeners.has('mouseenter')).toBe(true);
  });

  it('warns and does nothing when a selector has no target', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { appended } = setupDom();
    const tooltip = await loadTooltip();

    tooltip.show('#missing', 'Missing');
    await vi.runAllTimersAsync();

    expect(warning).toHaveBeenCalledWith('[Tooltip] Target element not found');
    expect(appended).toEqual([]);
  });

  it('supports selector targets and default string options', async () => {
    vi.useFakeTimers();
    const target = makeElement();
    const { appended } = setupDom({ selectorTarget: target });
    const tooltip = await loadTooltip();

    tooltip.show('#target', 'Default tooltip');
    expect(appended).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);

    expect(appended[0]?.textContent).toBe('Default tooltip');
    expect(appended[0]?.style).toEqual({ left: '85px', top: '72px' });
  });

  it.each([
    ['top', '72px', '85px'],
    ['bottom', '128px', '85px'],
    ['left', '100px', '12px'],
    ['right', '100px', '158px'],
  ] as const)('positions a tooltip on the %s', async (position, top, left) => {
    const target = makeElement();
    const { appended } = setupDom();
    const tooltip = await loadTooltip();

    tooltip.show(target, {
      className: 'custom-tooltip',
      delay: 0,
      position,
      text: 'Positioned',
    });

    const rendered = appended[0]!;
    expect(rendered.className).toContain('custom-tooltip');
    expect(rendered.setAttribute).toHaveBeenCalledWith('role', 'tooltip');
    expect(rendered.classList.remove).toHaveBeenCalledWith('opacity-0');
    expect(rendered.classList.add).toHaveBeenCalledWith('opacity-100');
    expect(rendered.style).toEqual({ left, top });
  });

  it.each([
    [
      'left edge',
      'top' as const,
      { ...defaultTargetRect, left: 0, right: 50 },
      '72px',
      '8px',
    ],
    [
      'right edge',
      'right' as const,
      { ...defaultTargetRect, left: 470, right: 520 },
      '100px',
      '412px',
    ],
    [
      'top edge',
      'top' as const,
      { ...defaultTargetRect, bottom: 25, top: 5 },
      '33px',
      '85px',
    ],
    [
      'bottom edge',
      'bottom' as const,
      { ...defaultTargetRect, bottom: 390, top: 370 },
      '342px',
      '85px',
    ],
  ])(
    'keeps a tooltip inside the %s',
    async (_name, position, rect, top, left) => {
      const target = makeElement({ rect });
      const { appended } = setupDom();
      const tooltip = await loadTooltip();

      tooltip.show(target, { delay: 0, position, text: 'Bounded' });

      expect(appended[0]?.style).toEqual({ left, top });
    }
  );

  it('uses top positioning for an unknown runtime position', async () => {
    const { appended } = setupDom();
    const tooltip = await loadTooltip();

    tooltip.show(makeElement(), {
      delay: 0,
      position: 'unknown' as never,
      text: 'Fallback',
    });

    expect(appended[0]?.style).toEqual({ left: '85px', top: '72px' });
  });

  it('cancels a pending show and removes a visible tooltip after its fade', async () => {
    vi.useFakeTimers();
    const target = makeElement();
    const { appended } = setupDom();
    const tooltip = await loadTooltip();

    tooltip.show(target, { delay: 200, text: 'Cancelled' });
    tooltip.hide();
    await vi.advanceTimersByTimeAsync(200);
    expect(appended).toEqual([]);

    tooltip.show(target, { delay: 0, text: 'Visible' });
    const rendered = appended[0]!;
    tooltip.hide();
    expect(rendered.classList.remove).toHaveBeenCalledWith('opacity-100');
    expect(rendered.classList.add).toHaveBeenCalledWith('opacity-0');
    await vi.advanceTimersByTimeAsync(149);
    expect(rendered.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(rendered.remove).toHaveBeenCalledOnce();
  });

  it('auto-hides temporary tooltips using default and custom durations', async () => {
    vi.useFakeTimers();
    const target = makeElement();
    const { appended } = setupDom();
    const tooltip = await loadTooltip();

    tooltip.showTemporary(target, 'Default');
    await vi.advanceTimersByTimeAsync(2000);
    expect(appended[0]?.classList.add).toHaveBeenCalledWith('opacity-0');
    await vi.advanceTimersByTimeAsync(150);
    expect(appended[0]?.remove).toHaveBeenCalledOnce();

    tooltip.showTemporary(target, 'Custom', 25);
    await vi.advanceTimersByTimeAsync(25);
    expect(appended[1]?.classList.add).toHaveBeenCalledWith('opacity-0');
  });

  it('fades an active tooltip before replacing it', async () => {
    vi.useFakeTimers();
    const target = makeElement();
    const { appended } = setupDom();
    const tooltip = await loadTooltip();

    tooltip.show(target, { delay: 0, text: 'First' });
    tooltip.show(target, { delay: 0, text: 'Second' });

    expect(appended.map(element => element.textContent)).toEqual([
      'First',
      'Second',
    ]);
    expect(appended[0]?.classList.add).toHaveBeenCalledWith('opacity-0');
    await vi.advanceTimersByTimeAsync(150);
    expect(appended[0]?.remove).toHaveBeenCalledOnce();
  });

  it('copies text and renders the default success feedback', async () => {
    const target = makeElement();
    const { appended, clipboard } = setupDom();
    const tooltip = await loadTooltip();

    await expect(tooltip.copyWithFeedback('secret', target)).resolves.toBe(
      true
    );
    expect(clipboard.writeText).toHaveBeenCalledWith('secret');
    expect(appended[0]?.textContent).toBe('Copied!');
  });

  it('reports clipboard failures with custom feedback', async () => {
    const error = new Error('denied');
    const target = makeElement();
    const { appended, clipboard } = setupDom();
    clipboard.writeText.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tooltip = await loadTooltip();

    await expect(
      tooltip.copyWithFeedback('secret', target, 'Done', 'No access')
    ).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith('[Tooltip] Copy failed:', error);
    expect(appended[0]?.textContent).toBe('No access');
  });

  it('wires data tooltips for pointer and keyboard use', async () => {
    vi.useFakeTimers();
    const element = makeElement({
      attributes: {
        'data-tooltip': 'Details',
        'data-tooltip-position': 'bottom',
      },
    });
    const blank = makeElement({ attributes: { 'data-tooltip': '' } });
    const { appended } = setupDom({ dataElements: [element, blank] });
    const tooltip = await loadTooltip();

    tooltip.initDataTooltips();
    expect(blank.addEventListener).not.toHaveBeenCalled();

    dispatch(element, 'mouseenter');
    await vi.advanceTimersByTimeAsync(199);
    expect(appended).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(appended[0]?.textContent).toBe('Details');
    expect(appended[0]?.style.top).toBe('128px');

    dispatch(element, 'mouseleave');
    await vi.advanceTimersByTimeAsync(150);
    expect(appended[0]?.remove).toHaveBeenCalledOnce();

    dispatch(element, 'focus');
    expect(appended[1]?.textContent).toBe('Details');
    dispatch(element, 'blur');
    expect(appended[1]?.classList.add).toHaveBeenCalledWith('opacity-0');
  });

  it('defaults declarative tooltip positioning to the top', async () => {
    const element = makeElement({
      attributes: { 'data-tooltip': 'Default position' },
    });
    const { appended } = setupDom({ dataElements: [element] });
    const tooltip = await loadTooltip();

    tooltip.initDataTooltips();
    dispatch(element, 'focus');

    expect(appended[0]?.style.top).toBe('72px');
  });

  it('shows full truncated text only while overflow still exists', async () => {
    vi.useFakeTimers();
    const element = makeElement({
      clientWidth: 50,
      scrollWidth: 100,
      textContent: '  Full text  ',
    });
    const { appended } = setupDom({ truncateElements: [element] });
    const tooltip = await loadTooltip();

    tooltip.initTruncateTooltips();
    dispatch(element, 'mouseenter');
    await vi.advanceTimersByTimeAsync(300);
    expect(appended[0]?.textContent).toBe('Full text');
    dispatch(element, 'mouseleave');

    element.scrollWidth = 50;
    dispatch(element, 'mouseenter');
    await vi.advanceTimersByTimeAsync(300);
    expect(appended).toHaveLength(1);
  });

  it('ignores untruncated and empty truncated-text candidates', async () => {
    const untruncated = makeElement({
      clientWidth: 100,
      scrollWidth: 100,
      textContent: 'Visible',
    });
    const empty = makeElement({
      clientWidth: 50,
      scrollWidth: 100,
      textContent: null,
    });
    setupDom({ truncateElements: [untruncated, empty] });
    const tooltip = await loadTooltip();

    tooltip.initTruncateTooltips();

    expect(untruncated.addEventListener).not.toHaveBeenCalled();
    expect(empty.addEventListener).not.toHaveBeenCalled();
  });
});
