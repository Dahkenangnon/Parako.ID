/**
 * Shared management UI for the three custom-identifier slots exposed to
 * tenants and to the platform settings page. Card markup is supplied by the
 * caller as a string literal built entirely from application-controlled
 * template content; numeric slot and idx values are integers maintained by
 * this module. No external input enters the rendered markup.
 */

interface CustomIdentifierOptions {
  readonly containerId: string;
  readonly addBtnId: string;
  readonly renderCardHtml: (slot: number, idx: number) => string;
  readonly addBtnLabel: (count: number) => string;
}

const setupCustomIdentifierFields = (
  options: CustomIdentifierOptions
): void => {
  const container = document.getElementById(options.containerId);
  const addBtn = document.getElementById(options.addBtnId);
  if (!container) return;

  const getFieldCount = (): number =>
    container.querySelectorAll('.ci-field-card').length;

  const getUsedSlots = (): number[] => {
    const slots: number[] = [];
    container
      .querySelectorAll<HTMLInputElement>(
        '.ci-field-card input[name$="[slot]"]'
      )
      .forEach(input => {
        slots.push(parseInt(input.value, 10));
      });
    return slots;
  };

  const getNextAvailableSlot = (): number | null => {
    const used = getUsedSlots();
    for (let s = 1; s <= 3; s++) {
      if (!used.includes(s)) return s;
    }
    return null;
  };

  const reindexFields = (): void => {
    const cards = container.querySelectorAll<HTMLElement>('.ci-field-card');
    cards.forEach((card, idx) => {
      card.dataset.ciIndex = String(idx);
      card.querySelectorAll<HTMLElement>('[name]').forEach(el => {
        const attr = el.getAttribute('name');
        if (attr) {
          el.setAttribute(
            'name',
            attr.replace(/\[fields\]\[\d+\]/, `[fields][${idx}]`)
          );
        }
      });
      const removeBtn = card.querySelector<HTMLElement>('.ci-remove-btn');
      if (removeBtn) removeBtn.dataset.ciIndex = String(idx);
    });
  };

  const setAddBtnContent = (label: string): void => {
    if (!addBtn) return;
    addBtn.replaceChildren();
    addBtn.insertAdjacentHTML('beforeend', label);
  };

  const updateAddBtn = (): void => {
    if (!addBtn) return;
    const count = getFieldCount();
    if (count >= 3) {
      addBtn.style.display = 'none';
    } else {
      addBtn.style.display = '';
      setAddBtnContent(options.addBtnLabel(count));
    }
    window.lucide?.createIcons();
  };

  const appendCard = (slot: number, idx: number): void => {
    const card = document.createElement('div');
    card.className = 'ci-field-card border border-border p-4 bg-muted/20';
    card.dataset.ciIndex = String(idx);
    card.insertAdjacentHTML('beforeend', options.renderCardHtml(slot, idx));
    container.appendChild(card);
  };

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (getFieldCount() >= 3) return;
      const slot = getNextAvailableSlot();
      if (slot === null) return;
      appendCard(slot, getFieldCount());
      updateAddBtn();
      window.lucide?.createIcons();
    });
  }

  container.addEventListener('click', event => {
    const target = event.target as Element | null;
    const btn = target?.closest('.ci-remove-btn');
    if (!btn) return;
    const card = btn.closest('.ci-field-card');
    if (card) card.remove();
    reindexFields();
    updateAddBtn();
  });
};

export { setupCustomIdentifierFields };
