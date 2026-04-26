/**
 * Passkeys Management
 * Handles passkey listing, renaming, and deletion in account settings
 */
/* eslint-disable no-undef */
(function () {
  'use strict';

  // Types for passkeys management
  interface PasskeysConfig {
    apiBasePath: string;
    credentialsUrl: string;
    registerUrl: string;
    csrfToken: string;
    debug: boolean;
  }

  interface PasskeysTranslations {
    loading: string;
    addPasskey: string;
    adding: string;
    rename: string;
    delete: string;
    deleteConfirmTitle: string;
    deleteConfirmMessage: string;
    successAdded: string;
    successRenamed: string;
    successDeleted: string;
    errorLoading: string;
    errorAdding: string;
    errorRenaming: string;
    errorDeleting: string;
    errorNotSupported: string;
    lastUsed: string;
    neverUsed: string;
    createdOn: string;
    platform: string;
    crossPlatform: string;
    singleDevice: string;
    multiDevice: string;
  }

  interface PasskeysState {
    config: PasskeysConfig;
    translations: PasskeysTranslations;
  }

  interface PasskeyCredential {
    credential_id: string;
    friendly_name: string;
    device_type: 'singleDevice' | 'multiDevice';
    backed_up: boolean;
    created_at: string;
    last_used_at?: string;
    transports?: string[];
  }

  interface CredentialsResponse {
    ok: boolean;
    credentials?: PasskeyCredential[];
    error?: string;
  }

  interface DeleteResponse {
    ok: boolean;
    error?: string;
  }

  interface RenameResponse {
    ok: boolean;
    error?: string;
  }

  /**
   * Passkeys Manager Class
   */
  class PasskeysManager {
    private config: PasskeysConfig;
    private translations: PasskeysTranslations;

    // DOM Elements
    private loadingEl: HTMLElement | null = null;
    private emptyStateEl: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;
    private addNewBtn: HTMLButtonElement | null = null;
    private addNewBtnEmpty: HTMLButtonElement | null = null;
    private renameModal: HTMLElement | null = null;
    private renameModalTemplate: HTMLTemplateElement | null = null;
    private passkeyItemTemplate: HTMLTemplateElement | null = null;

    private credentials: PasskeyCredential[] = [];
    private isLoading = false;
    private currentRenameId: string | null = null;

    constructor(state: PasskeysState) {
      this.config = state.config;
      this.translations = state.translations;
    }

    /**
     * Initialize the passkeys manager
     */
    public async init(): Promise<void> {
      this.loadingEl = document.getElementById('passkeys-loading');
      this.emptyStateEl = document.getElementById('passkeys-empty');
      this.listEl = document.getElementById('passkeys-list');
      this.addNewBtn = document.getElementById(
        'add-passkey-btn'
      ) as HTMLButtonElement;
      this.addNewBtnEmpty = document.getElementById(
        'add-passkey-btn-empty'
      ) as HTMLButtonElement;
      this.renameModalTemplate = document.getElementById(
        'rename-modal-template'
      ) as HTMLTemplateElement;
      this.passkeyItemTemplate = document.getElementById(
        'passkey-item-template'
      ) as HTMLTemplateElement;

      this.bindEvents();

      await this.loadCredentials();

      this.log('Passkeys Manager initialized');
    }

    /**
     * Bind event handlers
     */
    private bindEvents(): void {
      if (this.addNewBtn) {
        this.addNewBtn.addEventListener('click', () => this.addNewPasskey());
      }

      if (this.addNewBtnEmpty) {
        this.addNewBtnEmpty.addEventListener('click', () =>
          this.addNewPasskey()
        );
      }

      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && this.renameModal) {
          this.closeRenameModal();
        }
      });
    }

    /**
     * Load credentials from the server
     */
    private async loadCredentials(): Promise<void> {
      if (this.isLoading) return;

      this.isLoading = true;
      this.showLoading();

      try {
        const response = await fetch(this.config.credentialsUrl, {
          method: 'GET',
          headers: {
            'X-CSRF-Token': this.config.csrfToken,
          },
          credentials: 'include',
        });

        const result: CredentialsResponse = await response.json();

        if (!result.ok) {
          throw new Error(result.error || 'Failed to load credentials');
        }

        this.credentials = result.credentials || [];
        this.renderCredentials();
      } catch (error) {
        this.log('Error loading credentials', error);
        this.showToast(this.translations.errorLoading, 'error');
      } finally {
        this.isLoading = false;
        this.hideLoading();
      }
    }

    /**
     * Render the credentials list
     */
    private renderCredentials(): void {
      if (!this.listEl) return;

      if (this.credentials.length === 0) {
        this.showEmptyState();
        return;
      }

      this.hideEmptyState();
      this.listEl.innerHTML = '';
      this.listEl.classList.remove('hidden');

      for (const credential of this.credentials) {
        const item = this.createCredentialItem(credential);
        this.listEl.appendChild(item);
      }
    }

    /**
     * Create a credential list item element
     */
    private createCredentialItem(credential: PasskeyCredential): HTMLElement {
      // Use template if available
      if (this.passkeyItemTemplate) {
        const clone = this.passkeyItemTemplate.content.cloneNode(
          true
        ) as DocumentFragment;
        const item = clone.querySelector('.passkey-item') as HTMLElement;

        if (item) {
          item.dataset.credentialId = credential.credential_id;

          const nameEl = item.querySelector('.passkey-name');
          if (nameEl) {
            nameEl.textContent = credential.friendly_name;
          }

          const deviceEl = item.querySelector('.passkey-device');
          if (deviceEl) {
            deviceEl.textContent =
              credential.device_type === 'multiDevice'
                ? this.translations.multiDevice
                : this.translations.singleDevice;
          }

          const createdEl = item.querySelector('.passkey-created');
          if (createdEl) {
            const createdDate = new Date(
              credential.created_at
            ).toLocaleDateString();
            createdEl.textContent = `${this.translations.createdOn} ${createdDate}`;
          }

          const lastUsedEl = item.querySelector('.passkey-last-used');
          if (lastUsedEl) {
            if (credential.last_used_at) {
              const lastUsedDate = new Date(
                credential.last_used_at
              ).toLocaleDateString();
              lastUsedEl.textContent = `${this.translations.lastUsed}: ${lastUsedDate}`;
            } else {
              lastUsedEl.textContent = this.translations.neverUsed;
            }
          }

          if (credential.device_type === 'multiDevice') {
            const iconEl = item.querySelector('.passkey-icon svg');
            if (iconEl) {
              iconEl.innerHTML =
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"></path>';
            }
          }

          const renameBtn = item.querySelector(
            '.passkey-rename-btn'
          ) as HTMLButtonElement;
          const deleteBtn = item.querySelector(
            '.passkey-delete-btn'
          ) as HTMLButtonElement;

          renameBtn?.addEventListener('click', () =>
            this.openRenameModal(
              credential.credential_id,
              credential.friendly_name
            )
          );
          deleteBtn?.addEventListener('click', () =>
            this.deleteCredential(
              credential.credential_id,
              credential.friendly_name
            )
          );

          return item;
        }
      }

      // Fallback: create item manually
      return this.createCredentialItemFallback(credential);
    }

    /**
     * Create a credential list item element (fallback without template)
     */
    private createCredentialItemFallback(
      credential: PasskeyCredential
    ): HTMLElement {
      const item = document.createElement('div');
      item.className =
        'passkey-item flex items-center justify-between p-4 hover:bg-muted/50 transition-colors';
      item.dataset.credentialId = credential.credential_id;

      const createdDate = new Date(credential.created_at).toLocaleDateString();
      const lastUsedText = credential.last_used_at
        ? `${this.translations.lastUsed}: ${new Date(credential.last_used_at).toLocaleDateString()}`
        : this.translations.neverUsed;

      const deviceTypeText =
        credential.device_type === 'multiDevice'
          ? this.translations.multiDevice
          : this.translations.singleDevice;

      const iconSvg =
        credential.device_type === 'multiDevice'
          ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"></path>'
          : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"></path>';

      item.innerHTML = `
        <div class="flex items-center space-x-4">
          <div class="flex-shrink-0">
            <div class="passkey-icon bg-primary/10 p-2 rounded">
              <svg class="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                ${iconSvg}
              </svg>
            </div>
          </div>
          <div>
            <div class="passkey-name text-sm font-medium text-foreground">${this.escapeHtml(credential.friendly_name)}</div>
            <div class="flex items-center space-x-2 text-xs text-muted-foreground">
              <span class="passkey-device">${deviceTypeText}</span>
              <span>-</span>
              <span class="passkey-created">${this.translations.createdOn} ${createdDate}</span>
            </div>
            <div class="passkey-last-used text-xs text-muted-foreground mt-1">${lastUsedText}</div>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <button type="button" class="passkey-rename-btn p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="${this.translations.rename}">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
          </button>
          <button type="button" class="passkey-delete-btn p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="${this.translations.delete}">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
      `;

      const renameBtn = item.querySelector(
        '.passkey-rename-btn'
      ) as HTMLButtonElement;
      const deleteBtn = item.querySelector(
        '.passkey-delete-btn'
      ) as HTMLButtonElement;

      renameBtn?.addEventListener('click', () =>
        this.openRenameModal(credential.credential_id, credential.friendly_name)
      );
      deleteBtn?.addEventListener('click', () =>
        this.deleteCredential(
          credential.credential_id,
          credential.friendly_name
        )
      );

      return item;
    }

    /**
     * Add a new passkey - redirect to setup page
     */
    private addNewPasskey(): void {
      window.location.href = this.config.registerUrl;
    }

    /**
     * Open the rename modal
     */
    private openRenameModal(credentialId: string, currentName: string): void {
      this.currentRenameId = credentialId;

      if (this.renameModalTemplate) {
        const clone = this.renameModalTemplate.content.cloneNode(
          true
        ) as DocumentFragment;
        this.renameModal = clone.querySelector('[role="dialog"]')
          ?.parentElement as HTMLElement;

        if (this.renameModal) {
          const input = this.renameModal.querySelector(
            '#new-passkey-name'
          ) as HTMLInputElement;
          const confirmBtn = this.renameModal.querySelector(
            '#rename-confirm-btn'
          ) as HTMLButtonElement;
          const cancelBtn = this.renameModal.querySelector(
            '#rename-cancel-btn'
          ) as HTMLButtonElement;

          if (input) {
            input.value = currentName;
          }

          confirmBtn?.addEventListener('click', () => this.confirmRename());
          cancelBtn?.addEventListener('click', () => this.closeRenameModal());

          this.renameModal.addEventListener('click', e => {
            if (
              e.target ===
              this.renameModal?.querySelector('.fixed.inset-0.bg-gray-500')
            ) {
              this.closeRenameModal();
            }
          });

          document.body.appendChild(this.renameModal);

          setTimeout(() => {
            input?.focus();
            input?.select();
          }, 100);
        }
      }
    }

    /**
     * Close the rename modal
     */
    private closeRenameModal(): void {
      this.currentRenameId = null;

      if (this.renameModal) {
        this.renameModal.remove();
        this.renameModal = null;
      }
    }

    /**
     * Confirm the rename operation
     */
    private async confirmRename(): Promise<void> {
      if (!this.currentRenameId || !this.renameModal) return;

      const input = this.renameModal.querySelector(
        '#new-passkey-name'
      ) as HTMLInputElement;
      const newName = input?.value.trim();

      if (!newName) return;

      await this.renameCredential(this.currentRenameId, newName);
      this.closeRenameModal();
    }

    /**
     * Rename a credential
     */
    private async renameCredential(
      credentialId: string,
      newName: string
    ): Promise<void> {
      try {
        const response = await fetch(
          `${this.config.credentialsUrl}/${encodeURIComponent(credentialId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': this.config.csrfToken,
            },
            credentials: 'include',
            body: JSON.stringify({ friendly_name: newName }),
          }
        );

        const result: RenameResponse = await response.json();

        if (!result.ok) {
          throw new Error(result.error || 'Failed to rename credential');
        }

        const credential = this.credentials.find(
          c => c.credential_id === credentialId
        );
        if (credential) {
          credential.friendly_name = newName;
        }

        const item = this.listEl?.querySelector(
          `[data-credential-id="${credentialId}"]`
        );
        const nameEl = item?.querySelector('.passkey-name');
        if (nameEl) {
          nameEl.textContent = newName;
        }

        this.showToast(this.translations.successRenamed, 'success');
      } catch (error) {
        this.log('Error renaming credential', error);
        this.showToast(this.translations.errorRenaming, 'error');
      }
    }

    /**
     * Delete a credential
     */
    private async deleteCredential(
      credentialId: string,
      friendlyName: string
    ): Promise<void> {
      const message = `${this.translations.deleteConfirmMessage}\n\n"${friendlyName}"`;

      if (!confirm(message)) {
        return;
      }

      try {
        const response = await fetch(
          `${this.config.credentialsUrl}/${encodeURIComponent(credentialId)}`,
          {
            method: 'DELETE',
            headers: {
              'X-CSRF-Token': this.config.csrfToken,
            },
            credentials: 'include',
          }
        );

        const result: DeleteResponse = await response.json();

        if (!result.ok) {
          throw new Error(result.error || 'Failed to delete credential');
        }

        this.credentials = this.credentials.filter(
          c => c.credential_id !== credentialId
        );

        const item = this.listEl?.querySelector(
          `[data-credential-id="${credentialId}"]`
        );
        if (item) {
          item.remove();
        }

        if (this.credentials.length === 0) {
          this.showEmptyState();
        }

        this.showToast(this.translations.successDeleted, 'success');
      } catch (error) {
        this.log('Error deleting credential', error);
        this.showToast(this.translations.errorDeleting, 'error');
      }
    }

    /**
     * Show loading state
     */
    private showLoading(): void {
      if (this.loadingEl) {
        this.loadingEl.classList.remove('hidden');
      }
      if (this.listEl) {
        this.listEl.classList.add('hidden');
      }
      if (this.emptyStateEl) {
        this.emptyStateEl.classList.add('hidden');
      }
    }

    /**
     * Hide loading state
     */
    private hideLoading(): void {
      if (this.loadingEl) {
        this.loadingEl.classList.add('hidden');
      }
    }

    /**
     * Show empty state
     */
    private showEmptyState(): void {
      if (this.emptyStateEl) {
        this.emptyStateEl.classList.remove('hidden');
      }
      if (this.listEl) {
        this.listEl.classList.add('hidden');
      }
    }

    /**
     * Hide empty state
     */
    private hideEmptyState(): void {
      if (this.emptyStateEl) {
        this.emptyStateEl.classList.add('hidden');
      }
    }

    /**
     * Show a toast notification
     */
    private showToast(message: string, type: 'success' | 'error'): void {
      const toast = document.createElement('div');
      toast.className = `fixed bottom-4 right-4 px-4 py-3 border-2 shadow-lg z-50 ${
        type === 'success'
          ? 'bg-green-50 dark:bg-green-900/20 border-green-500 text-green-800 dark:text-green-200'
          : 'bg-red-50 dark:bg-red-900/20 border-red-500 text-red-800 dark:text-red-200'
      }`;

      const iconPath =
        type === 'success' ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12';

      toast.innerHTML = `
        <div class="flex items-center">
          <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"></path>
          </svg>
          <span class="text-sm">${this.escapeHtml(message)}</span>
        </div>
      `;

      document.body.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 3000);
    }

    /**
     * Escape HTML to prevent XSS
     */
    private escapeHtml(text: string): string {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    /**
     * Debug logging
     */
    private log(message: string, data?: unknown): void {
      if (this.config.debug) {
        console.log(`[Passkeys] ${message}`, data || '');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateEl = document.getElementById('___PASSKEYS_STATE___');
    if (!stateEl) {
      console.error('[Passkeys] State element not found');
      return;
    }

    try {
      const state: PasskeysState = JSON.parse(stateEl.textContent || '{}');
      const manager = new PasskeysManager(state);
      manager.init();
    } catch (error) {
      console.error('[Passkeys] Failed to initialize:', error);
    }
  });
})();
