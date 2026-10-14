import { afterEach, describe, expect, it, vi } from 'vitest';

interface ActionElement {
  addEventListener: ReturnType<typeof vi.fn>;
  dataset: { errorAction?: string };
  trigger: () => void;
}

function actionElement(errorAction: string): ActionElement {
  let click: (() => void) | undefined;
  return {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'click') click = listener;
    }),
    dataset: { errorAction },
    trigger: () => click?.(),
  };
}

async function loadActions() {
  const back = actionElement('back');
  const reload = actionElement('reload');
  let ready: (() => void) | undefined;
  const historyBack = vi.fn();
  const locationReload = vi.fn();

  const countdown = {
    dataset: { rateLimitCountdown: '2' },
    textContent: '',
  };
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'DOMContentLoaded') ready = listener;
    }),
    querySelectorAll: vi.fn(() => [back, reload]),
    querySelector: vi.fn(() => countdown),
  });
  vi.stubGlobal('window', {
    clearInterval,
    history: { back: historyBack },
    location: { reload: locationReload },
    setInterval,
  });

  await import('../../../src/assets/js/error-page.js');
  ready?.();

  return { back, countdown, historyBack, locationReload, reload };
}

describe('error page recovery actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('navigates back without an inline javascript URL', async () => {
    const { back, historyBack, locationReload } = await loadActions();

    back.trigger();

    expect(historyBack).toHaveBeenCalledOnce();
    expect(locationReload).not.toHaveBeenCalled();
  });

  it('reloads the current page without an inline javascript URL', async () => {
    const { historyBack, locationReload, reload } = await loadActions();

    reload.trigger();

    expect(locationReload).toHaveBeenCalledOnce();
    expect(historyBack).not.toHaveBeenCalled();
  });

  it('updates the retry countdown without inline script', async () => {
    vi.useFakeTimers();
    const { countdown } = await loadActions();

    expect(countdown.textContent).toBe('2');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(countdown.textContent).toBe('1');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(countdown.textContent).toBe('0');
    vi.useRealTimers();
  });
});
