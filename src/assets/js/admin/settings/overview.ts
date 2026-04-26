/**
 * Admin Settings Overview Module
 *
 * Handles settings overview page functionality:
 * - Configuration reload
 * - Version history toggle
 * - Configuration rollback
 * - Configuration export
 * - Health check with real-time status
 * - Custom confirmation dialogs
 */
(function () {
  'use strict';

  interface LucideApi {
    createIcons: () => void;
  }

  interface WindowWithLucide {
    lucide?: LucideApi;
    reloadConfig: () => Promise<void>;
    toggleVersionHistory: () => void;
    confirmRollback: (
      versionId: string,
      versionNumber: string
    ) => Promise<void>;
    exportConfig: () => Promise<void>;
    checkHealth: () => Promise<void>;
    hideHealthCheck: () => void;
  }

  interface HealthCheckResponse {
    status: string;
    checks: Record<string, boolean | null>;
    provider: string;
    responseTime: number;
  }

  interface CheckStatusInfo {
    label: string;
    description: string;
    icon: string;
    color: string;
    statusText: string;
    badgeClass: string;
  }

  class SettingsOverviewManager {
    private versionHistory: HTMLElement | null = null;
    private historyToggleText: HTMLElement | null = null;
    private healthCheckSection: HTMLElement | null = null;
    private healthCheckResults: HTMLElement | null = null;
    private healthStatusBadge: HTMLElement | null = null;

    private readonly checkLabels: Record<string, string> = {
      configLoaded: 'Configuration',
      databaseConnectivity: 'Database',
      smtpConnectivity: 'SMTP',
      oidcStorageConnectivity: 'OIDC Storage',
      oidcIssuerReachable: 'OIDC Issuer',
    };

    private readonly checkDescriptions: Record<string, string> = {
      configLoaded: 'Configuration loaded',
      databaseConnectivity: 'MongoDB connection',
      smtpConnectivity: 'Email service',
      oidcStorageConnectivity: 'Token storage',
      oidcIssuerReachable: 'Discovery endpoint',
    };

    public initialize(): void {
      this.cacheElements();
      this.exposeGlobalMethods();
    }

    private cacheElements(): void {
      this.versionHistory = document.getElementById('versionHistory');
      this.historyToggleText = document.getElementById('historyToggleText');
      this.healthCheckSection = document.getElementById('healthCheckSection');
      this.healthCheckResults = document.getElementById('healthCheckResults');
      this.healthStatusBadge = document.getElementById('healthStatusBadge');
    }

    public async reloadConfig(): Promise<void> {
      const confirmed = await this.showConfirmDialog(
        'Reload Configuration',
        'Reload the configuration from the database? Unsaved changes will be lost.',
        'Reload',
        'Cancel'
      );

      if (confirmed) {
        this.submitFormAction('/admin/settings/reload');
      }
    }

    public toggleVersionHistory(): void {
      if (!this.versionHistory) return;

      const isVisible = this.versionHistory.style.display !== 'none';

      if (isVisible) {
        this.versionHistory.style.display = 'none';
        if (this.historyToggleText)
          this.historyToggleText.textContent = 'History';
      } else {
        this.versionHistory.style.display = 'block';
        if (this.historyToggleText) this.historyToggleText.textContent = 'Hide';
        this.refreshIcons();
      }
    }

    public async confirmRollback(
      versionId: string,
      versionNumber: string
    ): Promise<void> {
      const confirmed = await this.showConfirmDialog(
        'Rollback to v' + versionNumber,
        'Restore all settings to this version? Current state will be backed up.',
        'Rollback',
        'Cancel'
      );

      if (confirmed) {
        this.performRollback(versionId);
      }
    }

    private performRollback(versionId: string): void {
      this.submitFormAction('/admin/settings/rollback', { versionId });
    }

    private submitFormAction(
      action: string,
      data?: Record<string, string>
    ): void {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = action;

      const csrfMeta = document.querySelector(
        'meta[name="csrf-token"]'
      ) as HTMLElement | null;
      if (csrfMeta) {
        const csrfInput = document.createElement('input');
        csrfInput.type = 'hidden';
        csrfInput.name = '_csrf';
        csrfInput.value = csrfMeta.getAttribute('content') || '';
        form.appendChild(csrfInput);
      }

      if (data) {
        for (const [key, value] of Object.entries(data)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = value;
          form.appendChild(input);
        }
      }

      document.body.appendChild(form);
      form.submit();
    }

    public async exportConfig(): Promise<void> {
      const confirmed = await this.showConfirmDialog(
        'Export Configuration',
        'Download current configuration as JSON? Sensitive fields will be masked.',
        'Export',
        'Cancel'
      );

      if (confirmed) {
        window.location.href = '/admin/settings/export';
      }
    }

    public hideHealthCheck(): void {
      if (this.healthCheckSection) {
        this.healthCheckSection.style.display = 'none';
      }
    }

    public async checkHealth(): Promise<void> {
      if (
        !this.healthCheckSection ||
        !this.healthCheckResults ||
        !this.healthStatusBadge
      )
        return;

      this.healthCheckSection.style.display = 'block';

      this.healthStatusBadge.innerHTML =
        '<i data-lucide="loader" class="h-3 w-3 mr-1 animate-spin"></i>Checking...';
      this.healthStatusBadge.className =
        'inline-flex items-center px-2 py-1 text-xs font-medium bg-muted text-muted-foreground';

      this.healthCheckResults.innerHTML = `
        <div class="flex items-center justify-center py-8">
          <i data-lucide="loader" class="h-8 w-8 text-muted-foreground animate-spin"></i>
        </div>
      `;

      this.refreshIcons();

      try {
        const response = await fetch('/admin/settings/health', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        const data: HealthCheckResponse = await response.json();

        const isHealthy = data.status === 'healthy';
        this.healthStatusBadge.innerHTML = `<i data-lucide="${isHealthy ? 'check-circle' : 'alert-circle'}" class="h-3 w-3 mr-1"></i>${isHealthy ? 'Healthy' : 'Unhealthy'}`;
        this.healthStatusBadge.className = `inline-flex items-center px-2 py-1 text-xs font-medium ${
          isHealthy
            ? 'bg-primary/10 text-primary'
            : 'bg-destructive/10 text-destructive'
        }`;

        const checksHtml = Object.entries(data.checks)
          .map(([name, status]) => {
            const statusInfo = this.getCheckStatusInfo(name, status);
            return `
            <div class="flex items-center justify-between p-3 bg-muted/30">
              <div class="flex items-center gap-3">
                <i data-lucide="${statusInfo.icon}" class="h-5 w-5 ${statusInfo.color}"></i>
                <div>
                  <div class="text-sm font-medium text-foreground">${this.escapeHtml(statusInfo.label)}</div>
                  <div class="text-xs text-muted-foreground">${this.escapeHtml(statusInfo.description)}</div>
                </div>
              </div>
              <span class="inline-flex items-center px-2 py-1 text-xs font-medium ${statusInfo.badgeClass}">
                ${this.escapeHtml(statusInfo.statusText)}
              </span>
            </div>
          `;
          })
          .join('');

        this.healthCheckResults.innerHTML = `
          <div class="space-y-3">
            ${checksHtml}
          </div>
          <div class="mt-6 pt-4 border-t border-border grid grid-cols-2 gap-4 text-xs">
            <div>
              <span class="text-muted-foreground">Provider:</span>
              <span class="ml-2 font-medium text-foreground">${this.escapeHtml(data.provider)}</span>
            </div>
            <div>
              <span class="text-muted-foreground">Response:</span>
              <span class="ml-2 font-medium text-foreground">${this.escapeHtml(String(data.responseTime))}ms</span>
            </div>
          </div>
        `;

        this.refreshIcons();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'An unknown error occurred';

        this.healthStatusBadge.innerHTML =
          '<i data-lucide="x-circle" class="h-3 w-3 mr-1"></i>Error';
        this.healthStatusBadge.className =
          'inline-flex items-center px-2 py-1 text-xs font-medium bg-destructive/10 text-destructive';

        this.healthCheckResults.innerHTML = `
          <div class="flex flex-col items-center justify-center py-8 text-center">
            <i data-lucide="alert-triangle" class="h-12 w-12 text-warning mb-3"></i>
            <p class="text-sm font-medium text-foreground mb-1">Failed to perform health check</p>
            <p class="text-xs text-muted-foreground">${this.escapeHtml(errorMessage)}</p>
          </div>
        `;

        this.refreshIcons();
      }
    }

    private getCheckStatusInfo(
      name: string,
      status: boolean | null
    ): CheckStatusInfo {
      let icon: string, color: string, statusText: string, badgeClass: string;

      if (status === null) {
        icon = 'minus-circle';
        color = 'text-muted-foreground';
        statusText = 'Not Configured';
        badgeClass = 'bg-muted text-muted-foreground';
      } else if (status === true) {
        icon = 'check-circle';
        color = 'text-primary';
        statusText = 'Healthy';
        badgeClass = 'bg-primary/10 text-primary';
      } else {
        icon = 'x-circle';
        color = 'text-destructive';
        statusText = 'Failed';
        badgeClass = 'bg-destructive/10 text-destructive';
      }

      return {
        label: this.checkLabels[name] || name,
        description: this.checkDescriptions[name] || '',
        icon,
        color,
        statusText,
        badgeClass,
      };
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
        header.className =
          'flex items-center justify-between p-4 border-b border-border';

        const headerTitle = document.createElement('h3');
        headerTitle.className = 'text-lg font-semibold text-foreground';
        headerTitle.textContent = title;

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'text-muted-foreground hover:text-foreground';
        closeButton.innerHTML = '<i data-lucide="x" class="h-5 w-5"></i>';
        closeButton.onclick = () => cleanup(false);

        header.appendChild(headerTitle);
        header.appendChild(closeButton);

        const body = document.createElement('div');
        body.className = 'p-4 text-sm text-muted-foreground';
        body.textContent = message;

        const footer = document.createElement('div');
        footer.className =
          'flex items-center justify-end gap-3 p-4 border-t border-border';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className =
          'px-4 py-2 text-sm font-medium text-foreground bg-background hover:border-primary border border-border';
        cancelButton.textContent = cancelText;
        cancelButton.onclick = () => cleanup(false);

        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className =
          'px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90';
        confirmButton.textContent = confirmText;
        confirmButton.onclick = () => cleanup(true);

        footer.appendChild(cancelButton);
        footer.appendChild(confirmButton);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);

        document.body.appendChild(backdrop);

        this.refreshIcons();

        confirmButton.focus();

        const handleEscape = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            cleanup(false);
          }
        };
        document.addEventListener('keydown', handleEscape);

        const cleanup = (confirmed: boolean) => {
          document.removeEventListener('keydown', handleEscape);
          document.body.removeChild(backdrop);
          resolve(confirmed);
        };
      });
    }

    private escapeHtml(text: string): string {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    private refreshIcons(): void {
      const win = window as unknown as WindowWithLucide;
      if (win.lucide && typeof win.lucide.createIcons === 'function') {
        win.lucide.createIcons();
      }
    }

    private exposeGlobalMethods(): void {
      const win = window as unknown as WindowWithLucide;
      win.reloadConfig = this.reloadConfig.bind(this);
      win.toggleVersionHistory = this.toggleVersionHistory.bind(this);
      win.confirmRollback = this.confirmRollback.bind(this);
      win.exportConfig = this.exportConfig.bind(this);
      win.checkHealth = this.checkHealth.bind(this);
      win.hideHealthCheck = this.hideHealthCheck.bind(this);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new SettingsOverviewManager().initialize();
  });
})();
