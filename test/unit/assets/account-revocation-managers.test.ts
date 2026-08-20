import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppsManager,
  initializeAppsPage,
} from '../../../src/assets/js/account/apps.js';
import {
  initializeSessionsPage,
  SessionsManager,
} from '../../../src/assets/js/account/sessions.js';
import dialogService from '../../../src/assets/js/utils/dialog.js';

type ManagerKind = 'apps' | 'sessions';
type ManagerConstructor = new (config?: { debug?: boolean }) => {
  initialize(): void;
};

interface ButtonFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  dataset: Record<string, string | undefined>;
  form: { submit: ReturnType<typeof vi.fn> } | null;
}

function button(overrides: Partial<ButtonFixture> = {}): ButtonFixture {
  return {
    addEventListener: vi.fn(),
    dataset: {},
    form: { submit: vi.fn() },
    ...overrides,
  };
}

function loadManager(kind: ManagerKind, buttons: ButtonFixture[] = []) {
  const showConfirm = vi.spyOn(dialogService, 'showConfirm').mockReset();
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    querySelectorAll: vi.fn(() => buttons),
  });

  const Manager: ManagerConstructor =
    kind === 'apps' ? AppsManager : SessionsManager;
  const initializePage =
    kind === 'apps' ? initializeAppsPage : initializeSessionsPage;
  return { Manager, initializePage, showConfirm };
}

describe.each<ManagerKind>(['apps', 'sessions'])(
  'account %s revocation manager',
  kind => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('submits a confirmed form with the requested dialog options', async () => {
      const target = button({
        dataset: {
          confirmTitle: 'Revoke access',
          confirmMessage: 'Revoke this item?',
          confirmVariant: 'danger',
        },
      });
      const { Manager, showConfirm } = loadManager(kind, [target]);
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      showConfirm.mockResolvedValue(true);
      new Manager({ debug: true }).initialize();
      const click = target.addEventListener.mock.calls[0]?.[1] as (
        event: Event
      ) => Promise<void>;
      const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Event;

      await click(event);

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(showConfirm).toHaveBeenCalledWith(
        'Revoke access',
        'Revoke this item?',
        { variant: 'danger', confirmText: 'Confirm', cancelText: 'Cancel' }
      );
      expect(target.form?.submit).toHaveBeenCalledOnce();
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/Manager]$/),
        'User confirmed action, submitting form'
      );
    });

    it('uses safe defaults and leaves a cancelled form untouched', async () => {
      const target = button();
      const { Manager, showConfirm } = loadManager(kind, [target]);
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      showConfirm.mockResolvedValue(false);
      new Manager({ debug: true }).initialize();
      const click = target.addEventListener.mock.calls[0]?.[1] as (
        event: Event
      ) => Promise<void>;

      await click({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Event);

      expect(showConfirm).toHaveBeenCalledWith(
        'Confirm Action',
        'Are you sure?',
        { variant: 'warning', confirmText: 'Confirm', cancelText: 'Cancel' }
      );
      expect(target.form?.submit).not.toHaveBeenCalled();
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringMatching(/Manager]$/),
        'User cancelled action'
      );
    });

    it('handles confirmation for a button without an associated form', async () => {
      const target = button({ form: null });
      const { Manager, showConfirm } = loadManager(kind, [target]);
      showConfirm.mockResolvedValue(true);
      new Manager({ debug: false }).initialize();

      await target.addEventListener.mock.calls[0]?.[1]({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });

      expect(showConfirm).toHaveBeenCalledOnce();
    });

    it('auto-initializes on DOM readiness and supports an empty page', async () => {
      const { initializePage } = loadManager(kind);

      expect(() => initializePage()).not.toThrow();
    });

    it('is statically importable outside a browser document', () => {
      const Manager = kind === 'apps' ? AppsManager : SessionsManager;

      expect(Manager).toEqual(expect.any(Function));
    });
  }
);
