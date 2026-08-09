import { afterEach, describe, expect, it, vi } from 'vitest';

interface NamedElement {
  getAttribute: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
}

interface CardFixture {
  className: string;
  dataset: Record<string, string>;
  insertAdjacentHTML: ReturnType<typeof vi.fn>;
  namedElements: NamedElement[];
  querySelector: ReturnType<typeof vi.fn>;
  querySelectorAll: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  removeButton: { dataset: Record<string, string> } | null;
  slot: string;
}

function makeNamedElement(name: string | null): NamedElement {
  return {
    getAttribute: vi.fn(() => name),
    setAttribute: vi.fn(),
  };
}

function makeCard(options: {
  name?: string | null;
  removeButton?: boolean;
  slot: number;
}): CardFixture {
  const removeButton =
    options.removeButton === false
      ? null
      : { dataset: {} as Record<string, string> };
  const card: CardFixture = {
    className: '',
    dataset: {},
    insertAdjacentHTML: vi.fn(),
    namedElements: [makeNamedElement(options.name ?? null)],
    querySelector: vi.fn(() => removeButton),
    querySelectorAll: vi.fn(() => card.namedElements),
    remove: vi.fn(),
    removeButton,
    slot: String(options.slot),
  };
  return card;
}

function setupDom(
  options: {
    addButton?: boolean;
    cards?: CardFixture[];
    container?: boolean;
    lucide?: boolean;
    usedSlots?: string[];
  } = {}
) {
  const cards = options.cards ?? [];
  const containerListeners = new Map<
    string,
    (event: { target: unknown }) => void
  >();
  let addListener: (() => void) | undefined;
  const createIcons = vi.fn();
  const addButton =
    options.addButton === false
      ? null
      : {
          addEventListener: vi.fn((_name: string, listener: () => void) => {
            addListener = listener;
          }),
          insertAdjacentHTML: vi.fn(),
          replaceChildren: vi.fn(),
          style: { display: 'initial' },
        };
  const container =
    options.container === false
      ? null
      : {
          addEventListener: vi.fn(
            (name: string, listener: (event: { target: unknown }) => void) => {
              containerListeners.set(name, listener);
            }
          ),
          appendChild: vi.fn((card: CardFixture) => cards.push(card)),
          querySelectorAll: vi.fn((selector: string) => {
            if (selector === '.ci-field-card') return cards;
            return (options.usedSlots ?? cards.map(card => card.slot)).map(
              value => ({
                value,
              })
            );
          }),
        };
  const created: CardFixture[] = [];

  vi.stubGlobal('window', options.lucide ? { lucide: { createIcons } } : {});
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const card = makeCard({ slot: 0 });
      created.push(card);
      return card;
    }),
    getElementById: vi.fn((id: string) =>
      id === 'container' ? container : id === 'add' ? addButton : null
    ),
  });

  return {
    addButton,
    cards,
    clickAdd: () => addListener?.(),
    clickContainer: (target: unknown) =>
      containerListeners.get('click')?.({ target }),
    createIcons,
    created,
  };
}

async function setupManager() {
  const { setupCustomIdentifierFields } =
    await import('../../../src/assets/js/admin/configuration/custom-identifiers.js');
  const addBtnLabel = vi.fn((count: number) => `Add (${count}/3)`);
  const renderCardHtml = vi.fn((slot: number, idx: number) => `${slot}:${idx}`);
  setupCustomIdentifierFields({
    addBtnId: 'add',
    addBtnLabel,
    containerId: 'container',
    renderCardHtml,
  });
  return { addBtnLabel, renderCardHtml };
}

