import { afterEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  alpine: { start: vi.fn() },
  createIcons: vi.fn(),
  fingerprint: { load: vi.fn() },
  icons: { shield: {} },
}));

vi.mock('alpinejs', () => ({ default: dependencies.alpine }));
vi.mock('lucide', () => ({
  createIcons: dependencies.createIcons,
  icons: dependencies.icons,
}));
vi.mock('@fingerprintjs/fingerprintjs', () => ({
  default: dependencies.fingerprint,
}));

describe('browser vendor bootstraps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('publishes Alpine and starts it once', async () => {
    const windowRoot: Record<string, unknown> = {};
    vi.stubGlobal('window', windowRoot);

    await import('../../../src/assets/js/vendor/alpine.js');

    expect(windowRoot.Alpine).toBe(dependencies.alpine);
    expect(dependencies.alpine.start).toHaveBeenCalledOnce();
  });

  it('publishes the locally bundled fingerprint implementation', async () => {
    const windowRoot: Record<string, unknown> = {};
    vi.stubGlobal('window', windowRoot);

    await import('../../../src/assets/js/vendor/fingerprintjs.js');

    expect(windowRoot.FingerprintJS).toBe(dependencies.fingerprint);
  });

  it('publishes Lucide and renders icons after DOM readiness', async () => {
    let ready: (() => void) | undefined;
    const windowRoot: { lucide?: { createIcons(): void } } = {};
    const documentRoot = {
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        ready = listener;
      }),
    };
    vi.stubGlobal('window', windowRoot);
    vi.stubGlobal('document', documentRoot);

    await import('../../../src/assets/js/vendor/lucide.js');
    ready?.();

    expect(documentRoot.addEventListener).toHaveBeenCalledWith(
      'DOMContentLoaded',
      expect.any(Function)
    );
    expect(dependencies.createIcons).toHaveBeenCalledWith({
      icons: dependencies.icons,
    });

    delete windowRoot.lucide;
    expect(() => ready?.()).not.toThrow();
  });
});
