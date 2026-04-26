/**
 * Admin Import Settings Module
 *
 * Handles configuration import page functionality:
 * - File loading and validation
 * - Configuration preview with diff
 * - Impact analysis display
 * - Configuration application
 * - Custom confirmation dialogs
 * - Notification system
 */
(function () {
  'use strict';

  interface LucideApi {
    createIcons: () => void;
  }

  interface WindowWithLucide {
    lucide?: LucideApi;
    loadFromFile: () => void;
    clearForm: () => void;
    previewImport: () => Promise<void>;
    applyConfigImport: () => Promise<void>;
  }

  interface DiffChange {
    field: string;
    changeType: 'added' | 'modified' | 'removed';
    oldValue?: unknown;
    newValue?: unknown;
  }

  interface Impact {
    requiresRestart: boolean;
    affectedServices?: string[];
    warnings?: string[];
  }

  interface PreviewData {
    success: boolean;
    diff: DiffChange[];
    impact: Impact;
    changeCount: number;
    message?: string;
    error?: string;
  }

  class ConfigImportManager {
    private currentPreviewData: PreviewData | null = null;
    private configFileInput: HTMLInputElement | null = null;
    private configJsonTextarea: HTMLInputElement | null = null;
    private previewSection: HTMLElement | null = null;
    private impactContent: HTMLElement | null = null;
    private diffContent: HTMLElement | null = null;
    private applyButton: HTMLButtonElement | null = null;

    public initialize(): void {
      this.cacheElements();
      this.exposeGlobalMethods();
    }

    private cacheElements(): void {
      this.configFileInput = document.getElementById(
        'configFile'
      ) as HTMLInputElement | null;
      this.configJsonTextarea = document.getElementById(
        'configJson'
      ) as HTMLInputElement | null;
      this.previewSection = document.getElementById('previewSection');
      this.impactContent = document.getElementById('impactContent');
      this.diffContent = document.getElementById('diffContent');
      this.applyButton = document.getElementById(
        'applyButton'
      ) as HTMLButtonElement | null;
    }

    public loadFromFile(): void {
      const file = this.configFileInput?.files?.[0];

      if (!file) {
        this.showNotification('Please select a file first', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = e => {
        try {
          const content = e.target?.result as string;
          JSON.parse(content);
          if (this.configJsonTextarea) {
            this.configJsonTextarea.value = content;
          }
          this.showNotification(
            'File loaded successfully. Click "Preview Changes" to continue.',
            'success'
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.showNotification('Invalid JSON file: ' + errorMessage, 'error');
        }
      };
      reader.onerror = () => {
        this.showNotification('Failed to read file', 'error');
      };
      reader.readAsText(file);
    }

    public clearForm(): void {
      if (this.configFileInput) {
        this.configFileInput.value = '';
      }
      if (this.configJsonTextarea) {
        this.configJsonTextarea.value = '';
      }
      this.hidePreview();
    }

    public async previewImport(): Promise<void> {
      const configJson = this.configJsonTextarea?.value.trim();

      if (!configJson) {
        this.showNotification('Please provide a configuration JSON', 'error');
        return;
      }

      let configData: unknown;
      try {
        configData = JSON.parse(configJson);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.showNotification('Invalid JSON format: ' + errorMessage, 'error');
        return;
      }

      if (this.previewSection) {
        this.previewSection.classList.remove('hidden');
      }
      if (this.impactContent) {
        this.impactContent.innerHTML =
          '<div class="text-muted-foreground">Analyzing changes...</div>';
      }
      if (this.diffContent) {
        this.diffContent.innerHTML =
          '<div class="text-muted-foreground">Generating diff...</div>';
      }

      try {
        // Get CSRF token
        const csrfMeta = document.querySelector(
          'meta[name="csrf-token"]'
        ) as HTMLElement | null;
        const csrfToken = csrfMeta?.getAttribute('content') || '';

        const response = await fetch('/admin/settings/import/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ config: configData }),
        });

        const responseText = await response.text();

        if (!response.ok) {
          throw new Error(
            `Server returned ${response.status}: ${responseText.substring(0, 200)}`
          );
        }

        let result: PreviewData;
        try {
          result = JSON.parse(responseText);
        } catch {
          throw new Error(
            'Server returned invalid JSON. Check console for details.'
          );
        }

        if (!result.success) {
          throw new Error(result.message || result.error || 'Preview failed');
        }

        this.currentPreviewData = result;

        this.displayImportPreview(result);

        this.previewSection?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.showNotification(
          'Failed to preview import: ' + errorMessage,
          'error'
        );
        this.hidePreview();
      }
    }

    private displayImportPreview(data: PreviewData): void {
      const { diff, impact } = data;

      let impactHtml = '';

      if (impact.requiresRestart) {
        impactHtml += `
          <div class="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <i data-lucide="alert-circle" class="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"></i>
            <div>
              <p class="text-sm font-medium text-amber-900 dark:text-amber-300">Server Restart Required</p>
              <p class="text-sm text-amber-700 dark:text-amber-400 mt-1">
                The application will need to be restarted for these changes to take effect.
              </p>
            </div>
          </div>
        `;
      }

      if (impact.affectedServices && impact.affectedServices.length > 0) {
        impactHtml += `
          <div class="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <i data-lucide="server" class="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"></i>
            <div>
              <p class="text-sm font-medium text-blue-900 dark:text-blue-300">Affected Services</p>
              <ul class="text-sm text-blue-700 dark:text-blue-400 mt-1 list-disc list-inside">
                ${impact.affectedServices.map(service => `<li>${this.escapeHtml(service)}</li>`).join('')}
              </ul>
            </div>
          </div>
        `;
      }

      if (impact.warnings && impact.warnings.length > 0) {
        impactHtml += `
          <div class="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <i data-lucide="alert-triangle" class="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"></i>
            <div>
              <p class="text-sm font-medium text-red-900 dark:text-red-300">Warnings</p>
              <ul class="text-sm text-red-700 dark:text-red-400 mt-1 list-disc list-inside">
                ${impact.warnings.map(warning => `<li>${this.escapeHtml(warning)}</li>`).join('')}
              </ul>
            </div>
          </div>
        `;
      }

      if (!impactHtml) {
        impactHtml =
          '<p class="text-sm text-muted-foreground">No significant impact detected.</p>';
      }

      if (this.impactContent) {
        this.impactContent.innerHTML = impactHtml;
      }

      let diffHtml = '';

      if (!diff || diff.length === 0) {
        diffHtml =
          '<p class="text-sm text-muted-foreground">No changes detected.</p>';
      } else {
        diffHtml = '<div class="space-y-2 max-h-96 overflow-y-auto">';

        diff.forEach(change => {
          let bgColor: string, textColor: string, icon: string;

          if (change.changeType === 'added') {
            bgColor =
              'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
            textColor = 'text-green-900 dark:text-green-300';
            icon = 'plus';
          } else if (change.changeType === 'modified') {
            bgColor =
              'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
            textColor = 'text-blue-900 dark:text-blue-300';
            icon = 'edit';
          } else {
            bgColor =
              'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
            textColor = 'text-red-900 dark:text-red-300';
            icon = 'minus';
          }

          diffHtml += `
            <div class="flex items-start gap-3 p-3 ${bgColor} border">
              <i data-lucide="${icon}" class="h-4 w-4 ${textColor} flex-shrink-0 mt-0.5"></i>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium ${textColor} font-mono break-all">${this.escapeHtml(change.field)}</p>
                ${
                  change.oldValue !== undefined
                    ? `
                  <p class="text-xs text-muted-foreground mt-1">
                    <span class="font-medium">Old:</span>
                    <code class="bg-background/50 px-1 py-0.5">${this.escapeHtml(JSON.stringify(change.oldValue))}</code>
                  </p>
                `
                    : ''
                }
                ${
                  change.newValue !== undefined
                    ? `
                  <p class="text-xs text-muted-foreground mt-1">
                    <span class="font-medium">New:</span>
                    <code class="bg-background/50 px-1 py-0.5">${this.escapeHtml(JSON.stringify(change.newValue))}</code>
                  </p>
                `
                    : ''
                }
              </div>
            </div>
          `;
        });

        diffHtml += '</div>';
      }

      if (this.diffContent) {
        this.diffContent.innerHTML = diffHtml;
      }

      // Re-initialize Lucide icons
      this.refreshIcons();
    }

    private escapeHtml(text: string): string {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    private hidePreview(): void {
      this.previewSection?.classList.add('hidden');
      this.currentPreviewData = null;
    }

    public async applyConfigImport(): Promise<void> {
      if (!this.currentPreviewData) {
        this.showNotification(
          'No preview data available. Please preview first.',
          'error'
        );
        return;
      }

      let message =
        'Are you sure you want to apply this configuration?\n\n' +
        'A backup of the current configuration will be created automatically.';

      if (this.currentPreviewData.impact.requiresRestart) {
        message +=
          '\n\n⚠️ WARNING: The application will need to be restarted after applying changes.';
      }

      const confirmed = await this.showConfirmDialog(
        'Apply Configuration Import',
        message,
        'Yes, Apply Changes',
        'Cancel'
      );

      if (!confirmed) {
        return;
      }

      if (!this.applyButton) return;

      const originalText = this.applyButton.innerHTML;
      this.applyButton.disabled = true;
      this.applyButton.innerHTML =
        '<i data-lucide="loader" class="h-4 w-4 mr-2 animate-spin"></i>Applying...';

      try {
        // Get CSRF token
        const csrfMeta = document.querySelector(
          'meta[name="csrf-token"]'
        ) as HTMLElement | null;
        const csrfToken = csrfMeta?.getAttribute('content') || '';

        const configJson = this.configJsonTextarea?.value.trim();
        if (!configJson) {
          throw new Error('No configuration data');
        }
        const configData = JSON.parse(configJson);

        const response = await fetch('/admin/settings/import/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ config: configData }),
        });

        const responseText = await response.text();

        if (!response.ok) {
          throw new Error(
            `Server returned ${response.status}: ${responseText.substring(0, 200)}`
          );
        }

        let result: { success: boolean; message?: string };
        try {
          result = JSON.parse(responseText);
        } catch {
          throw new Error(
            'Server returned invalid JSON. Check console for details.'
          );
        }

        if (!result.success) {
          throw new Error(result.message || 'Failed to apply configuration');
        }

        this.showNotification('Configuration applied successfully!', 'success');

        setTimeout(() => {
          window.location.href = '/admin/settings';
        }, 2000);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.showNotification(
          'Failed to apply configuration: ' + errorMessage,
          'error'
        );

        // Re-enable button
        this.applyButton.disabled = false;
        this.applyButton.innerHTML = originalText;

        // Re-initialize Lucide icons
        this.refreshIcons();
      }
    }

    private showConfirmDialog(
      title: string,
      message: string,
      confirmText = 'Confirm',
      cancelText = 'Cancel'
    ): Promise<boolean> {
      return new Promise(resolve => {
        const backdrop = document.createElement('div');
        backdrop.className =
          'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';

        const modal = document.createElement('div');
        modal.className = 'bg-card border border-border max-w-md w-full';

        const header = document.createElement('div');
        header.className = 'flex items-start gap-3 p-6 pb-4';

        const iconContainer = document.createElement('div');
        iconContainer.className = 'flex-shrink-0 mt-0.5';
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', 'alert-triangle');
        icon.className = 'h-6 w-6 text-amber-500';
        iconContainer.appendChild(icon);

        const titleElement = document.createElement('h3');
        titleElement.className = 'font-semibold text-lg flex-1 text-foreground';
        titleElement.textContent = title;

        header.appendChild(iconContainer);
        header.appendChild(titleElement);

        const body = document.createElement('div');
        body.className = 'px-6 pb-4';
        const messageElement = document.createElement('p');
        messageElement.className =
          'text-sm text-muted-foreground whitespace-pre-line';
        messageElement.textContent = message;
        body.appendChild(messageElement);

        const footer = document.createElement('div');
        footer.className =
          'flex justify-end gap-2 p-6 pt-4 border-t border-border';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className =
          'px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80';
        cancelButton.textContent = cancelText;

        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className =
          'px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700';
        confirmButton.textContent = confirmText;

        footer.appendChild(cancelButton);
        footer.appendChild(confirmButton);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);

        const cleanup = () => {
          backdrop.remove();
        };

        cancelButton.addEventListener('click', () => {
          cleanup();
          resolve(false);
        });

        confirmButton.addEventListener('click', () => {
          cleanup();
          resolve(true);
        });

        backdrop.addEventListener('click', e => {
          if (e.target === backdrop) {
            cleanup();
            resolve(false);
          }
        });

        document.body.appendChild(backdrop);

        this.refreshIcons();

        confirmButton.focus();
      });
    }

    private showNotification(
      message: string,
      type: 'info' | 'success' | 'error' = 'info'
    ): void {
      const notification = document.createElement('div');
      notification.className = `fixed top-4 right-4 z-50 max-w-md p-4 border ${
        type === 'success'
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-900 dark:text-green-300'
          : type === 'error'
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-900 dark:text-red-300'
            : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-300'
      }`;

      const iconName =
        type === 'success'
          ? 'check-circle'
          : type === 'error'
            ? 'x-circle'
            : 'info';

      notification.innerHTML = `
        <div class="flex items-start gap-3">
          <i data-lucide="${iconName}" class="h-5 w-5 flex-shrink-0 mt-0.5"></i>
          <div class="flex-1">
            <p class="text-sm font-medium">${this.escapeHtml(message)}</p>
          </div>
          <button type="button" class="text-current hover:opacity-70 close-notification">
            <i data-lucide="x" class="h-4 w-4"></i>
          </button>
        </div>
      `;

      const closeButton = notification.querySelector('.close-notification');
      closeButton?.addEventListener('click', () => notification.remove());

      document.body.appendChild(notification);

      this.refreshIcons();

      // Auto-remove after 5 seconds
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, 5000);
    }

    private refreshIcons(): void {
      const win = window as unknown as WindowWithLucide;
      if (win.lucide && typeof win.lucide.createIcons === 'function') {
        win.lucide.createIcons();
      }
    }

    private exposeGlobalMethods(): void {
      const win = window as unknown as WindowWithLucide;
      win.loadFromFile = this.loadFromFile.bind(this);
      win.clearForm = this.clearForm.bind(this);
      win.previewImport = this.previewImport.bind(this);
      win.applyConfigImport = this.applyConfigImport.bind(this);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new ConfigImportManager().initialize();
  });
})();
