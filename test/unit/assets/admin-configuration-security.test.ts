import { afterEach, describe, expect, it, vi } from 'vitest';

interface TextareaFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  heightWrites: string[];
  listener?: () => void;
  scrollHeight: number;
  style: { height: string };
}

function makeTextarea(scrollHeight: number): TextareaFixture {
  const heightWrites: string[] = [];
  const style = {} as { height: string };
  Object.defineProperty(style, 'height', {
    configurable: true,
    get: () => heightWrites.at(-1) ?? '',
    set: value => heightWrites.push(value),
  });
  const textarea: TextareaFixture = {
    addEventListener: vi.fn(
      (_name: string, listener: () => void) => (textarea.listener = listener)
    ),
    heightWrites,
    scrollHeight,
    style,
  };
  return textarea;
}

function setupDom(form: { querySelectorAll: ReturnType<typeof vi.fn> } | null) {
  let ready: (() => void) | undefined;
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn(() => form),
  });
  return { runReady: () => ready?.() };
}

describe('admin configuration security enhancements', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/configuration/security.js')
    ).resolves.toBeDefined();
  });

  it('does nothing when the configuration form is absent', async () => {
    const { runReady } = setupDom(null);

    await import('../../../src/assets/js/admin/configuration/security.js');

    expect(runReady).not.toThrow();
  });

  it('resizes every textarea initially and after input', async () => {
    const first = makeTextarea(120);
    const second = makeTextarea(80);
    const form = { querySelectorAll: vi.fn(() => [first, second]) };
    const { runReady } = setupDom(form);

    await import('../../../src/assets/js/admin/configuration/security.js');
    runReady();

    expect(first.heightWrites).toEqual(['auto', '120px']);
    expect(second.heightWrites).toEqual(['auto', '80px']);

    first.scrollHeight = 160;
    first.listener?.();
    expect(first.heightWrites).toEqual(['auto', '120px', 'auto', '160px']);
  });
});
