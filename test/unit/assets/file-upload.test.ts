import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileUpload } from '../../../src/assets/js/utils/file-upload.js';
import type { DialogService } from '../../../src/assets/js/utils/dialog.js';

type ProductionSetupFileInputOptions = NonNullable<
  Parameters<typeof FileUpload.setupFileInput>[1]
>;
type TestSetupFileInputOptions = Omit<
  ProductionSetupFileInputOptions,
  'previewElement' | 'placeholderElement'
> & {
  previewElement?: ImageFixture | string;
  placeholderElement?: ElementFixture | string;
};

interface FileUploadApi {
  IMAGE_TYPES: string[];
  JSON_TYPES: string[];
  DEFAULT_MAX_SIZE: number;
  getFileExtension(name: string): string;
  validateFile(
    file: File | null | undefined,
    options?: Record<string, unknown>
  ): {
    valid: boolean;
    error?: string;
    file?: File;
  };
  validateImageFile(
    file: File | null | undefined,
    maxSize?: number
  ): {
    valid: boolean;
    error?: string;
  };
  validateJsonFile(
    file: File | null | undefined,
    maxSize?: number
  ): {
    valid: boolean;
    error?: string;
  };
  readFileAsText(file: File): Promise<ReadResult<string>>;
  readFileAsDataURL(file: File): Promise<ReadResult<string>>;
  readFileAsArrayBuffer(file: File): Promise<ReadResult<ArrayBuffer>>;
  readJsonFile<T>(file: File): Promise<ReadResult<T>>;
  createImagePreview(
    file: File,
    target: ImageFixture,
    placeholder?: ElementFixture | null
  ): Promise<ReadResult<string>>;
  clearImagePreview(
    target: ImageFixture,
    placeholder?: ElementFixture | null
  ): void;
  getFileFromInput(id: string): File | null;
  clearFileInput(id: string): void;
  setupFileInput(id: string, options?: TestSetupFileInputOptions): void;
  stripJsonComments(content: string): string;
  parseJsonContent<T>(content: string): {
    success: boolean;
    data?: T;
    error?: string;
  };
}

interface ReadResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

class ElementFixture {
  classList = { add: vi.fn(), remove: vi.fn() };
}

class ImageFixture extends ElementFixture {
  src = '';
}

class InputFixture {
  files: File[] | null = null;
  value = '';
  listener?: () => Promise<void>;
  addEventListener = vi.fn((_type: string, listener: () => Promise<void>) => {
    this.listener = listener.bind(this);
  });
  closest = vi.fn();
}

class FileReaderFixture {
  static instances: FileReaderFixture[] = [];
  onload: ((event: { target?: { result: unknown } }) => void) | null = null;
  onerror: (() => void) | null = null;
  readAsText = vi.fn();
  readAsDataURL = vi.fn();
  readAsArrayBuffer = vi.fn();

  constructor() {
    FileReaderFixture.instances.push(this);
  }

  load(result: unknown) {
    this.onload?.({ target: { result } });
  }
}

function file(overrides: Partial<File> = {}): File {
  return {
    name: 'config.json',
    type: 'application/json',
    size: 100,
    ...overrides,
  } as File;
}

function loadFileUpload(
  windowRoot: Record<string, unknown> = {},
  documentRoot?: Record<string, unknown>
): FileUploadApi {
  if (documentRoot) vi.stubGlobal('document', documentRoot);
  const configuredDialog = (windowRoot.dialog ?? {
    showAlert: vi.fn().mockResolvedValue(undefined),
  }) as unknown as Pick<DialogService, 'showAlert'>;

  return {
    ...FileUpload,
    setupFileInput: (id: string, options?: TestSetupFileInputOptions) =>
      FileUpload.setupFileInput(
        id,
        options as unknown as ProductionSetupFileInputOptions,
        configuredDialog
      ),
  } as unknown as FileUploadApi;
}

