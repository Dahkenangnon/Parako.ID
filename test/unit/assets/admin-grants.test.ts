import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminGrantsManager,
  initializeAdminGrantsPage,
} from '../../../src/assets/js/admin/grants/index.js';
import dialogService from '../../../src/assets/js/utils/dialog.js';

type SubmitEvent = {
  preventDefault: ReturnType<typeof vi.fn>;
};

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  dataset: Record<string, string>;
  emitSubmit: () => Promise<SubmitEvent>;
  submit: ReturnType<typeof vi.fn>;
}

function makeForm(dataset: Record<string, string> = {}): FormFixture {
  let listener: ((event: SubmitEvent) => Promise<void>) | undefined;
  const form = {
    addEventListener: vi.fn(
      (_name: string, nextListener: (event: SubmitEvent) => Promise<void>) => {
        listener = nextListener;
      }
    ),
    dataset,
    emitSubmit: async () => {
      const event = { preventDefault: vi.fn() };
      await listener?.(event);
      return event;
    },
    submit: vi.fn(),
  } satisfies FormFixture;
  return form;
}

function setupDom(
  options: { confirmed?: boolean; forms?: FormFixture[] } = {}
) {
  const forms = options.forms ?? [makeForm()];
  const showConfirm = vi
    .spyOn(dialogService, 'showConfirm')
    .mockResolvedValue(options.confirmed ?? false);
  vi.stubGlobal('document', {
    querySelectorAll: vi.fn(() => forms),
  });

  return { forms, showConfirm };
}

describe('AdminGrantsManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is statically importable without a browser document', () => {
    expect(AdminGrantsManager).toBeTypeOf('function');
  });

  it('initializes safely when the page has no revocation forms', () => {
    setupDom({ forms: [] });

    expect(() => new AdminGrantsManager().initialize()).not.toThrow();
  });

  it('preserves native form submission when the dialog service is unavailable', async () => {
    const form = makeForm();
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      querySelectorAll: vi.fn(() => [form]),
    });
    new AdminGrantsManager({}, null).initialize();

    const event = await form.emitSubmit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(form.submit).not.toHaveBeenCalled();
  });

  it('prevents native submission and keeps a grant when revocation is cancelled', async () => {
    const { forms, showConfirm } = setupDom();
    new AdminGrantsManager().initialize();

    const event = await forms[0]!.emitSubmit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showConfirm).toHaveBeenCalledWith(
      'Revoke Authorization',
      'Are you sure you want to revoke this authorization? This action cannot be undone.',
      {
        variant: 'danger',
        confirmText: 'Revoke',
        cancelText: 'Cancel',
      }
    );
    expect(forms[0]!.submit).not.toHaveBeenCalled();
  });

  it('submits only the selected form after localized confirmation', async () => {
    const forms = [makeForm(), makeForm()];
    const { showConfirm } = setupDom({ confirmed: true, forms });
    new AdminGrantsManager({
      translations: {
        revokeCancel: 'Keep it',
        revokeConfirm: 'Remove it',
        revokeMessage: 'Remove this authorization?',
        revokeTitle: 'Confirm removal',
      },
    }).initialize();

    await forms[1]!.emitSubmit();

    expect(showConfirm).toHaveBeenCalledWith(
      'Confirm removal',
      'Remove this authorization?',
      {
        variant: 'danger',
        confirmText: 'Remove it',
        cancelText: 'Keep it',
      }
    );
    expect(forms[0]!.submit).not.toHaveBeenCalled();
    expect(forms[1]!.submit).toHaveBeenCalledOnce();
  });

  it('uses a form-specific message for scoped bulk revocation', async () => {
    const form = makeForm({
      grantRevokeMessage: 'Revoke every authorization for alice?',
    });
    const { showConfirm } = setupDom({ forms: [form] });
    new AdminGrantsManager().initialize();

    await form.emitSubmit();

    expect(showConfirm).toHaveBeenCalledWith(
      'Revoke Authorization',
      'Revoke every authorization for alice?',
      expect.any(Object)
    );
  });

  it('initializes with defaults when serialized state is absent', () => {
    const form = makeForm();
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => null),
      querySelectorAll: vi.fn(() => [form]),
    });

    initializeAdminGrantsPage(null);

    expect(form.addEventListener).toHaveBeenCalledWith(
      'submit',
      expect.any(Function)
    );
  });

  it('falls back safely from malformed serialized state', () => {
    const form = makeForm();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => ({ textContent: '{invalid-json' })),
      querySelectorAll: vi.fn(() => [form]),
    });

    initializeAdminGrantsPage(null);

    expect(form.addEventListener).toHaveBeenCalledWith(
      'submit',
      expect.any(Function)
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[AdminGrantsManager] Initialization failed:',
      expect.any(SyntaxError)
    );
  });

  it('initializes from serialized state without publishing a class global', async () => {
    const form = makeForm();
    const showConfirm = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => ({
        textContent: JSON.stringify({
          translations: { revokeTitle: 'Serialized title' },
        }),
      })),
      querySelectorAll: vi.fn(() => [form]),
    });

    initializeAdminGrantsPage({ showConfirm });
    await form.emitSubmit();

    expect(showConfirm).toHaveBeenCalledWith(
      'Serialized title',
      expect.any(String),
      expect.any(Object)
    );
    expect(window).not.toHaveProperty('AdminGrantsManager');
  });
});
