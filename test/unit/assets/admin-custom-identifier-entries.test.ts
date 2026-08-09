import { afterEach, describe, expect, it, vi } from 'vitest';

const entryModules = [
  '../../../src/assets/js/admin/configuration/tenant-custom-identifiers.js',
  '../../../src/assets/js/admin/settings/custom-identifiers.js',
] as const;

describe('admin custom identifier entry modules', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(entryModules)('imports %s without a document', async modulePath => {
    vi.stubGlobal('document', undefined);

    await expect(import(modulePath)).resolves.toBeDefined();
  });

  it.each([
    [
      entryModules[0],
      'tenant-ci-fields-container',
      'tenant-ci-add-btn',
      'Placeholder / Hint',
    ],
    [
      entryModules[1],
      'ci-fields-container',
      'ci-add-field-btn',
      'Used in OIDC claims & API',
    ],
  ] as const)(
    'configures %s with its production IDs and card markup',
    async (modulePath, containerId, addButtonId, uniqueMarkup) => {
      const cards: Array<{ slot: string }> = [];
      let add: (() => void) | undefined;
      const addButton = {
        addEventListener: vi.fn((_name: string, listener: () => void) => {
          add = listener;
        }),
        insertAdjacentHTML: vi.fn(),
        replaceChildren: vi.fn(),
        style: { display: 'initial' },
      };
      const container = {
        addEventListener: vi.fn(),
        appendChild: vi.fn((card: { slot: string }) => cards.push(card)),
        querySelectorAll: vi.fn((selector: string) =>
          selector === '.ci-field-card'
            ? cards
            : cards.map(card => ({ value: card.slot }))
        ),
      };
      const card = {
        className: '',
        dataset: {} as Record<string, string>,
        insertAdjacentHTML: vi.fn(),
        slot: '1',
      };
      const getElementById = vi.fn((id: string) =>
        id === containerId ? container : id === addButtonId ? addButton : null
      );
      vi.stubGlobal('window', {});
      vi.stubGlobal('document', {
        createElement: vi.fn(() => card),
        getElementById,
      });

      await import(modulePath);
      add?.();

      expect(getElementById).toHaveBeenCalledWith(containerId);
      expect(getElementById).toHaveBeenCalledWith(addButtonId);
      expect(card.insertAdjacentHTML).toHaveBeenCalledWith(
        'beforeend',
        expect.stringContaining(uniqueMarkup)
      );
      expect(card.insertAdjacentHTML).toHaveBeenCalledWith(
        'beforeend',
        expect.stringContaining(
          'authentication[custom_identifiers][fields][0][slot]'
        )
      );
      expect(addButton.insertAdjacentHTML).toHaveBeenCalledWith(
        'beforeend',
        expect.stringContaining('Add Custom Identifier (1/3)')
      );
    }
  );
});
