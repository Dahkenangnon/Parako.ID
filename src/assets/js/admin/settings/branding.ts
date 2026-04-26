/**
 * Admin Branding Settings Module
 *
 * Handles branding settings page functionality:
 * - Form reset with confirmation (via common.ts)
 * - Logo upload with validation
 * - Logo removal with confirmation
 * - Company name validation
 */
(function () {
  'use strict';

  // Type Definitions

  interface BrandingConfig {
    csrfToken: string;
    routes: BrandingRoutes;
  }

  interface BrandingRoutes {
    removeLogo: string;
    uploadLogoDark: string;
    removeLogoDark: string;
    uploadLogoIcon: string;
    removeLogoIcon: string;
    uploadLogoIconDark: string;
    removeLogoIconDark: string;
    uploadFavicon: string;
    removeFavicon: string;
    resetColors: string;
    resetFonts: string;
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

  // Branding Settings Manager Class

  class BrandingSettingsManager {
    private config: BrandingConfig;

    // DOM Elements
    private form: HTMLFormElement | null = null;
    private logoUpload: HTMLInputElement | null = null;
    private previewLogo: HTMLImageElement | null = null;
    private uploadButton: HTMLElement | null = null;
    private removeButton: HTMLElement | null = null;

    // Dark mode logo elements
    private logoDarkUpload: HTMLInputElement | null = null;
    private previewLogoDark: HTMLImageElement | null = null;
    private uploadLogoDarkButton: HTMLElement | null = null;
    private removeLogoDarkButton: HTMLElement | null = null;

    // Icon logo (light) elements
    private logoIconUpload: HTMLInputElement | null = null;
    private previewLogoIcon: HTMLImageElement | null = null;
    private uploadLogoIconButton: HTMLElement | null = null;
    private removeLogoIconButton: HTMLElement | null = null;

    // Icon logo (dark) elements
    private logoIconDarkUpload: HTMLInputElement | null = null;
    private previewLogoIconDark: HTMLImageElement | null = null;
    private uploadLogoIconDarkButton: HTMLElement | null = null;
    private removeLogoIconDarkButton: HTMLElement | null = null;

    private faviconUpload: HTMLInputElement | null = null;
    private previewFavicon: HTMLImageElement | null = null;
    private uploadFaviconButton: HTMLElement | null = null;
    private removeFaviconButton: HTMLElement | null = null;

    private resetColorsButton: HTMLElement | null = null;
    private randomizeColorsButton: HTMLElement | null = null;
    private resetFontsButton: HTMLElement | null = null;
    private companyNameInput: HTMLInputElement | null = null;

    private fontSansSelect: HTMLSelectElement | null = null;
    private fontHeadingSelect: HTMLSelectElement | null = null;
    private fontMonoSelect: HTMLSelectElement | null = null;
    private previewSans: HTMLElement | null = null;
    private previewHeading: HTMLElement | null = null;
    private previewMono: HTMLElement | null = null;

    constructor(config: BrandingConfig) {
      this.config = config;
    }

    public initialize(): void {
      this.cacheElements();
      this.setupLogoUpload();
      this.setupLogoRemoval();
      this.setupLogoDarkUpload();
      this.setupLogoDarkRemoval();
      this.setupLogoIconUpload();
      this.setupLogoIconRemoval();
      this.setupLogoIconDarkUpload();
      this.setupLogoIconDarkRemoval();
      this.setupFaviconUpload();
      this.setupFaviconRemoval();
      this.setupColorsReset();
      this.setupColorsRandomize();
      this.setupFontsReset();
      this.setupFontPreview();
      this.setupFormValidation();
    }

    /**
     * Cache DOM elements
     */
    private cacheElements(): void {
      this.form = document.getElementById(
        'branding-form'
      ) as HTMLFormElement | null;

      // Light mode logo elements
      this.logoUpload = document.getElementById(
        'logo-upload'
      ) as HTMLInputElement | null;
      this.previewLogo = document.getElementById(
        'preview-logo'
      ) as HTMLImageElement | null;
      this.uploadButton = document.getElementById('upload-logo-button');
      this.removeButton = document.getElementById('remove-logo-button');

      // Dark mode logo elements
      this.logoDarkUpload = document.getElementById(
        'logo-dark-upload'
      ) as HTMLInputElement | null;
      this.previewLogoDark = document.getElementById(
        'preview-logo-dark'
      ) as HTMLImageElement | null;
      this.uploadLogoDarkButton = document.getElementById(
        'upload-logo-dark-button'
      );
      this.removeLogoDarkButton = document.getElementById(
        'remove-logo-dark-button'
      );

      // Icon logo (light) elements
      this.logoIconUpload = document.getElementById(
        'logo-icon-upload'
      ) as HTMLInputElement | null;
      this.previewLogoIcon = document.getElementById(
        'preview-logo-icon'
      ) as HTMLImageElement | null;
      this.uploadLogoIconButton = document.getElementById(
        'upload-logo-icon-button'
      );
      this.removeLogoIconButton = document.getElementById(
        'remove-logo-icon-button'
      );

      // Icon logo (dark) elements
      this.logoIconDarkUpload = document.getElementById(
        'logo-icon-dark-upload'
      ) as HTMLInputElement | null;
      this.previewLogoIconDark = document.getElementById(
        'preview-logo-icon-dark'
      ) as HTMLImageElement | null;
      this.uploadLogoIconDarkButton = document.getElementById(
        'upload-logo-icon-dark-button'
      );
      this.removeLogoIconDarkButton = document.getElementById(
        'remove-logo-icon-dark-button'
      );

      this.faviconUpload = document.getElementById(
        'favicon-upload'
      ) as HTMLInputElement | null;
      this.previewFavicon = document.getElementById(
        'preview-favicon'
      ) as HTMLImageElement | null;
      this.uploadFaviconButton = document.getElementById(
        'upload-favicon-button'
      );
      this.removeFaviconButton = document.getElementById(
        'remove-favicon-button'
      );

      this.resetColorsButton = document.getElementById('reset-colors-button');
      this.randomizeColorsButton = document.getElementById(
        'randomize-colors-button'
      );
      this.resetFontsButton = document.getElementById('reset-fonts-button');
      this.companyNameInput = document.getElementById(
        'companyName'
      ) as HTMLInputElement | null;

      this.fontSansSelect = document.getElementById(
        'fonts-sans'
      ) as HTMLSelectElement | null;
      this.fontHeadingSelect = document.getElementById(
        'fonts-heading'
      ) as HTMLSelectElement | null;
      this.fontMonoSelect = document.getElementById(
        'fonts-mono'
      ) as HTMLSelectElement | null;
      this.previewSans = document.getElementById('preview-sans');
      this.previewHeading = document.getElementById('preview-heading');
      this.previewMono = document.getElementById('preview-mono');
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
            'Invalid File',
            validation.error || 'Please upload a valid image file'
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
            'File Too Large',
            'File size must be less than 5MB'
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
            'Invalid File Type',
            'Please upload a valid image file (JPG, PNG, GIF, WebP, or SVG)'
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
     * Setup dark mode logo upload functionality
     */
    private setupLogoDarkUpload(): void {
      if (!this.logoDarkUpload || !this.previewLogoDark) return;

      if (this.uploadLogoDarkButton) {
        this.uploadLogoDarkButton.addEventListener('click', () => {
          this.logoDarkUpload?.click();
        });
      }

      this.logoDarkUpload.addEventListener('change', async () => {
        await this.handleLogoDarkFileChange();
      });
    }

    /**
     * Handle dark mode logo file change
     */
    private async handleLogoDarkFileChange(): Promise<void> {
      if (!this.logoDarkUpload?.files?.[0] || !this.previewLogoDark) return;

      const file = this.logoDarkUpload.files[0];
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
            'Invalid File',
            validation.error || 'Please upload a valid image file'
          );
          this.logoDarkUpload.value = '';
          return;
        }
      } else {
        if (file.size > 5 * 1024 * 1024) {
          await this.showAlert(
            'File Too Large',
            'File size must be less than 5MB'
          );
          this.logoDarkUpload.value = '';
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
            'Invalid File Type',
            'Please upload a valid image file'
          );
          this.logoDarkUpload.value = '';
          return;
        }
      }

      // Upload via AJAX instead of form submission
      await this.uploadFile(
        file,
        this.config.routes.uploadLogoDark,
        this.previewLogoDark,
        document.getElementById('no-logo-dark-text'),
        this.removeLogoDarkButton
      );
    }

    /**
     * Setup dark mode logo removal functionality
     */
    private setupLogoDarkRemoval(): void {
      if (!this.removeLogoDarkButton) return;

      this.removeLogoDarkButton.addEventListener('click', async () => {
        await this.handleLogoDarkRemoval();
      });
    }

    /**
     * Handle dark mode logo removal
     */
    private async handleLogoDarkRemoval(): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      let confirmed = false;
      if (dialogApi && typeof dialogApi.showConfirm === 'function') {
        try {
          confirmed = await dialogApi.showConfirm(
            'Remove Dark Logo',
            'Are you sure you want to remove the dark mode logo?',
            {
              variant: 'danger',
              confirmText: 'Remove',
              cancelText: 'Cancel',
            }
          );
        } catch {
          confirmed = confirm(
            'Are you sure you want to remove the dark mode logo?'
          );
        }
      } else {
        confirmed = confirm(
          'Are you sure you want to remove the dark mode logo?'
        );
      }

      if (!confirmed) return;

      try {
        const response = await fetch(this.config.routes.removeLogoDark, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
        });

        if (response.ok) {
          if (this.previewLogoDark) {
            this.previewLogoDark.src = '';
            this.previewLogoDark.classList.add('hidden');
            const placeholder = document.getElementById('no-logo-dark-text');
            placeholder?.classList.remove('hidden');
          }
          this.removeLogoDarkButton?.classList.add('hidden');
        } else {
          const data = await response.json().catch(() => ({}));
          await this.showAlert(
            'Remove Failed',
            data.error || 'Failed to remove dark mode logo'
          );
        }
      } catch (error) {
        console.error(
          '[BrandingSettingsManager] Remove dark logo error:',
          error
        );
        await this.showAlert('Error', 'Failed to remove dark mode logo');
      }
    }

    /**
     * Setup icon logo (light) upload functionality
     */
    private setupLogoIconUpload(): void {
      if (!this.logoIconUpload || !this.previewLogoIcon) return;

      if (this.uploadLogoIconButton) {
        this.uploadLogoIconButton.addEventListener('click', () => {
          this.logoIconUpload?.click();
        });
      }

      this.logoIconUpload.addEventListener('change', async () => {
        await this.handleLogoIconFileChange();
      });
    }

    /**
     * Handle icon logo (light) file change
     */
    private async handleLogoIconFileChange(): Promise<void> {
      if (!this.logoIconUpload?.files?.[0] || !this.previewLogoIcon) return;

      const file = this.logoIconUpload.files[0];
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
            'Invalid File',
            validation.error || 'Please upload a valid image file'
          );
          this.logoIconUpload.value = '';
          return;
        }
      } else {
        if (file.size > 5 * 1024 * 1024) {
          await this.showAlert(
            'File Too Large',
            'File size must be less than 5MB'
          );
          this.logoIconUpload.value = '';
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
            'Invalid File Type',
            'Please upload a valid image file'
          );
          this.logoIconUpload.value = '';
          return;
        }
      }

      await this.uploadIconFile(
        file,
        this.config.routes.uploadLogoIcon,
        'logoIcon',
        this.previewLogoIcon,
        document.getElementById('no-logo-icon-text'),
        this.removeLogoIconButton
      );
    }

    /**
     * Setup icon logo (light) removal functionality
     */
    private setupLogoIconRemoval(): void {
      if (!this.removeLogoIconButton) return;

      this.removeLogoIconButton.addEventListener('click', async () => {
        await this.handleLogoIconRemoval();
      });
    }

    /**
     * Handle icon logo (light) removal
     */
    private async handleLogoIconRemoval(): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      let confirmed = false;
      if (dialogApi && typeof dialogApi.showConfirm === 'function') {
        try {
          confirmed = await dialogApi.showConfirm(
            'Remove Icon Logo',
            'Are you sure you want to remove the icon logo?',
            {
              variant: 'danger',
              confirmText: 'Remove',
              cancelText: 'Cancel',
            }
          );
        } catch {
          confirmed = confirm('Are you sure you want to remove the icon logo?');
        }
      } else {
        confirmed = confirm('Are you sure you want to remove the icon logo?');
      }

      if (!confirmed) return;

      try {
        const response = await fetch(this.config.routes.removeLogoIcon, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
        });

        if (response.ok) {
          if (this.previewLogoIcon) {
            this.previewLogoIcon.src = '';
            this.previewLogoIcon.classList.add('hidden');
            const placeholder = document.getElementById('no-logo-icon-text');
            placeholder?.classList.remove('hidden');
          }
          this.removeLogoIconButton?.classList.add('hidden');
        } else {
          const data = await response.json().catch(() => ({}));
          await this.showAlert(
            'Remove Failed',
            data.error || 'Failed to remove icon logo'
          );
        }
      } catch (error) {
        console.error(
          '[BrandingSettingsManager] Remove icon logo error:',
          error
        );
        await this.showAlert('Error', 'Failed to remove icon logo');
      }
    }

    /**
     * Setup icon logo (dark) upload functionality
     */
    private setupLogoIconDarkUpload(): void {
      if (!this.logoIconDarkUpload || !this.previewLogoIconDark) return;

      if (this.uploadLogoIconDarkButton) {
        this.uploadLogoIconDarkButton.addEventListener('click', () => {
          this.logoIconDarkUpload?.click();
        });
      }

      this.logoIconDarkUpload.addEventListener('change', async () => {
        await this.handleLogoIconDarkFileChange();
      });
    }

    /**
     * Handle icon logo (dark) file change
     */
    private async handleLogoIconDarkFileChange(): Promise<void> {
      if (!this.logoIconDarkUpload?.files?.[0] || !this.previewLogoIconDark)
        return;

      const file = this.logoIconDarkUpload.files[0];
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
            'Invalid File',
            validation.error || 'Please upload a valid image file'
          );
          this.logoIconDarkUpload.value = '';
          return;
        }
      } else {
        if (file.size > 5 * 1024 * 1024) {
          await this.showAlert(
            'File Too Large',
            'File size must be less than 5MB'
          );
          this.logoIconDarkUpload.value = '';
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
            'Invalid File Type',
            'Please upload a valid image file'
          );
          this.logoIconDarkUpload.value = '';
          return;
        }
      }

      await this.uploadIconFile(
        file,
        this.config.routes.uploadLogoIconDark,
        'logoIconDark',
        this.previewLogoIconDark,
        document.getElementById('no-logo-icon-dark-text'),
        this.removeLogoIconDarkButton
      );
    }

    /**
     * Setup icon logo (dark) removal functionality
     */
    private setupLogoIconDarkRemoval(): void {
      if (!this.removeLogoIconDarkButton) return;

      this.removeLogoIconDarkButton.addEventListener('click', async () => {
        await this.handleLogoIconDarkRemoval();
      });
    }

    /**
     * Handle icon logo (dark) removal
     */
    private async handleLogoIconDarkRemoval(): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      let confirmed = false;
      if (dialogApi && typeof dialogApi.showConfirm === 'function') {
        try {
          confirmed = await dialogApi.showConfirm(
            'Remove Dark Icon Logo',
            'Are you sure you want to remove the dark icon logo?',
            {
              variant: 'danger',
              confirmText: 'Remove',
              cancelText: 'Cancel',
            }
          );
        } catch {
          confirmed = confirm(
            'Are you sure you want to remove the dark icon logo?'
          );
        }
      } else {
        confirmed = confirm(
          'Are you sure you want to remove the dark icon logo?'
        );
      }

      if (!confirmed) return;

      try {
        const response = await fetch(this.config.routes.removeLogoIconDark, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
        });

        if (response.ok) {
          if (this.previewLogoIconDark) {
            this.previewLogoIconDark.src = '';
            this.previewLogoIconDark.classList.add('hidden');
            const placeholder = document.getElementById(
              'no-logo-icon-dark-text'
            );
            placeholder?.classList.remove('hidden');
          }
          this.removeLogoIconDarkButton?.classList.add('hidden');
        } else {
          const data = await response.json().catch(() => ({}));
          await this.showAlert(
            'Remove Failed',
            data.error || 'Failed to remove dark icon logo'
          );
        }
      } catch (error) {
        console.error(
          '[BrandingSettingsManager] Remove dark icon logo error:',
          error
        );
        await this.showAlert('Error', 'Failed to remove dark icon logo');
      }
    }

    /**
     * Upload an icon file via AJAX and update preview
     */
    private async uploadIconFile(
      file: File,
      uploadUrl: string,
      fieldName: string,
      previewElement: HTMLImageElement,
      placeholderElement: HTMLElement | null,
      removeButton: HTMLElement | null
    ): Promise<void> {
      const FormDataConstructor = (window as any).FormData;
      const formData = new FormDataConstructor();
      formData.append(fieldName, file);

      try {
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'X-CSRF-Token': this.config.csrfToken,
          },
          body: formData,
        });

        const data = await response.json();

        if (response.ok && data.success) {
          previewElement.src = data.url;
          previewElement.classList.remove('hidden');
          placeholderElement?.classList.add('hidden');
          removeButton?.classList.remove('hidden');
        } else {
          await this.showAlert(
            'Upload Failed',
            data.error || 'Failed to upload file'
          );
        }
      } catch (error) {
        console.error('[BrandingSettingsManager] Icon upload error:', error);
        await this.showAlert('Error', 'Failed to upload file');
      }
    }

    /**
     * Setup favicon upload functionality
     */
    private setupFaviconUpload(): void {
      if (!this.faviconUpload || !this.previewFavicon) return;

      if (this.uploadFaviconButton) {
        this.uploadFaviconButton.addEventListener('click', () => {
          this.faviconUpload?.click();
        });
      }

      this.faviconUpload.addEventListener('change', async () => {
        await this.handleFaviconFileChange();
      });
    }

    /**
     * Handle favicon file change
     */
    private async handleFaviconFileChange(): Promise<void> {
      if (!this.faviconUpload?.files?.[0] || !this.previewFavicon) return;

      const file = this.faviconUpload.files[0];

      if (file.size > 1 * 1024 * 1024) {
        await this.showAlert('File Too Large', 'Favicon must be less than 1MB');
        this.faviconUpload.value = '';
        return;
      }

      const validTypes = [
        'image/x-icon',
        'image/vnd.microsoft.icon',
        'image/png',
        'image/svg+xml',
      ];
      const validExtensions = ['.ico', '.png', '.svg'];
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

      if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
        await this.showAlert(
          'Invalid File Type',
          'Please upload an ICO, PNG, or SVG file'
        );
        this.faviconUpload.value = '';
        return;
      }

      // Upload via AJAX
      await this.uploadFile(
        file,
        this.config.routes.uploadFavicon,
        this.previewFavicon,
        document.getElementById('no-favicon-text'),
        this.removeFaviconButton
      );
    }

    /**
     * Setup favicon removal functionality
     */
    private setupFaviconRemoval(): void {
      if (!this.removeFaviconButton) return;

      this.removeFaviconButton.addEventListener('click', async () => {
        await this.handleFaviconRemoval();
      });
    }

    /**
     * Handle favicon removal
     */
    private async handleFaviconRemoval(): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      let confirmed = false;
      if (dialogApi && typeof dialogApi.showConfirm === 'function') {
        try {
          confirmed = await dialogApi.showConfirm(
            'Remove Favicon',
            'Are you sure you want to remove the custom favicon?',
            {
              variant: 'danger',
              confirmText: 'Remove',
              cancelText: 'Cancel',
            }
          );
        } catch {
          confirmed = confirm(
            'Are you sure you want to remove the custom favicon?'
          );
        }
      } else {
        confirmed = confirm(
          'Are you sure you want to remove the custom favicon?'
        );
      }

      if (!confirmed) return;

      try {
        const response = await fetch(this.config.routes.removeFavicon, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
        });

        if (response.ok) {
          if (this.previewFavicon) {
            this.previewFavicon.src = '';
            this.previewFavicon.classList.add('hidden');
            const placeholder = document.getElementById('no-favicon-text');
            placeholder?.classList.remove('hidden');
          }
          this.removeFaviconButton?.classList.add('hidden');
        } else {
          const data = await response.json().catch(() => ({}));
          await this.showAlert(
            'Remove Failed',
            data.error || 'Failed to remove favicon'
          );
        }
      } catch (error) {
        console.error('[BrandingSettingsManager] Remove favicon error:', error);
        await this.showAlert('Error', 'Failed to remove favicon');
      }
    }

    /**
     * Upload a file via AJAX and update preview
     */
    private async uploadFile(
      file: File,
      uploadUrl: string,
      previewElement: HTMLImageElement,
      placeholderElement: HTMLElement | null,
      removeButton: HTMLElement | null
    ): Promise<void> {
      const fieldName = uploadUrl.includes('favicon') ? 'favicon' : 'logoDark';
      // Use window.FormData to avoid ESLint no-undef error in IIFE context
      const FormDataConstructor = (window as any).FormData;
      const formData = new FormDataConstructor();
      formData.append(fieldName, file);

      try {
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'X-CSRF-Token': this.config.csrfToken,
          },
          body: formData,
        });

        const data = await response.json();

        if (response.ok && data.success) {
          previewElement.src = data.url;
          previewElement.classList.remove('hidden');
          placeholderElement?.classList.add('hidden');
          removeButton?.classList.remove('hidden');
        } else {
          await this.showAlert(
            'Upload Failed',
            data.error || 'Failed to upload file'
          );
        }
      } catch (error) {
        console.error('[BrandingSettingsManager] Upload error:', error);
        await this.showAlert('Error', 'Failed to upload file');
      }
    }

    /**
     * Setup colors reset functionality
     */
    private setupColorsReset(): void {
      if (!this.resetColorsButton) return;

      this.resetColorsButton.addEventListener('click', async () => {
        await this.handleColorsReset();
      });
    }

    /**
     * Handle colors reset to defaults
     */
    private async handleColorsReset(): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      let confirmed = false;
      if (dialogApi && typeof dialogApi.showConfirm === 'function') {
        try {
          confirmed = await dialogApi.showConfirm(
            'Reset Colors',
            'This will reset all theme colors to their default values. Are you sure?',
            {
              variant: 'warning',
              confirmText: 'Reset',
              cancelText: 'Cancel',
            }
          );
        } catch {
          confirmed = confirm(
            'This will reset all theme colors to their default values. Are you sure?'
          );
        }
      } else {
        confirmed = confirm(
          'This will reset all theme colors to their default values. Are you sure?'
        );
      }

      if (!confirmed) return;

      try {
        const response = await fetch(this.config.routes.resetColors, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
        });

        if (response.ok) {
          window.location.reload();
        } else {
          const data = await response.json().catch(() => ({}));
          await this.showAlert(
            'Reset Failed',
            data.error || 'Failed to reset colors'
          );
        }
      } catch (error) {
        console.error('[BrandingSettingsManager] Reset colors error:', error);
        await this.showAlert('Error', 'Failed to reset colors');
      }
    }

    /**
     * Setup colors randomize functionality
     */
    private setupColorsRandomize(): void {
      if (!this.randomizeColorsButton) return;

      this.randomizeColorsButton.addEventListener('click', () => {
        this.handleColorsRandomize();
      });
    }

    /**
     * Generate a random harmonious color scheme and apply to form inputs
     */
    private handleColorsRandomize(): void {
      const baseHue = Math.floor(Math.random() * 360);

      const lightColors = this.generateColorScheme(baseHue, 'light');
      const darkColors = this.generateColorScheme(baseHue, 'dark');

      this.applyColorsToForm('light', lightColors);
      this.applyColorsToForm('dark', darkColors);
    }

    /**
     * Generate a harmonious color scheme based on a hue
     */
    private generateColorScheme(
      hue: number,
      mode: 'light' | 'dark'
    ): Record<string, string> {
      const isLight = mode === 'light';

      // Analogous hues for harmonious color scheme
      const accentHue = (hue + 30) % 360;
      const secondaryHue = (hue + 330) % 360;

      if (isLight) {
        return {
          primary: this.hslToHex(hue, 65, 45),
          primaryForeground: '#ffffff',
          secondary: this.hslToHex(secondaryHue, 20, 90),
          accent: this.hslToHex(accentHue, 60, 50),

          // Semantic colors - fixed but adjusted to complement
          destructive: this.hslToHex(0, 70, 50),
          success: this.hslToHex(142, 70, 40),
          warning: this.hslToHex(38, 90, 50),
          info: this.hslToHex(210, 80, 50),

          background: this.hslToHex(hue, 10, 98),
          foreground: this.hslToHex(hue, 20, 15),
          card: this.hslToHex(hue, 10, 99),
          muted: this.hslToHex(hue, 15, 92),

          border: this.hslToHex(hue, 15, 85),
          input: this.hslToHex(hue, 10, 97),
          ring: this.hslToHex(hue, 65, 50),

          sidebar: this.hslToHex(hue, 12, 96),
          sidebarForeground: this.hslToHex(hue, 20, 20),
          sidebarPrimary: this.hslToHex(hue, 65, 45),
          sidebarAccent: this.hslToHex(hue, 15, 90),
        };
      } else {
        return {
          primary: this.hslToHex(hue, 60, 55),
          primaryForeground: '#ffffff',
          secondary: this.hslToHex(secondaryHue, 15, 25),
          accent: this.hslToHex(accentHue, 55, 55),

          // Semantic colors - fixed but adjusted for dark mode
          destructive: this.hslToHex(0, 65, 60),
          success: this.hslToHex(142, 60, 50),
          warning: this.hslToHex(38, 85, 55),
          info: this.hslToHex(210, 75, 55),

          background: this.hslToHex(hue, 15, 10),
          foreground: this.hslToHex(hue, 10, 90),
          card: this.hslToHex(hue, 15, 13),
          muted: this.hslToHex(hue, 12, 18),

          border: this.hslToHex(hue, 12, 25),
          input: this.hslToHex(hue, 12, 20),
          ring: this.hslToHex(hue, 60, 55),

          sidebar: this.hslToHex(hue, 15, 12),
          sidebarForeground: this.hslToHex(hue, 10, 85),
          sidebarPrimary: this.hslToHex(hue, 60, 55),
          sidebarAccent: this.hslToHex(hue, 12, 20),
        };
      }
    }

    /**
     * Convert HSL to Hex color
     */
    private hslToHex(h: number, s: number, l: number): string {
      s /= 100;
      l /= 100;

      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;

      let r = 0,
        g = 0,
        b = 0;

      if (h >= 0 && h < 60) {
        r = c;
        g = x;
        b = 0;
      } else if (h >= 60 && h < 120) {
        r = x;
        g = c;
        b = 0;
      } else if (h >= 120 && h < 180) {
        r = 0;
        g = c;
        b = x;
      } else if (h >= 180 && h < 240) {
        r = 0;
        g = x;
        b = c;
      } else if (h >= 240 && h < 300) {
        r = x;
        g = 0;
        b = c;
      } else {
        r = c;
        g = 0;
        b = x;
      }

      const toHex = (n: number): string => {
        const hex = Math.round((n + m) * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      };

      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    /**
     * Apply colors to form inputs
     */
    private applyColorsToForm(
      mode: 'light' | 'dark',
      colors: Record<string, string>
    ): void {
      for (const [colorName, colorValue] of Object.entries(colors)) {
        const inputName = `colors[${mode}][${colorName}]`;
        const textInput = this.form?.querySelector(
          `input[type="text"][name="${inputName}"]`
        ) as HTMLInputElement | null;

        if (textInput) {
          textInput.value = colorValue;

          const container = textInput.closest('[x-data]');
          if (container) {
            const colorPicker = container.querySelector(
              'input[type="color"]'
            ) as HTMLInputElement | null;
            if (colorPicker) {
              colorPicker.value = colorValue;
            }
          }

          textInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }

    /**
     * Setup fonts reset functionality
     */
    private setupFontsReset(): void {
      if (!this.resetFontsButton) return;

      this.resetFontsButton.addEventListener('click', async () => {
        await this.handleFontsReset();
      });
    }

    /**
     * Handle fonts reset to defaults
     */
    private async handleFontsReset(): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      let confirmed = false;
      if (dialogApi && typeof dialogApi.showConfirm === 'function') {
        try {
          confirmed = await dialogApi.showConfirm(
            'Reset Fonts',
            'This will reset all font settings to system defaults. Are you sure?',
            {
              variant: 'warning',
              confirmText: 'Reset',
              cancelText: 'Cancel',
            }
          );
        } catch {
          confirmed = confirm(
            'This will reset all font settings to system defaults. Are you sure?'
          );
        }
      } else {
        confirmed = confirm(
          'This will reset all font settings to system defaults. Are you sure?'
        );
      }

      if (!confirmed) return;

      try {
        const response = await fetch(this.config.routes.resetFonts, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
        });

        if (response.ok) {
          window.location.reload();
        } else {
          const data = await response.json().catch(() => ({}));
          await this.showAlert(
            'Reset Failed',
            data.error || 'Failed to reset fonts'
          );
        }
      } catch (error) {
        console.error('[BrandingSettingsManager] Reset fonts error:', error);
        await this.showAlert('Error', 'Failed to reset fonts');
      }
    }

    /**
     * Setup live font preview
     */
    private setupFontPreview(): void {
      if (this.fontSansSelect && this.previewSans) {
        this.fontSansSelect.addEventListener('change', () => {
          const fontValue =
            this.fontSansSelect?.value || 'system-ui, sans-serif';
          if (this.previewSans) {
            this.previewSans.style.fontFamily = fontValue || 'inherit';
          }
        });
      }

      if (this.fontHeadingSelect && this.previewHeading) {
        this.fontHeadingSelect.addEventListener('change', () => {
          // Heading font defaults to sans if empty
          const fontValue =
            this.fontHeadingSelect?.value ||
            this.fontSansSelect?.value ||
            'system-ui, sans-serif';
          if (this.previewHeading) {
            this.previewHeading.style.fontFamily = fontValue || 'inherit';
          }
        });
      }

      if (this.fontMonoSelect && this.previewMono) {
        this.fontMonoSelect.addEventListener('change', () => {
          const fontValue = this.fontMonoSelect?.value || 'monospace';
          if (this.previewMono) {
            this.previewMono.style.fontFamily = fontValue || 'inherit';
          }
        });
      }
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
            'Remove Logo',
            'Are you sure you want to remove the logo?',
            {
              variant: 'danger',
              confirmText: 'Remove',
              cancelText: 'Cancel',
            }
          );
        } catch {
          confirmed = confirm('Are you sure you want to remove the logo?');
        }
      } else {
        confirmed = confirm('Are you sure you want to remove the logo?');
      }

      if (!confirmed) return;

      try {
        const response = await fetch(this.config.routes.removeLogo, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
        });

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
            'Remove Failed',
            data.error || 'Failed to remove logo'
          );
        }
      } catch (error) {
        console.error('[BrandingSettingsManager] Remove logo error:', error);
        await this.showAlert('Error', 'Failed to remove logo');
      }
    }

    /**
     * Setup form validation
     */
    private setupFormValidation(): void {
      if (!this.form) return;

      this.form.addEventListener('submit', async e => {
        const isValid = await this.validateForm();
        if (!isValid) {
          e.preventDefault();
        }
      });
    }

    /**
     * Validate form before submission
     */
    private async validateForm(): Promise<boolean> {
      const companyName = this.companyNameInput?.value.trim();

      if (!companyName) {
        await this.showAlert('Validation Error', 'Company name is required.');
        return false;
      }

      return true;
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
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById('___ADMIN_BRANDING_STATE___');

    const defaultConfig: BrandingConfig = {
      csrfToken: '',
      routes: {
        removeLogo: '/admin/settings/branding/remove-logo',
        uploadLogoDark: '/admin/settings/branding/logo-dark',
        removeLogoDark: '/admin/settings/branding/remove-logo-dark',
        uploadLogoIcon: '/admin/settings/branding/logo-icon',
        removeLogoIcon: '/admin/settings/branding/remove-logo-icon',
        uploadLogoIconDark: '/admin/settings/branding/logo-icon-dark',
        removeLogoIconDark: '/admin/settings/branding/remove-logo-icon-dark',
        uploadFavicon: '/admin/settings/branding/favicon',
        removeFavicon: '/admin/settings/branding/remove-favicon',
        resetColors: '/admin/settings/branding/reset-colors',
        resetFonts: '/admin/settings/branding/reset-fonts',
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

      const manager = new BrandingSettingsManager({
        ...defaultConfig,
        ...config,
      });
      manager.initialize();
    } catch (error) {
      console.error('[BrandingSettingsManager] Initialization failed:', error);
      const manager = new BrandingSettingsManager(defaultConfig);
      manager.initialize();
    }
  });
})();
