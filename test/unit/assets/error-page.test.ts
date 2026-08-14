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

  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'DOMContentLoaded') ready = listener;
    }),
    querySelectorAll: vi.fn(() => [back, reload]),
  });
  vi.stubGlobal('window', {
    history: { back: historyBack },
    location: { reload: locationReload },
  });

  await import('../../../src/assets/js/error-page.js');
  ready?.();

  return { back, historyBack, locationReload, reload };
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
});
