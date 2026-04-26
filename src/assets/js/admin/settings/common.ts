/**
 * Admin Settings Common Module
 *
 * Provides shared functionality for admin settings pages:
 * - Form reset with confirmation dialog
 * - Logo upload with validation (leverages FileUpload utility)
 * - Logo removal with confirmation
 * - Textarea auto-resize
 *
 * This module uses existing utilities:
 * - FileUpload for file validation and preview
 * - window.dialog for confirmation dialogs
 */
(function () {
  'use strict';

  // Type Definitions

  interface SettingsConfig {
    csrfToken: string;
    routes: SettingsRoutes;
    translations: TranslationStrings;
    features: FeatureFlags;
  }

  interface SettingsRoutes {
    removeLogo?: string;
  }

  interface TranslationStrings {
    resetFormTitle: string;
    resetFormMessage: string;
    resetFormConfirm: string;
    resetFormCancel: string;
    removeLogoTitle: string;
    removeLogoMessage: string;
    removeLogoConfirm: string;
    removeLogoCancel: string;
    fileTooLarge: string;
    fileTooLargeMessage: string;
    invalidFileType: string;
    invalidFileTypeMessage: string;
    removeLogoFailed: string;
  }

  interface FeatureFlags {
    hasLogoUpload: boolean;
  }

  interface DialogApi {
    showConfirm: (
      title: string,
      message: string,
      options?: { variant?: string; confirmText?: string; cancelText?: string }
    ) => Promise<boolean>;
    showAlert: (
      title: string,
      message: string,
      options?: { variant?: string }
    ) => Promise<void>;
  }

  interface FileUploadApi {
    validateImageFile: (
      file: File | null,
      maxSize?: number
    ) => { valid: boolean; error?: string };
    createImagePreview: (
      file: File,
      targetElement: HTMLImageElement,
      placeholderElement?: HTMLElement | null
    ) => Promise<{ success: boolean; data?: string; error?: string }>;
  }

  // Admin Settings Manager Class

  class AdminSettingsManager {
    private config: SettingsConfig;
    private translations: TranslationStrings;

    // DOM Elements
    private form: HTMLFormElement | null = null;
    private logoUpload: HTMLInputElement | null = null;
    private previewLogo: HTMLImageElement | null = null;
    private uploadButton: HTMLElement | null = null;
    private removeButton: HTMLElement | null = null;

    private readonly defaultTranslations: TranslationStrings = {
      resetFormTitle: 'Reset Form',
      resetFormMessage:
        'Are you sure you want to reset the form? All unsaved changes will be lost.',
      resetFormConfirm: 'Reset',
      resetFormCancel: 'Cancel',
      removeLogoTitle: 'Remove Logo',
      removeLogoMessage: 'Are you sure you want to remove the logo?',
      removeLogoConfirm: 'Remove',
      removeLogoCancel: 'Cancel',
      fileTooLarge: 'File Too Large',
      fileTooLargeMessage: 'File size must be less than 5MB',
      invalidFileType: 'Invalid File Type',
      invalidFileTypeMessage:
        'Please upload a valid image file (JPG, PNG, GIF, WebP, or SVG)',
      removeLogoFailed: 'Failed to remove logo',
    };

    constructor(config: SettingsConfig) {
      this.config = config;
      this.translations = {
        ...this.defaultTranslations,
        ...config.translations,
      };
    }

    public initialize(): void {
      this.cacheElements();
      this.setupTextareaAutoResize();

      if (this.config.features.hasLogoUpload) {
        this.setupLogoUpload();
        this.setupLogoRemoval();
      }

      this.exposeGlobalMethods();
    }

    /**
     * Cache DOM elements
     */
    private cacheElements(): void {
      this.form =
        (document.getElementById('branding-form') as HTMLFormElement | null) ||
        document.querySelector<HTMLFormElement>('form');
      this.logoUpload = document.getElementById(
        'logo-upload'
      ) as HTMLInputElement | null;
      this.previewLogo = document.getElementById(
        'preview-logo'
      ) as HTMLImageElement | null;
      this.uploadButton = document.getElementById('upload-logo-button');
      this.removeButton = document.getElementById('remove-logo-button');
    }

    /**
     * Reset form with confirmation dialog
     */
    public async resetForm(): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      let confirmed = false;
      if (dialogApi && typeof dialogApi.showConfirm === 'function') {
        try {
          confirmed = await dialogApi.showConfirm(
            this.translations.resetFormTitle,
            this.translations.resetFormMessage,
            {
              variant: 'warning',
              confirmText: this.translations.resetFormConfirm,
              cancelText: this.translations.resetFormCancel,
            }
          );
        } catch {
          confirmed = confirm(this.translations.resetFormMessage);
        }
      } else {
        confirmed = confirm(this.translations.resetFormMessage);
      }

      if (confirmed && this.form) {
        this.form.reset();
      }
    }

    /**
     * Setup logo upload functionality
     */
    private setupLogoUpload(): void {
      if (!this.logoUpload || !this.previewLogo) return;

      if (this.uploadButton) {
        this.uploadButton.addEventListener('click', () => {
          this.logoUpload?.click();
        });
      }

      this.logoUpload.addEventListener('change', async () => {
        await this.handleLogoFileChange();
      });
    }

    /**
     * Handle logo file change
     */
    private async handleLogoFileChange(): Promise<void> {
      if (!this.logoUpload?.files?.[0] || !this.previewLogo) return;

      const file = this.logoUpload.files[0];

      const fileUploadApi = (window as unknown as { FileUpload: FileUploadApi })
        .FileUpload;

      if (
        fileUploadApi &&
        typeof fileUploadApi.validateImageFile === 'function'
      ) {
        const validation = fileUploadApi.validateImageFile(
          file,
          5 * 1024 * 1024
        );
        if (!validation.valid) {
          await this.showAlert(
            this.translations.invalidFileType,
            validation.error || this.translations.invalidFileTypeMessage
          );
          this.logoUpload.value = '';
          return;
        }

        // Use FileUpload utility for preview
        const placeholderEl = this.previewLogo
          .previousElementSibling as HTMLElement | null;
        await fileUploadApi.createImagePreview(
          file,
          this.previewLogo,
          placeholderEl
        );

        // Submit form to upload
        this.form?.submit();
      } else {
        // Fallback: Manual validation
        if (file.size > 5 * 1024 * 1024) {
          await this.showAlert(
            this.translations.fileTooLarge,
            this.translations.fileTooLargeMessage
          );
          this.logoUpload.value = '';
          return;
        }

        const validTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/svg+xml',
        ];
        if (!validTypes.includes(file.type)) {
          await this.showAlert(
            this.translations.invalidFileType,
            this.translations.invalidFileTypeMessage
          );
          this.logoUpload.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = e => {
          if (this.previewLogo && e.target?.result) {
            this.previewLogo.src = e.target.result as string;
            this.previewLogo.classList.remove('hidden');
            const placeholder = this.previewLogo
              .previousElementSibling as HTMLElement | null;
            placeholder?.classList.add('hidden');
            this.form?.submit();
          }
        };
        reader.readAsDataURL(file);
      }
    }

    /**
     * Setup logo removal functionality
     */
    private setupLogoRemoval(): void {
      if (!this.removeButton) return;

      this.removeButton.addEventListener('click', async () => {
        await this.handleLogoRemoval();
      });
    }

    /**
     * Handle logo removal
     */
    private async handleLogoRemoval(): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      let confirmed = false;
      if (dialogApi && typeof dialogApi.showConfirm === 'function') {
        try {
          confirmed = await dialogApi.showConfirm(
            this.translations.removeLogoTitle,
            this.translations.removeLogoMessage,
            {
              variant: 'danger',
              confirmText: this.translations.removeLogoConfirm,
              cancelText: this.translations.removeLogoCancel,
            }
          );
        } catch {
          confirmed = confirm(this.translations.removeLogoMessage);
        }
      } else {
        confirmed = confirm(this.translations.removeLogoMessage);
      }

      if (!confirmed) return;

      try {
        const response = await fetch(
          this.config.routes.removeLogo ||
            '/admin/settings/branding/remove-logo',
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': this.config.csrfToken,
            },
          }
        );

        if (response.ok) {
          if (this.previewLogo) {
            this.previewLogo.src = '';
            this.previewLogo.classList.add('hidden');
            const placeholder = this.previewLogo
              .previousElementSibling as HTMLElement | null;
            placeholder?.classList.remove('hidden');
          }
          window.location.reload();
        } else {
          const data = await response.json().catch(() => ({}));
          await this.showAlert(
            this.translations.removeLogoFailed,
            data.message || this.translations.removeLogoFailed
          );
        }
      } catch (error) {
        console.error('[AdminSettingsManager] Remove logo error:', error);
        await this.showAlert(
          this.translations.removeLogoFailed,
          this.translations.removeLogoFailed
        );
      }
    }

    /**
     * Show alert dialog
     */
    private async showAlert(title: string, message: string): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      if (dialogApi && typeof dialogApi.showAlert === 'function') {
        await dialogApi.showAlert(title, message, { variant: 'error' });
      } else {
        alert(message);
      }
    }

    /**
     * Setup textarea auto-resize
     */
    private setupTextareaAutoResize(): void {
      const textareas = document.querySelectorAll(
        'textarea'
      ) as NodeListOf<HTMLElement>;
      textareas.forEach(textarea => {
        textarea.addEventListener('input', function (this: HTMLElement) {
          this.style.height = 'auto';
          this.style.height =
            (this as { scrollHeight: number }).scrollHeight + 'px';
        });
      });
    }

    /**
     * Expose methods globally for inline onclick handlers
     */
    private exposeGlobalMethods(): void {
      (window as unknown as { resetForm: () => Promise<void> }).resetForm =
        this.resetForm.bind(this);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById('___ADMIN_SETTINGS_STATE___');

    const defaultConfig: SettingsConfig = {
      csrfToken: '',
      routes: {
        removeLogo: '/admin/settings/branding/remove-logo',
      },
      translations: {
        resetFormTitle: 'Reset Form',
        resetFormMessage:
          'Are you sure you want to reset the form? All unsaved changes will be lost.',
        resetFormConfirm: 'Reset',
        resetFormCancel: 'Cancel',
        removeLogoTitle: 'Remove Logo',
        removeLogoMessage: 'Are you sure you want to remove the logo?',
        removeLogoConfirm: 'Remove',
        removeLogoCancel: 'Cancel',
        fileTooLarge: 'File Too Large',
        fileTooLargeMessage: 'File size must be less than 5MB',
        invalidFileType: 'Invalid File Type',
        invalidFileTypeMessage:
          'Please upload a valid image file (JPG, PNG, GIF, WebP, or SVG)',
        removeLogoFailed: 'Failed to remove logo',
      },
      features: {
        hasLogoUpload: false,
      },
    };

    try {
      const config = stateElement
        ? JSON.parse(stateElement.textContent || '{}')
        : {};

      // Get CSRF token from hidden input if not in config
      if (!config.csrfToken) {
        const csrfInput = document.querySelector(
          'input[name="_csrf"]'
        ) as HTMLInputElement | null;
        config.csrfToken = csrfInput?.value || '';
      }

      const hasLogoUpload = document.getElementById('logo-upload') !== null;

      const manager = new AdminSettingsManager({
        ...defaultConfig,
        ...config,
        features: {
          ...defaultConfig.features,
          ...config.features,
          hasLogoUpload: config.features?.hasLogoUpload ?? hasLogoUpload,
        },
      });
      manager.initialize();
    } catch (error) {
      console.error('[AdminSettingsManager] Initialization failed:', error);
      const manager = new AdminSettingsManager(defaultConfig);
      manager.initialize();
    }
  });
})();
