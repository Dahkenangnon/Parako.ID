import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminActivitiesManager } from '../../../src/assets/js/admin/activities/index.js';

type EventListener = (event: Record<string, unknown>) => void;

interface ElementFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  attributes: Map<string, string>;
  classList: {
    add: ReturnType<typeof vi.fn>;
    contains: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  emit: (name: string, event?: Record<string, unknown>) => void;
  focus: ReturnType<typeof vi.fn>;
  getAttribute: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  textContent: string;
  value: string;
}

interface FormFixture {
  action: string;
  appendChild: ReturnType<typeof vi.fn>;
  method: string;
  submit: ReturnType<typeof vi.fn>;
}

function makeElement(
  options: { hidden?: boolean; value?: string } = {}
): ElementFixture {
  const listeners = new Map<string, EventListener>();
  const attributes = new Map<string, string>();
  const classes = new Set(options.hidden ? ['hidden'] : []);
  const element = {
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      listeners.set(name, listener);
    }),
    attributes,
    classList: {
      add: vi.fn((name: string) => classes.add(name)),
      contains: vi.fn((name: string) => classes.has(name)),
      remove: vi.fn((name: string) => classes.delete(name)),
    },
    emit: (name: string, event: Record<string, unknown> = {}) =>
      listeners.get(name)?.({ target: element, ...event }),
    focus: vi.fn(),
    getAttribute: vi.fn((name: string) => attributes.get(name) ?? null),
    removeAttribute: vi.fn((name: string) => attributes.delete(name)),
    select: vi.fn(),
    setAttribute: vi.fn((name: string, value: string) => {
      attributes.set(name, value);
    }),
    textContent: '',
    value: options.value ?? '',
  } satisfies ElementFixture;

  return element;
}

function setupDom(
  options: {
    activeElement?: ElementFixture | null;
    config?: ConstructorParameters<typeof AdminActivitiesManager>[0];
    csrfInput?: ElementFixture | null;
    csrfMeta?: ElementFixture | null;
    days?: ElementFixture | null;
    error?: ElementFixture | null;
    modal?: ElementFixture | null;
  } = {}
) {
  const documentListeners = new Map<string, EventListener>();
  const trigger = makeElement();
  const cancel = makeElement();
  const confirm = makeElement();
  const modal =
    options.modal === undefined ? makeElement({ hidden: true }) : options.modal;
  const days =
    options.days === undefined ? makeElement({ value: '90' }) : options.days;
  const error =
    options.error === undefined ? makeElement({ hidden: true }) : options.error;
  const createdInputs: Array<{ name: string; type: string; value: string }> =
    [];
  const form: FormFixture = {
    action: '',
    appendChild: vi.fn(),
    method: '',
    submit: vi.fn(),
  };
  const appendToBody = vi.fn();
  const documentFixture = {
    activeElement: options.activeElement ?? trigger,
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      documentListeners.set(name, listener);
    }),
    body: { appendChild: appendToBody },
    createElement: vi.fn((tagName: string) => {
      if (tagName === 'form') return form;
      const input = { name: '', type: '', value: '' };
      createdInputs.push(input);
      return input;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === 'clearOldModal') return modal;
      if (id === 'days') return days;
      if (id === 'clearOldError') return error;
      return null;
    }),
    querySelector: vi.fn((selector: string) => {
      if (selector === '[data-activities-clear-old]') return trigger;
      if (selector === '[data-activities-clear-cancel]') return cancel;
      if (selector === '[data-activities-clear-confirm]') return confirm;
      if (selector === 'input[name="_csrf"]') return options.csrfInput ?? null;
      if (selector === 'meta[name="csrf-token"]')
        return options.csrfMeta ?? null;
      return null;
    }),
  };
  vi.stubGlobal('document', documentFixture);

  const manager = new AdminActivitiesManager(options.config);
  manager.initialize();

  return {
    appendToBody,
    cancel,
    confirm,
    createdInputs,
    days,
    dispatchDocument: (name: string, event: Record<string, unknown>) =>
      documentListeners.get(name)?.(event),
    error,
    form,
    manager,
    modal,
    trigger,
  };
}

