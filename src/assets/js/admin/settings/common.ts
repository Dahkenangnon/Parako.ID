import { FileUpload } from '../../utils/file-upload.js';
import dialogService, { type DialogService } from '../../utils/dialog.js';
import { requestConfirmation } from '../../utils/confirmed-action.js';

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
 * - DialogService for confirmation dialogs
 */
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

export type DialogPort = Partial<
  Pick<DialogService, 'showAlert' | 'showConfirm'>
>;

// Admin Settings Manager Class

export class AdminSettingsManager {
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

  constructor(
    config: SettingsConfig,
    private readonly dialog: DialogPort | null = dialogService
  ) {
    this.config = config;
    this.translations = {
      ...this.defaultTranslations,
      ...config.translations,
    };
  }

  public initialize(): void {
    this.cacheElements();
    this.setupFormReset();
    this.setupTextareaAutoResize();

    if (this.config.features.hasLogoUpload) {
      this.setupLogoUpload();
      this.setupLogoRemoval();
    }
  }

  /**
   * Bind reset controls without relying on inline handlers, which are
   * blocked by the application's Content Security Policy.
   */
  private setupFormReset(): void {
    const resetButtons = document.querySelectorAll<HTMLButtonElement>(
      '[data-settings-reset]'
    );
    resetButtons.forEach(button => {
      button.addEventListener('click', async () => {
        await this.resetForm();
      });
    });
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
    const confirmed = await requestConfirmation(this.dialog, {
      title: this.translations.resetFormTitle,
      message: this.translations.resetFormMessage,
      variant: 'warning',
      confirmText: this.translations.resetFormConfirm,
      cancelText: this.translations.resetFormCancel,
    });

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

  private async handleLogoFileChange(): Promise<void> {
    if (!this.logoUpload?.files?.[0] || !this.previewLogo) return;

    const file = this.logoUpload.files[0];
    const validation = FileUpload.validateImageFile(file, 5 * 1024 * 1024);
    if (!validation.valid) {
      await this.showAlert(
        this.translations.invalidFileType,
        validation.error || this.translations.invalidFileTypeMessage
      );
      this.logoUpload.value = '';
      return;
    }

    const placeholder = this.previewLogo
      .previousElementSibling as HTMLElement | null;
    const preview = await FileUpload.createImagePreview(
      file,
      this.previewLogo,
      placeholder
    );
    if (preview.success) {
      this.form?.submit();
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

  private async handleLogoRemoval(): Promise<void> {
    const confirmed = await requestConfirmation(this.dialog, {
      title: this.translations.removeLogoTitle,
      message: this.translations.removeLogoMessage,
      variant: 'danger',
      confirmText: this.translations.removeLogoConfirm,
      cancelText: this.translations.removeLogoCancel,
    });
    if (!confirmed) return;

    try {
      const response = await fetch(
        this.config.routes.removeLogo || '/admin/settings/branding/remove-logo',
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

  private async showAlert(title: string, message: string): Promise<void> {
    const dialogApi = this.dialog;

    if (dialogApi && typeof dialogApi.showAlert === 'function') {
      try {
        await dialogApi.showAlert(title, message, { variant: 'error' });
      } catch {
        alert(message);
      }
    } else {
      alert(message);
    }
  }

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
}

export function initializeAdminSettingsPage(
  dialog: DialogPort | null = dialogService
): void {
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

    // Branding pages load a dedicated manager for these controls. Keep this
    // shared module limited to generic reset/textarea behavior on those pages
    // so one user action cannot trigger two upload or removal workflows.
    const hasDedicatedBrandingManager =
      document.getElementById('___ADMIN_BRANDING_STATE___') !== null;
    const hasLogoUpload =
      !hasDedicatedBrandingManager &&
      (config.features?.hasLogoUpload ??
        document.getElementById('logo-upload') !== null);

    const manager = new AdminSettingsManager(
      {
        ...defaultConfig,
        ...config,
        features: {
          ...defaultConfig.features,
          ...config.features,
          hasLogoUpload,
        },
      },
      dialog
    );
    manager.initialize();
  } catch (error) {
    console.error('[AdminSettingsManager] Initialization failed:', error);
    const manager = new AdminSettingsManager(defaultConfig, dialog);
    manager.initialize();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeAdminSettingsPage();
  });
}
