import { afterEach, describe, expect, it, vi } from 'vitest';

interface InputFixture {
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  hasAttribute: ReturnType<typeof vi.fn>;
  insertAdjacentElement: ReturnType<typeof vi.fn>;
  max: string;
  min: string;
  value: string;
}

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  onSubmit?: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void;
  querySelector: ReturnType<typeof vi.fn>;
  querySelectorAll: ReturnType<typeof vi.fn>;
}

function makeInput(options: {
  max?: string;
  min?: string;
  value: string;
}): InputFixture {
  return {
    classList: { add: vi.fn(), remove: vi.fn() },
    hasAttribute: vi.fn((name: string) =>
      name === 'min' ? options.min !== undefined : options.max !== undefined
    ),
    insertAdjacentElement: vi.fn(),
    max: options.max ?? '',
    min: options.min ?? '',
    value: options.value,
  };
}

function setupDom(
  options: {
    bordered?: Array<{ classList: { remove: ReturnType<typeof vi.fn> } }>;
    existingErrors?: Array<{ remove: ReturnType<typeof vi.fn> }>;
    firstError?: { scrollIntoView: ReturnType<typeof vi.fn> } | null;
    form?: boolean;
    inputs?: InputFixture[];
  } = {}
) {
  let ready: (() => void) | undefined;
  const createdErrors: Array<{ className: string; textContent: string }> = [];
  const form: FormFixture | null =
    options.form === false
      ? null
      : {
          addEventListener: vi.fn(
            (
              _name: string,
              listener: (event: {
                preventDefault: ReturnType<typeof vi.fn>;
              }) => void
            ) => {
              if (form) form.onSubmit = listener;
            }
          ),
          querySelector: vi.fn(() => options.firstError ?? null),
          querySelectorAll: vi.fn((selector: string) => {
            if (selector === '.config-validation-error') {
              return options.existingErrors ?? [];
            }
            if (selector === '.border-destructive') {
              return options.bordered ?? [];
            }
            return options.inputs ?? [];
          }),
        };
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    createElement: vi.fn(() => {
      const error = { className: '', textContent: '' };
      createdErrors.push(error);
      return error;
    }),
    getElementById: vi.fn(() => form),
  });
  return {
    createdErrors,
    runReady: () => ready?.(),
    submit: () => {
      const event = { preventDefault: vi.fn() };
      form?.onSubmit?.(event);
      return event;
    },
  };
}

describe('admin configuration validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/configuration/validation.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the configuration form is absent', async () => {
    const { runReady } = setupDom({ form: false });
    await import('../../../src/assets/js/admin/configuration/validation.js');

    expect(runReady).not.toThrow();
  });

  it('clears stale errors and allows blank numeric fields', async () => {
    const oldError = { remove: vi.fn() };
    const oldBorder = { classList: { remove: vi.fn() } };
    const { runReady, submit } = setupDom({
      bordered: [oldBorder],
      existingErrors: [oldError],
      inputs: [makeInput({ value: '   ' })],
    });
    await import('../../../src/assets/js/admin/configuration/validation.js');
    runReady();

    const event = submit();

    expect(oldError.remove).toHaveBeenCalledOnce();
    expect(oldBorder.classList.remove).toHaveBeenCalledWith(
      'border-destructive'
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('rejects NaN and infinite values and scrolls to the first error', async () => {
    const firstError = { scrollIntoView: vi.fn() };
    const nan = makeInput({ value: 'not-a-number' });
    const infinity = makeInput({ value: 'Infinity' });
    const { createdErrors, runReady, submit } = setupDom({
      firstError,
      inputs: [nan, infinity],
    });
    await import('../../../src/assets/js/admin/configuration/validation.js');
    runReady();

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(createdErrors).toEqual([
      {
        className: 'config-validation-error mt-1 text-xs text-destructive',
        textContent: 'Please enter a valid number.',
      },
      {
        className: 'config-validation-error mt-1 text-xs text-destructive',
        textContent: 'Please enter a valid number.',
      },
    ]);
    expect(nan.insertAdjacentElement).toHaveBeenCalledWith(
      'afterend',
      createdErrors[0]
    );
    expect(firstError.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });

  it('shows minimum and maximum errors for out-of-range values', async () => {
    const below = makeInput({ min: '1', value: '0' });
    const above = makeInput({ max: '50', min: '1', value: '51' });
    const { createdErrors, runReady, submit } = setupDom({
      inputs: [below, above],
    });
    await import('../../../src/assets/js/admin/configuration/validation.js');
    runReady();

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(createdErrors.map(error => error.textContent)).toEqual([
      'Value must be at least 1.',
      'Value cannot exceed 50.',
    ]);
  });

  it('allows finite values without constraints and values on each boundary', async () => {
    const { runReady, submit } = setupDom({
      inputs: [
        makeInput({ value: '42' }),
        makeInput({ min: '1', value: '1' }),
        makeInput({ max: '50', value: '50' }),
        makeInput({ max: '50', min: '1', value: '25' }),
      ],
    });
    await import('../../../src/assets/js/admin/configuration/validation.js');
    runReady();

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