describe('admin custom identifier manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('is safe to initialize without a document', async () => {
    vi.stubGlobal('document', undefined);
    const { setupCustomIdentifierFields } =
      await import('../../../src/assets/js/admin/configuration/custom-identifiers.js');

    expect(() =>
      setupCustomIdentifierFields({
        addBtnId: 'add',
        addBtnLabel: count => String(count),
        containerId: 'container',
        renderCardHtml: () => '',
      })
    ).not.toThrow();
  });

  it('does nothing when its card container is absent', async () => {
    setupDom({ container: false });

    await expect(setupManager()).resolves.toBeDefined();
  });

  it('adds the next free slot and refreshes the add-button state', async () => {
    const existing = makeCard({ slot: 1 });
    const harness = setupDom({ cards: [existing], lucide: true });
    const { addBtnLabel, renderCardHtml } = await setupManager();

    harness.clickAdd();

    expect(renderCardHtml).toHaveBeenCalledWith(2, 1);
    expect(harness.created[0]).toMatchObject({
      className: 'ci-field-card border border-border p-4 bg-muted/20',
      dataset: { ciIndex: '1' },
    });
    expect(harness.created[0]?.insertAdjacentHTML).toHaveBeenCalledWith(
      'beforeend',
      '2:1'
    );
    expect(harness.cards).toHaveLength(2);
    expect(harness.addButton?.style.display).toBe('');
    expect(addBtnLabel).toHaveBeenCalledWith(2);
    expect(harness.addButton?.replaceChildren).toHaveBeenCalledOnce();
    expect(harness.addButton?.insertAdjacentHTML).toHaveBeenCalledWith(
      'beforeend',
      'Add (2/3)'
    );
    expect(harness.createIcons).toHaveBeenCalledTimes(2);
  });

  it('does not add more than three cards', async () => {
    const harness = setupDom({
      cards: [
        makeCard({ slot: 1 }),
        makeCard({ slot: 2 }),
        makeCard({ slot: 3 }),
      ],
    });
    const { renderCardHtml } = await setupManager();

    harness.clickAdd();

    expect(renderCardHtml).not.toHaveBeenCalled();
    expect(harness.created).toEqual([]);
  });

  it('hides the add action after creating the third field without Lucide', async () => {
    const harness = setupDom({
      cards: [makeCard({ slot: 1 }), makeCard({ slot: 2 })],
    });
    const { addBtnLabel, renderCardHtml } = await setupManager();

    harness.clickAdd();

    expect(renderCardHtml).toHaveBeenCalledWith(3, 2);
    expect(harness.cards).toHaveLength(3);
    expect(harness.addButton?.style.display).toBe('none');
    expect(addBtnLabel).not.toHaveBeenCalled();
  });

  it('does not add when all slot numbers are already occupied', async () => {
    const harness = setupDom({
      cards: [makeCard({ slot: 1 }), makeCard({ slot: 2 })],
      usedSlots: ['1', '2', '3'],
    });
    const { renderCardHtml } = await setupManager();

    harness.clickAdd();

    expect(renderCardHtml).not.toHaveBeenCalled();
  });

  it('ignores container clicks outside a remove control', async () => {
    const harness = setupDom();
    await setupManager();

    harness.clickContainer({ closest: vi.fn(() => null) });

    expect(harness.cards).toEqual([]);
  });

  it('removes a card, reindexes fields, and restores the add action', async () => {
    const first = makeCard({
      name: 'authentication[custom_identifiers][fields][0][key]',
      slot: 1,
    });
    const removed = makeCard({
      name: 'authentication[custom_identifiers][fields][1][key]',
      slot: 2,
    });
    const last = makeCard({ name: null, removeButton: false, slot: 3 });
    const cards = [first, removed, last];
    removed.remove.mockImplementation(() => {
      cards.splice(cards.indexOf(removed), 1);
    });
    const harness = setupDom({ cards, lucide: true });
    const { addBtnLabel } = await setupManager();
    const button = {
      closest: vi.fn((selector: string) =>
        selector === '.ci-field-card' ? removed : null
      ),
    };
    const target = {
      closest: vi.fn((selector: string) =>
        selector === '.ci-remove-btn' ? button : null
      ),
    };

    harness.clickContainer(target);

    expect(removed.remove).toHaveBeenCalledOnce();
    expect(first.dataset.ciIndex).toBe('0');
    expect(last.dataset.ciIndex).toBe('1');
    expect(first.namedElements[0]?.setAttribute).toHaveBeenCalledWith(
      'name',
      'authentication[custom_identifiers][fields][0][key]'
    );
    expect(first.removeButton?.dataset.ciIndex).toBe('0');
    expect(harness.addButton?.style.display).toBe('');
    expect(addBtnLabel).toHaveBeenCalledWith(2);
  });

  it('reindexes safely when a remove control has no containing card or add button', async () => {
    const card = makeCard({ slot: 1 });
    const harness = setupDom({ addButton: false, cards: [card] });
    await setupManager();
    const button = { closest: vi.fn(() => null) };
    const target = { closest: vi.fn(() => button) };

    expect(() => harness.clickContainer(target)).not.toThrow();
    expect(card.dataset.ciIndex).toBe('0');
  });
});
