/**
 * File Upload Utility
 *
 * Provides common file handling functionality:
 * - File type validation
 * - File size validation
 * - File reading (text and data URL)
 * - Image preview generation
 * - JSONC/JSON parsing
 */
(function () {
  'use strict';

  // Type Definitions

  interface FileValidationOptions {
    maxSize?: number; // Maximum file size in bytes
    allowedTypes?: string[]; // MIME types (e.g., 'image/jpeg', 'application/json')
    allowedExtensions?: string[]; // File extensions (e.g., '.jpg', '.json')
  }

  interface FileValidationResult {
    valid: boolean;
    error?: string;
    file?: File;
  }

  interface FileReadResult<T = string> {
    success: boolean;
    data?: T;
    error?: string;
  }

  const IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ];

  const JSON_TYPES = ['application/json', 'text/plain'];

  const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5MB

  // File Validation

  /**
   * Get file extension from filename
   */
  function getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot).toLowerCase() : '';
  }

  /**
   * Validate a file against specified constraints
   *
   * @param file - File to validate
   * @param options - Validation options
   * @returns Validation result
   */
  function validateFile(
    file: File | null | undefined,
    options: FileValidationOptions = {}
  ): FileValidationResult {
    if (!file) {
      return { valid: false, error: 'No file selected' };
    }

    const {
      maxSize = DEFAULT_MAX_SIZE,
      allowedTypes,
      allowedExtensions,
    } = options;

    if (file.size > maxSize) {
      const sizeMB = (maxSize / (1024 * 1024)).toFixed(1);
      return {
        valid: false,
        error: `File size must be less than ${sizeMB}MB`,
      };
    }

    if (allowedTypes && allowedTypes.length > 0) {
      if (!allowedTypes.includes(file.type)) {
        return {
          valid: false,
          error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`,
        };
      }
    }

    if (allowedExtensions && allowedExtensions.length > 0) {
      const ext = getFileExtension(file.name);
      if (!allowedExtensions.includes(ext)) {
        return {
          valid: false,
          error: `Invalid file extension. Allowed extensions: ${allowedExtensions.join(', ')}`,
        };
      }
    }

    return { valid: true, file };
  }

  /**
   * Validate an image file
   *
   * @param file - File to validate
   * @param maxSize - Maximum file size in bytes (default: 5MB)
   * @returns Validation result
   */
  function validateImageFile(
    file: File | null | undefined,
    maxSize: number = DEFAULT_MAX_SIZE
  ): FileValidationResult {
    return validateFile(file, {
      maxSize,
      allowedTypes: IMAGE_TYPES,
    });
  }

  /**
   * Validate a JSON file
   *
   * @param file - File to validate
   * @param maxSize - Maximum file size in bytes (default: 5MB)
   * @returns Validation result
   */
  function validateJsonFile(
    file: File | null | undefined,
    maxSize: number = DEFAULT_MAX_SIZE
  ): FileValidationResult {
    return validateFile(file, {
      maxSize,
      allowedTypes: JSON_TYPES,
      allowedExtensions: ['.json', '.jsonc'],
    });
  }

  // File Reading

  /**
   * Read file as text
   *
   * @param file - File to read
   * @returns Promise with file content as string
   */
  function readFileAsText(file: File): Promise<FileReadResult<string>> {
    return new Promise(resolve => {
      const reader = new FileReader();

      reader.onload = e => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          resolve({ success: true, data: result });
        } else {
          resolve({ success: false, error: 'Failed to read file as text' });
        }
      };

      reader.onerror = () => {
        resolve({ success: false, error: 'Error reading file' });
      };

      reader.readAsText(file);
    });
  }

  /**
   * Read file as Data URL (for image previews)
   *
   * @param file - File to read
   * @returns Promise with file content as data URL
   */
  function readFileAsDataURL(file: File): Promise<FileReadResult<string>> {
    return new Promise(resolve => {
      const reader = new FileReader();

      reader.onload = e => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          resolve({ success: true, data: result });
        } else {
          resolve({ success: false, error: 'Failed to read file as data URL' });
        }
      };

      reader.onerror = () => {
        resolve({ success: false, error: 'Error reading file' });
      };

      reader.readAsDataURL(file);
    });
  }

  /**
   * Read file as ArrayBuffer
   *
   * @param file - File to read
   * @returns Promise with file content as ArrayBuffer
   */
  function readFileAsArrayBuffer(
    file: File
  ): Promise<FileReadResult<ArrayBuffer>> {
    return new Promise(resolve => {
      const reader = new FileReader();

      reader.onload = e => {
        const result = e.target?.result;
        if (result instanceof ArrayBuffer) {
          resolve({ success: true, data: result });
        } else {
          resolve({
            success: false,
            error: 'Failed to read file as array buffer',
          });
        }
      };

      reader.onerror = () => {
        resolve({ success: false, error: 'Error reading file' });
      };

      reader.readAsArrayBuffer(file);
    });
  }

  // JSON/JSONC Parsing

  /**
   * Strip comments from JSONC content
   * Handles single-line (//) and multi-line comments
   *
   * @param content - JSONC content string
   * @returns JSON string with comments removed
   */
  function stripJsonComments(content: string): string {
    let result = content.replace(/\/\/.*$/gm, '');
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    result = result.replace(/,(\s*[}\]])/g, '$1');
    return result;
  }

  /**
   * Parse JSON or JSONC content
   *
   * @param content - JSON or JSONC string
   * @returns Parsed object or null if invalid
   */
  function parseJsonContent<T = unknown>(content: string): FileReadResult<T> {
    try {
      // First try parsing as regular JSON
      const parsed = JSON.parse(content) as T;
      return { success: true, data: parsed };
    } catch {
      try {
        const strippedContent = stripJsonComments(content);
        const parsed = JSON.parse(strippedContent) as T;
        return { success: true, data: parsed };
      } catch (error) {
        return {
          success: false,
          error: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
        };
      }
    }
  }

  /**
   * Read and parse a JSON/JSONC file
   *
   * @param file - File to read and parse
   * @returns Promise with parsed JSON object
   */
  async function readJsonFile<T = unknown>(
    file: File
  ): Promise<FileReadResult<T>> {
    const textResult = await readFileAsText(file);

    if (!textResult.success || !textResult.data) {
      return {
        success: false,
        error: textResult.error || 'Failed to read file',
      };
    }

    return parseJsonContent<T>(textResult.data);
  }

  // Image Preview

  /**
   * Create image preview from file
   *
   * @param file - Image file
   * @param targetElement - IMG element to display preview
   * @param placeholderElement - Optional element to hide when showing preview
   * @returns Promise that resolves when preview is ready
   */
  async function createImagePreview(
    file: File,
    targetElement: HTMLImageElement,
    placeholderElement?: HTMLElement | null
  ): Promise<FileReadResult<string>> {
    const result = await readFileAsDataURL(file);

    if (result.success && result.data) {
      targetElement.src = result.data;
      targetElement.classList.remove('hidden');

      if (placeholderElement) {
        placeholderElement.classList.add('hidden');
      }
    }

    return result;
  }

  /**
   * Clear image preview
   *
   * @param targetElement - IMG element showing preview
   * @param placeholderElement - Optional element to show when clearing preview
   */
  function clearImagePreview(
    targetElement: HTMLImageElement,
    placeholderElement?: HTMLElement | null
  ): void {
    targetElement.src = '';
    targetElement.classList.add('hidden');

    if (placeholderElement) {
      placeholderElement.classList.remove('hidden');
    }
  }

  // File Input Helpers

  /**
   * Get file from input element
   *
   * @param inputId - ID of the file input element
   * @returns File or null if no file selected
   */
  function getFileFromInput(inputId: string): File | null {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    return input?.files?.[0] || null;
  }

  /**
   * Clear file input
   *
   * @param inputId - ID of the file input element
   */
  function clearFileInput(inputId: string): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (input) {
      input.value = '';
    }
  }

  /**
   * Setup file input with validation and preview
   *
   * @param inputId - ID of the file input element
   * @param options - Configuration options
   */
  function setupFileInput(
    inputId: string,
    options: {
      validation?: FileValidationOptions;
      previewElement?: HTMLImageElement | string;
      placeholderElement?: HTMLElement | string;
      onValidFile?: (file: File) => void;
      onInvalidFile?: (error: string) => void;
      autoSubmitForm?: boolean;
    } = {}
  ): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) {
      console.warn(`[FileUpload] Input element '${inputId}' not found`);
      return;
    }

    input.addEventListener('change', async function () {
      const file = this.files?.[0];

      const validation = validateFile(file, options.validation);

      if (!validation.valid) {
        this.value = ''; // Clear the input

        if (options.onInvalidFile) {
          options.onInvalidFile(validation.error || 'Invalid file');
        } else if (typeof (window as any).dialog?.showAlert === 'function') {
          await (window as any).dialog.showAlert(
            'Invalid File',
            validation.error || 'Invalid file',
            { variant: 'error' }
          );
        }
        return;
      }

      if (options.previewElement && validation.file) {
        const previewEl =
          typeof options.previewElement === 'string'
            ? (document.getElementById(
                options.previewElement
              ) as HTMLImageElement | null)
            : options.previewElement;

        const placeholderEl =
          typeof options.placeholderElement === 'string'
            ? document.getElementById(options.placeholderElement)
            : options.placeholderElement;

        if (previewEl) {
          await createImagePreview(validation.file, previewEl, placeholderEl);
        }
      }

      if (options.onValidFile && validation.file) {
        options.onValidFile(validation.file);
      }

      // Auto-submit form if configured
      if (options.autoSubmitForm) {
        const form = input.closest('form');
        if (form) {
          form.submit();
        }
      }
    });
  }

  const FileUpload = {
    validateFile,
    validateImageFile,
    validateJsonFile,
    getFileExtension,

    readFileAsText,
    readFileAsDataURL,
    readFileAsArrayBuffer,

    // JSON handling
    parseJsonContent,
    readJsonFile,
    stripJsonComments,

    createImagePreview,
    clearImagePreview,

    getFileFromInput,
    clearFileInput,
    setupFileInput,

    IMAGE_TYPES,
    JSON_TYPES,
    DEFAULT_MAX_SIZE,
  };

  if (typeof window !== 'undefined') {
    (window as any).FileUpload = FileUpload;
  }
})();