describe('AdminActivitiesManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is statically importable without a browser document', () => {
    expect(AdminActivitiesManager).toBeTypeOf('function');
  });

  it('initializes safely when optional page elements are absent', () => {
    const { manager } = setupDom({ days: null, error: null, modal: null });

    expect(() => {
      manager.showModal();
      manager.hideModal();
      manager.clearOldActivities();
    }).not.toThrow();
  });

  it('opens from the declarative trigger and closes from cancel with focus restoration', () => {
    const previousFocus = makeElement();
    const { cancel, days, modal, trigger } = setupDom({
      activeElement: previousFocus,
    });

    trigger.emit('click');
    expect(modal?.classList.remove).toHaveBeenCalledWith('hidden');
    expect(modal?.setAttribute).toHaveBeenCalledWith('aria-hidden', 'false');
    expect(days?.focus).toHaveBeenCalledOnce();
    expect(days?.select).toHaveBeenCalledOnce();

    cancel.emit('click');
    expect(modal?.classList.add).toHaveBeenCalledWith('hidden');
    expect(modal?.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(previousFocus.focus).toHaveBeenCalledOnce();
  });

  it('closes an open dialog with Escape and a backdrop click only', () => {
    const { dispatchDocument, modal, trigger } = setupDom();
    trigger.emit('click');

    dispatchDocument('keydown', { key: 'Enter' });
    expect(modal?.classList.add).not.toHaveBeenCalled();

    dispatchDocument('keydown', { key: 'Escape' });
    expect(modal?.classList.add).toHaveBeenCalledTimes(1);

    trigger.emit('click');
    modal?.emit('click', { target: {} });
    expect(modal?.classList.add).toHaveBeenCalledTimes(1);
    modal?.emit('click');
    expect(modal?.classList.add).toHaveBeenCalledTimes(2);
  });

  it.each(['', '0', '-1', '1.5', '1 day', '36501', '9007199254740992'])(
    'rejects invalid retention days %j with an inline accessible error',
    value => {
      const days = makeElement({ value });
      const error = makeElement({ hidden: true });
      const { confirm, createdInputs } = setupDom({
        config: {
          translations: { invalidDays: 'Choose valid whole days' },
        },
        days,
        error,
      });

      confirm.emit('click');

      expect(days.setAttribute).toHaveBeenCalledWith('aria-invalid', 'true');
      expect(days.focus).toHaveBeenCalledOnce();
      expect(error.textContent).toBe('Choose valid whole days');
      expect(error.classList.remove).toHaveBeenCalledWith('hidden');
      expect(createdInputs).toEqual([]);
    }
  );

  it('clears the validation state when the administrator edits the input', () => {
    const days = makeElement({ value: 'invalid' });
    const error = makeElement({ hidden: true });
    const { confirm } = setupDom({ days, error });
    confirm.emit('click');

    days.emit('input');

    expect(days.removeAttribute).toHaveBeenCalledWith('aria-invalid');
    expect(error.classList.add).toHaveBeenCalledWith('hidden');
  });

  it('submits whole days to the configured route with the page CSRF token', () => {
    const days = makeElement({ value: ' 36500 ' });
    const csrfInput = makeElement({ value: 'page-csrf' });
    const { appendToBody, confirm, createdInputs, form } = setupDom({
      config: {
        csrfToken: 'configured-csrf',
        routes: { clearOld: '/custom/clear-old' },
      },
      csrfInput,
      days,
    });

    confirm.emit('click');

    expect(form).toMatchObject({
      action: '/custom/clear-old',
      method: 'POST',
    });
    expect(createdInputs).toEqual([
      { name: 'days', type: 'hidden', value: '36500' },
      { name: '_csrf', type: 'hidden', value: 'page-csrf' },
    ]);
    expect(form.appendChild).toHaveBeenCalledTimes(2);
    expect(appendToBody).toHaveBeenCalledWith(form);
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('uses the meta token before the configured CSRF fallback', () => {
    const csrfInput = makeElement({ value: '' });
    const csrfMeta = makeElement();
    csrfMeta.attributes.set('content', 'meta-csrf');
    const { createdInputs, manager } = setupDom({
      config: { csrfToken: 'configured-csrf' },
      csrfInput,
      csrfMeta,
      days: makeElement({ value: '30' }),
    });

    manager.clearOldActivities();

    expect(createdInputs[1]?.value).toBe('meta-csrf');
  });

  it('uses safe route and CSRF defaults when optional configuration is empty', () => {
    const { createdInputs, form, manager } = setupDom({
      config: { csrfToken: '', routes: { clearOld: '' } },
      days: makeElement({ value: '1' }),
    });

    manager.clearOldActivities();

    expect(form.action).toBe('/admin/activities/clear-old');
    expect(createdInputs[1]?.value).toBe('');
  });
});
