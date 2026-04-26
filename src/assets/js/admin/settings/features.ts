/**
 * Admin Features Settings Module
 *
 * Handles features settings page functionality:
 * - Form reset with confirmation (via common.ts)
 * - Toggle provider configuration visibility
 */
(function () {
  'use strict';

  class FeaturesSettingsManager {
    private googleCheckbox: HTMLInputElement | null = null;
    private githubCheckbox: HTMLInputElement | null = null;
    private googleConfig: HTMLElement | null = null;
    private githubConfig: HTMLElement | null = null;

    public initialize(): void {
      this.cacheElements();
      this.setupProviderToggles();
      this.updateProviderVisibility();
    }

    private cacheElements(): void {
      this.googleCheckbox = document.getElementById(
        'social_google'
      ) as HTMLInputElement | null;
      this.githubCheckbox = document.getElementById(
        'social_github'
      ) as HTMLInputElement | null;
      this.googleConfig = document.getElementById('google-config');
      this.githubConfig = document.getElementById('github-config');
    }

    private setupProviderToggles(): void {
      this.googleCheckbox?.addEventListener('change', () =>
        this.updateProviderVisibility()
      );
      this.githubCheckbox?.addEventListener('change', () =>
        this.updateProviderVisibility()
      );
    }

    private updateProviderVisibility(): void {
      if (this.googleConfig) {
        this.googleConfig.style.display = this.googleCheckbox?.checked
          ? 'block'
          : 'none';
      }
      if (this.githubConfig) {
        this.githubConfig.style.display = this.githubCheckbox?.checked
          ? 'block'
          : 'none';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    new FeaturesSettingsManager().initialize();
  });
})();