describe('file upload utility', () => {
  afterEach(() => {
    FileReaderFixture.instances.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('validates size, MIME type, extension, and convenience policies', async () => {
    const api = await loadFileUpload();
    const candidate = file();

    expect(api.getFileExtension('ARCHIVE.JSONC')).toBe('.jsonc');
    expect(api.getFileExtension('README')).toBe('');
    expect(api.validateFile(null)).toEqual({
      valid: false,
      error: 'No file selected',
    });
    expect(
      api.validateFile(file({ size: 11 }), { maxSize: 10 }).error
    ).toContain('0.0MB');
    expect(
      api.validateFile(file({ type: 'text/html' }), {
        allowedTypes: ['application/json'],
      }).error
    ).toContain('Invalid file type');
    expect(
      api.validateFile(file({ name: 'config.txt' }), {
        allowedExtensions: ['.json'],
      }).error
    ).toContain('Invalid file extension');
    expect(api.validateFile(candidate)).toEqual({
      valid: true,
      file: candidate,
    });
    expect(api.validateImageFile(file({ type: 'image/png' })).valid).toBe(true);
    expect(api.validateJsonFile(file({ name: 'config.jsonc' })).valid).toBe(
      true
    );
    expect(api.IMAGE_TYPES).toContain('image/svg+xml');
    expect(api.JSON_TYPES).toEqual(['application/json', 'text/plain']);
    expect(api.DEFAULT_MAX_SIZE).toBe(5 * 1024 * 1024);
  });

  it('reads text, data URLs, and array buffers with explicit failures', async () => {
    vi.stubGlobal('FileReader', FileReaderFixture);
    const api = await loadFileUpload();
    const candidate = file();

    const text = api.readFileAsText(candidate);
    FileReaderFixture.instances.at(-1)?.load('contents');
    await expect(text).resolves.toEqual({ success: true, data: 'contents' });

    const badText = api.readFileAsText(candidate);
    FileReaderFixture.instances.at(-1)?.load(new ArrayBuffer(1));
    await expect(badText).resolves.toEqual({
      success: false,
      error: 'Failed to read file as text',
    });

    const dataUrl = api.readFileAsDataURL(candidate);
    FileReaderFixture.instances.at(-1)?.load('data:image/png;base64,AA==');
    await expect(dataUrl).resolves.toEqual({
      success: true,
      data: 'data:image/png;base64,AA==',
    });

    const badDataUrl = api.readFileAsDataURL(candidate);
    FileReaderFixture.instances.at(-1)?.onerror?.();
    await expect(badDataUrl).resolves.toEqual({
      success: false,
      error: 'Error reading file',
    });

    const buffer = new ArrayBuffer(2);
    const arrayBuffer = api.readFileAsArrayBuffer(candidate);
    FileReaderFixture.instances.at(-1)?.load(buffer);
    await expect(arrayBuffer).resolves.toEqual({ success: true, data: buffer });

    const badBuffer = api.readFileAsArrayBuffer(candidate);
    FileReaderFixture.instances.at(-1)?.load('not-a-buffer');
    await expect(badBuffer).resolves.toEqual({
      success: false,
      error: 'Failed to read file as array buffer',
    });

    for (const read of [api.readFileAsText, api.readFileAsArrayBuffer]) {
      const pending = read(candidate);
      FileReaderFixture.instances.at(-1)?.onerror?.();
      await expect(pending).resolves.toEqual({
        success: false,
        error: 'Error reading file',
      });
    }

    const invalidDataUrl = api.readFileAsDataURL(candidate);
    FileReaderFixture.instances.at(-1)?.load(buffer);
    await expect(invalidDataUrl).resolves.toEqual({
      success: false,
      error: 'Failed to read file as data URL',
    });
  });

  it('parses plain JSON, JSONC, and invalid content', async () => {
    const api = await loadFileUpload();
    expect(api.parseJsonContent('{"ok":true}')).toEqual({
      success: true,
      data: { ok: true },
    });
    expect(api.parseJsonContent('{/*x*/"ok":true,}')).toEqual({
      success: true,
      data: { ok: true },
    });
    expect(api.parseJsonContent('{')).toMatchObject({
      success: false,
      error: expect.stringContaining('Invalid JSON:'),
    });
  });

  it('composes JSON reading and image preview helpers', async () => {
    vi.stubGlobal('FileReader', FileReaderFixture);
    const api = await loadFileUpload();
    const candidate = file();
    const json = api.readJsonFile<{ answer: number }>(candidate);
    FileReaderFixture.instances.at(-1)?.load('{"answer":42}');
    await expect(json).resolves.toEqual({
      success: true,
      data: { answer: 42 },
    });

    const image = new ImageFixture();
    const placeholder = new ElementFixture();
    const preview = api.createImagePreview(candidate, image, placeholder);
    FileReaderFixture.instances.at(-1)?.load('data:image/png;base64,AA==');
    await expect(preview).resolves.toMatchObject({ success: true });
    expect(image.src).toContain('data:image/png');
    expect(image.classList.remove).toHaveBeenCalledWith('hidden');
    expect(placeholder.classList.add).toHaveBeenCalledWith('hidden');

    api.clearImagePreview(image, placeholder);
    expect(image.src).toBe('');
    expect(image.classList.add).toHaveBeenCalledWith('hidden');
    expect(placeholder.classList.remove).toHaveBeenCalledWith('hidden');

    const failedJson = api.readJsonFile(candidate);
    FileReaderFixture.instances.at(-1)?.onerror?.();
    await expect(failedJson).resolves.toEqual({
      success: false,
      error: 'Error reading file',
    });

    const emptyJson = api.readJsonFile(candidate);
    FileReaderFixture.instances.at(-1)?.load('');
    await expect(emptyJson).resolves.toEqual({
      success: false,
      error: 'Failed to read file',
    });

    const failedPreview = api.createImagePreview(candidate, image);
    FileReaderFixture.instances.at(-1)?.onerror?.();
    await expect(failedPreview).resolves.toMatchObject({ success: false });
    api.clearImagePreview(image);

    const previewWithoutPlaceholder = api.createImagePreview(candidate, image);
    FileReaderFixture.instances.at(-1)?.load('data:image/png;base64,BB==');
    await expect(previewWithoutPlaceholder).resolves.toMatchObject({
      success: true,
    });
  });

  it('gets, clears, validates, previews, and submits file inputs', async () => {
    vi.stubGlobal('FileReader', FileReaderFixture);
    const input = new InputFixture();
    const candidate = file({ type: 'image/png', name: 'avatar.png' });
    const preview = new ImageFixture();
    const placeholder = new ElementFixture();
    const form = { submit: vi.fn() };
    const alert = vi.fn().mockResolvedValue(undefined);
    const invalid = vi.fn();
    const valid = vi.fn();
    const documentRoot = {
      getElementById: vi.fn((id: string) =>
        id === 'upload'
          ? input
          : id === 'preview'
            ? preview
            : id === 'placeholder'
              ? placeholder
              : null
      ),
    };
    const api = await loadFileUpload(
      { dialog: { showAlert: alert } },
      documentRoot
    );

    expect(api.getFileFromInput('upload')).toBeNull();
    expect(api.getFileFromInput('missing')).toBeNull();
    input.files = [candidate];
    expect(api.getFileFromInput('upload')).toBe(candidate);
    input.value = 'selected';
    api.clearFileInput('upload');
    api.clearFileInput('missing');
    expect(input.value).toBe('');

    api.setupFileInput('upload', { onInvalidFile: invalid });
    input.files = null;
    await input.listener?.();
    expect(invalid).toHaveBeenCalledWith('No file selected');

    api.setupFileInput('upload', { validation: { maxSize: 1 } });
    input.files = [candidate];
    await input.listener?.();
    expect(alert).toHaveBeenCalledWith(
      'Invalid File',
      expect.stringContaining('File size'),
      { variant: 'error' }
    );

    input.closest.mockReturnValue(form);
    api.setupFileInput('upload', {
      validation: { allowedTypes: ['image/png'] },
      previewElement: 'preview',
      placeholderElement: 'placeholder',
      onValidFile: valid,
      autoSubmitForm: true,
    });
    input.files = [candidate];
    const change = input.listener?.();
    FileReaderFixture.instances.at(-1)?.load('data:image/png;base64,AA==');
    await change;
    expect(valid).toHaveBeenCalledWith(candidate);
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it('warns for a missing setup input', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = await loadFileUpload({}, { getElementById: vi.fn(() => null) });
    api.setupFileInput('missing');
    expect(warn).toHaveBeenCalledWith(
      "[FileUpload] Input element 'missing' not found"
    );
  });

  it('handles optional input paths without dialogs, previews, callbacks, or forms', async () => {
    vi.stubGlobal('FileReader', FileReaderFixture);
    const input = new InputFixture();
    const candidate = file({ type: 'image/png', name: 'avatar.png' });
    const preview = new ImageFixture();
    const placeholder = new ElementFixture();
    const documentRoot = {
      getElementById: vi.fn((id: string) =>
        id === 'upload' ? input : id === 'missing-preview' ? null : null
      ),
    };
    const api = await loadFileUpload({}, documentRoot);

    api.setupFileInput('upload');
    input.files = null;
    await input.listener?.();

    api.setupFileInput('upload', {
      previewElement: 'missing-preview',
      placeholderElement: 'missing-placeholder',
    });
    input.files = [candidate];
    await input.listener?.();

    api.setupFileInput('upload');
    input.files = [candidate];
    await input.listener?.();

    api.setupFileInput('upload', {
      previewElement: preview,
      placeholderElement: placeholder,
      autoSubmitForm: true,
    });
    input.closest.mockReturnValue(null);
    input.files = [candidate];
    const change = input.listener?.();
    FileReaderFixture.instances.at(-1)?.load('data:image/png;base64,AA==');
    await change;
    expect(preview.src).toContain('data:image/png');
  });

  it('covers JSONC escapes, multiline comments, arrays, and parse-error fallback', async () => {
    const api = await loadFileUpload();
    const content = `/* first\nsecond */{
      "escapedQuote": "a\\"b",
      "escapedSlash": "c\\\\d",
      "items": [1,],
      "pair": [1, 2],
    }`;
    expect(JSON.parse(api.stripJsonComments(content))).toEqual({
      escapedQuote: 'a"b',
      escapedSlash: 'c\\d',
      items: [1],
      pair: [1, 2],
    });
    expect(api.stripJsonComments(',')).toBe(',');

    const parse = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw 'parse failure';
    });
    expect(api.parseJsonContent('{}')).toEqual({
      success: false,
      error: 'Invalid JSON: Parse error',
    });
    parse.mockRestore();
  });

  it('does not publish a browser API through an application global', () => {
    const browserWindow: Record<string, unknown> = {};
    vi.stubGlobal('window', browserWindow);

    expect(browserWindow).not.toHaveProperty('FileUpload');
  });
  it('parses JSONC without treating comment tokens inside strings as comments', async () => {
    const fileUpload = await loadFileUpload();
    const content = `{
      // endpoint configuration
      "url": "https://id.example.test/callback",
      "pattern": "/* literal */",
      "closing": "value,}",
    }`;

    expect(
      fileUpload.parseJsonContent<{
        url: string;
        pattern: string;
        closing: string;
      }>(content)
    ).toEqual({
      success: true,
      data: {
        url: 'https://id.example.test/callback',
        pattern: '/* literal */',
        closing: 'value,}',
      },
    });
  });
});
