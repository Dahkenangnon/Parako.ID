import { afterEach, describe, expect, it, vi } from 'vitest';

interface CheckboxFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  checked: boolean;
  change?: () => void;
}

interface PanelFixture {
  style: { display: string };
}

function makeCheckbox(checked: boolean): CheckboxFixture {
  const checkbox: CheckboxFixture = {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      checkbox.change = listener;
    }),
    checked,
  };
  return checkbox;
}

function setupDom(
  elements: Record<string, CheckboxFixture | PanelFixture> = {}
) {
  let ready: (() => void) | undefined;
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => elements[id] ?? null),
  });
  return { runReady: () => ready?.() };
}

describe('admin feature settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/settings/features.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when all provider controls are absent', async () => {
    const { runReady } = setupDom();
    await import('../../../src/assets/js/admin/settings/features.js');

    expect(runReady).not.toThrow();
  });

  it('hides panels when their optional checkboxes are absent', async () => {
    const googlePanel: PanelFixture = { style: { display: 'block' } };
    const githubPanel: PanelFixture = { style: { display: 'block' } };
    const { runReady } = setupDom({
      'google-config': googlePanel,
      'github-config': githubPanel,
    });
    await import('../../../src/assets/js/admin/settings/features.js');

    runReady();

    expect(googlePanel.style.display).toBe('none');
    expect(githubPanel.style.display).toBe('none');
  });

  it('updates both provider panels initially and after changes', async () => {
    const google = makeCheckbox(true);
    const github = makeCheckbox(false);
    const googlePanel: PanelFixture = { style: { display: '' } };
    const githubPanel: PanelFixture = { style: { display: '' } };
    const { runReady } = setupDom({
      social_google: google,
      social_github: github,
      'google-config': googlePanel,
      'github-config': githubPanel,
    });
    await import('../../../src/assets/js/admin/settings/features.js');
    runReady();

    expect(googlePanel.style.display).toBe('block');
    expect(githubPanel.style.display).toBe('none');

    google.checked = false;
    github.checked = true;
    google.change?.();
    github.change?.();

    expect(googlePanel.style.display).toBe('none');
    expect(githubPanel.style.display).toBe('block');
  });

  it('runs provider listeners safely when panels are absent', async () => {
    const google = makeCheckbox(false);
    const github = makeCheckbox(true);
    const { runReady } = setupDom({
      social_google: google,
      social_github: github,
    });
    await import('../../../src/assets/js/admin/settings/features.js');
    runReady();

    expect(() => {
      google.change?.();
      github.change?.();
    }).not.toThrow();
  });
});
