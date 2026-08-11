import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PasswordVisibilityToggle,
  installPasswordVisibilityGlobal,
  type PasswordVisibilityWindow,
} from '../../../src/assets/js/account/settings/password-visibility.js';

interface ToggleFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  getAttribute: ReturnType<typeof vi.fn>;
  querySelector: ReturnType<typeof vi.fn>;
}

function toggle(
  targetId: string | null,
  svg: { innerHTML: string } | null = null
) {
  return {
    addEventListener: vi.fn(),
    getAttribute: vi.fn(() => targetId),
    querySelector: vi.fn(() => svg),
  } satisfies ToggleFixture;
}

function loadManager(
  buttons: ToggleFixture[] = [],
  inputs: Record<string, object | null> = {}
) {
  const windowRoot: PasswordVisibilityWindow = {};
  const documentRoot = {
    getElementById: vi.fn((id: string) => inputs[id] ?? null),
    querySelectorAll: vi.fn(() => buttons),
  };
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal('document', documentRoot);
  installPasswordVisibilityGlobal(windowRoot);
  return { Manager: PasswordVisibilityToggle, documentRoot };
}

describe('account password visibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('warns and skips buttons without a target', async () => {
    const invalid = toggle(null);
    const { Manager, documentRoot } = await loadManager([invalid]);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new Manager().initialize();

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('missing data-target'),
      invalid
    );
    expect(documentRoot.getElementById).not.toHaveBeenCalled();
  });

  it('warns and skips buttons whose target input is absent', async () => {
    const invalid = toggle('missing-password');
    const { Manager } = await loadManager([invalid]);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new Manager().initialize();

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('Target input not found'),
      'missing-password'
    );
    expect(invalid.addEventListener).not.toHaveBeenCalled();
  });

  it('toggles password visibility and swaps both SVG states', async () => {
    const svg = { innerHTML: '' };
    const control = toggle('password', svg);
    const input = { id: 'password', type: 'password' };
    const { Manager } = await loadManager([control], { password: input });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    new Manager({ debug: true }).initialize();
    const click = control.addEventListener.mock.calls[0]?.[1] as () => void;

    click();
    expect(input.type).toBe('text');
    expect(svg.innerHTML).toContain('M13.875');
    expect(consoleLog).toHaveBeenCalledWith(
      '[PasswordVisibilityToggle]',
      'Password visible for:',
      'password'
    );

    click();
    expect(input.type).toBe('password');
    expect(svg.innerHTML).toContain('M15 12');
    expect(consoleLog).toHaveBeenCalledWith(
      '[PasswordVisibilityToggle]',
      'Password hidden for:',
      'password'
    );
  });

  it('still toggles an input when the button has no SVG', async () => {
    const control = toggle('password');
    const input = { id: 'password', type: 'password' };
    const { Manager } = await loadManager([control], { password: input });
    new Manager({ debug: false }).initialize();
    const click = control.addEventListener.mock.calls[0]?.[1] as () => void;

    expect(() => click()).not.toThrow();
    expect(input.type).toBe('text');
  });

  it('handles a page with no password toggles', async () => {
    const { Manager } = await loadManager();

    expect(() => new Manager().initialize()).not.toThrow();
  });

  it('can be evaluated without a browser window', async () => {
    expect(() => installPasswordVisibilityGlobal(undefined)).not.toThrow();
  });

  it('publishes to the ambient browser window by default', () => {
    const windowRoot: PasswordVisibilityWindow = {};
    vi.stubGlobal('window', windowRoot);

    installPasswordVisibilityGlobal();

    expect(windowRoot.PasswordVisibilityToggle).toBe(PasswordVisibilityToggle);
  });
});
