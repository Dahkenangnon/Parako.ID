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

  it('updates every supported provider panel initially and after changes', async () => {
    const google = makeCheckbox(true);
    const github = makeCheckbox(false);
    const microsoft = makeCheckbox(false);
    const linkedin = makeCheckbox(true);
    const facebook = makeCheckbox(false);
    const googlePanel: PanelFixture = { style: { display: '' } };
    const githubPanel: PanelFixture = { style: { display: '' } };
    const microsoftPanel: PanelFixture = { style: { display: '' } };
    const linkedinPanel: PanelFixture = { style: { display: '' } };
    const facebookPanel: PanelFixture = { style: { display: '' } };
    const { runReady } = setupDom({
      social_google: google,
      social_github: github,
      social_microsoft: microsoft,
      social_linkedin: linkedin,
      social_facebook: facebook,
      'google-config': googlePanel,
      'github-config': githubPanel,
      'microsoft-config': microsoftPanel,
      'linkedin-config': linkedinPanel,
      'facebook-config': facebookPanel,
    });
    await import('../../../src/assets/js/admin/settings/features.js');
    runReady();

    expect(googlePanel.style.display).toBe('block');
    expect(githubPanel.style.display).toBe('none');
    expect(microsoftPanel.style.display).toBe('none');
    expect(linkedinPanel.style.display).toBe('block');
    expect(facebookPanel.style.display).toBe('none');

    google.checked = false;
    github.checked = true;
    microsoft.checked = true;
    linkedin.checked = false;
    facebook.checked = true;
    google.change?.();
    github.change?.();
    microsoft.change?.();
    linkedin.change?.();
    facebook.change?.();

    expect(googlePanel.style.display).toBe('none');
    expect(githubPanel.style.display).toBe('block');
    expect(microsoftPanel.style.display).toBe('block');
    expect(linkedinPanel.style.display).toBe('none');
    expect(facebookPanel.style.display).toBe('block');
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
