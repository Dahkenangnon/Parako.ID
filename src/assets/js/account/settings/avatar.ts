/**
 * AvatarManager - Manages avatar upload, preview, and removal
 *
 * Features:
 * - File input triggering via upload button
 * - Real-time image preview using FileReader API
 * - Upload progress widget management
 * - Auto-form submission after preview
 * - Avatar removal with confirmation dialog
 * - Integration with dialog utility for consistent UX
 * - Error handling with user feedback
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  /**
   * Configuration interface for AvatarManager
   */
  interface AvatarConfig {
    removeAvatarUrl: string;
    csrfToken: string;
    translations: {
      removeConfirm: string;
      removeError: string;
      fileReadError: string;
      processingImage: string;
    };
    debug?: boolean;
  }

  /**
   * AvatarManager class - Handles avatar upload and management
   */
  class AvatarManager {
    private config: AvatarConfig;
    private debug: boolean;
    private avatarUpload: HTMLInputElement | null;
    private previewAvatar: HTMLImageElement | null;
    private initialsPlaceholder: HTMLElement | null;
    private uploadButton: HTMLElement | null;
    private removeButton: HTMLElement | null;
    private profileForm: HTMLFormElement | null;
    private uploadProgressWidget: HTMLElement | null;

    constructor(config: AvatarConfig) {
      this.config = config;
      this.debug = config.debug || false;
      this.avatarUpload = null;
      this.previewAvatar = null;
      this.initialsPlaceholder = null;
      this.uploadButton = null;
      this.removeButton = null;
      this.profileForm = null;
      this.uploadProgressWidget = null;
    }

    /**
     * Initialize the avatar manager
     */
    public initialize(): void {
      this.log('Initializing AvatarManager');

      this.avatarUpload = document.getElementById(
        'avatar-upload'
      ) as HTMLInputElement;
      this.previewAvatar = document.getElementById(
        'preview-avatar'
      ) as HTMLImageElement;
      this.initialsPlaceholder = document.getElementById(
        'initials-placeholder'
      );
      this.uploadButton = document.getElementById('upload-button');
      this.removeButton = document.getElementById('remove-button');
      this.profileForm = document.getElementById(
        'profile-form'
      ) as HTMLFormElement;
      this.uploadProgressWidget = document.getElementById(
        'upload-progress-widget'
      );

      this.setupUploadHandler();
      this.setupRemoveHandler();
    }

    /**
     * Setup upload button and file input handler
     */
    private setupUploadHandler(): void {
      if (this.uploadButton && this.avatarUpload) {
        this.uploadButton.addEventListener('click', () => {
          this.avatarUpload!.click();
        });

        this.log('Upload button handler setup complete');
      }

      // Auto-submit profile form when avatar is uploaded (with preview)
      if (this.avatarUpload) {
        this.avatarUpload.addEventListener('change', () => {
          this.handleAvatarUpload();
        });

        this.log('Avatar upload handler setup complete');
      }
    }

    /**
     * Setup remove button handler
     */
    private setupRemoveHandler(): void {
      if (!this.removeButton) return;

      this.removeButton.addEventListener('click', async () => {
        await this.handleAvatarRemoval();
      });

      this.log('Remove button handler setup complete');
    }

    /**
     * Handle avatar file upload
     */
    private handleAvatarUpload(): void {
      const files = this.avatarUpload?.files;

      if (!files || !files[0]) return;

      const file = files[0];

      this.log('Avatar file selected:', file.name);

      if (this.uploadProgressWidget) {
        this.uploadProgressWidget.classList.remove('hidden');
      }

      const reader = new FileReader();

      reader.onload = e => {
        if (this.previewAvatar && e.target?.result) {
          this.previewAvatar.src = e.target.result as string;
          this.previewAvatar.classList.remove('hidden');

          if (this.initialsPlaceholder) {
            this.initialsPlaceholder.classList.add('hidden');
          }
        }

        this.updateProgressText(this.config.translations.processingImage);

        // Auto-submit the form after preview is shown
        setTimeout(() => {
          if (this.profileForm) {
            this.log('Auto-submitting profile form');
            this.profileForm.submit();
          }
        }, 500); // Give user time to see the completion
      };

      reader.onerror = async () => {
        this.log('File read error');
        this.hideUploadProgress();

        await (window as any).dialog.showAlert(
          'File Error',
          this.config.translations.fileReadError,
          { variant: 'error' }
        );
      };

      reader.readAsDataURL(file);
    }

    /**
     * Handle avatar removal
     */
    private async handleAvatarRemoval(): Promise<void> {
      this.log('Remove button clicked');

      const confirmed = await (window as any).dialog.showConfirm(
        'Remove Avatar',
        this.config.translations.removeConfirm,
        { variant: 'danger', confirmText: 'Remove', cancelText: 'Cancel' }
      );

      if (!confirmed) {
        this.log('User cancelled avatar removal');
        return;
      }

      try {
        this.log('Sending DELETE request to:', this.config.removeAvatarUrl);

        const response = await fetch(this.config.removeAvatarUrl, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
        });

        if (response.ok) {
          this.log('Avatar removed successfully');

          if (this.previewAvatar) {
            this.previewAvatar.src = '';
            this.previewAvatar.classList.add('hidden');
          }

          if (this.initialsPlaceholder) {
            this.initialsPlaceholder.classList.remove('hidden');
          }

          if (this.removeButton) {
            this.removeButton.style.display = 'none';
          }

          window.location.reload();
        } else {
          this.log('Avatar removal failed:', response.status);

          await (window as any).dialog.showAlert(
            'Error',
            this.config.translations.removeError,
            { variant: 'error' }
          );
        }
      } catch (error) {
        console.error('Error removing avatar:', error);

        await (window as any).dialog.showAlert(
          'Error',
          this.config.translations.removeError,
          { variant: 'error' }
        );
      }
    }

    /**
     * Update progress widget text
     */
    private updateProgressText(text: string): void {
      if (!this.uploadProgressWidget) return;

      const progressText =
        this.uploadProgressWidget.querySelector('p:first-of-type');
      if (progressText) {
        progressText.textContent = text;
      }
    }

    /**
     * Hide upload progress widget
     */
    private hideUploadProgress(): void {
      if (!this.uploadProgressWidget) return;

      this.uploadProgressWidget.classList.add('hidden');

      this.updateProgressText('Uploading Profile Picture...');
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
      if (this.debug) {
        console.log('[AvatarManager]', ...args);
      }
    }
  }

  if (typeof window !== 'undefined') {
    (window as any).AvatarManager = AvatarManager;
  }

  // Module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AvatarManager;
  }
})();
