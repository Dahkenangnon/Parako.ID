/**
 * Admin Features Settings Module
 *
 * Handles features settings page functionality:
 * - Form reset with confirmation (via common.ts)
 * - Toggle provider configuration visibility
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  const providerIds = [
    'google',
    'github',
    'microsoft',
    'linkedin',
    'facebook',
  ] as const;

  interface ProviderControl {
    checkbox: HTMLInputElement | null;
    panel: HTMLElement | null;
  }

  class FeaturesSettingsManager {
    private providerControls: ProviderControl[] = [];

    public initialize(): void {
      this.cacheElements();
      this.setupProviderToggles();
      this.updateProviderVisibility();
    }

    private cacheElements(): void {
      this.providerControls = providerIds.map(providerId => ({
        checkbox: document.getElementById(
          `social_${providerId}`
        ) as HTMLInputElement | null,
        panel: document.getElementById(`${providerId}-config`),
      }));
    }

    private setupProviderToggles(): void {
      for (const control of this.providerControls) {
        control.checkbox?.addEventListener('change', () =>
          this.updateProviderVisibility()
        );
      }
    }

    private updateProviderVisibility(): void {
      for (const { checkbox, panel } of this.providerControls) {
        if (panel) {
          panel.style.display = checkbox?.checked ? 'block' : 'none';
        }
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new FeaturesSettingsManager().initialize();
  });
})();
