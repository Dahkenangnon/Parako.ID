/**
 * PasswordVisibilityToggle - Manages password field visibility toggles
 *
 * Features:
 * - Show/hide password text with eye icon toggle
 * - Dynamic SVG icon updates (eye vs eye-off)
 * - Data attribute-based target input selection
 * - Support for multiple password fields on same page
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  /**
   * Configuration interface for PasswordVisibilityToggle
   */
  interface PasswordVisibilityConfig {
    debug?: boolean;
  }

  /**
   * SVG icon paths for eye icons
   */
  const EYE_ICON_VISIBLE = `
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
  `;

  const EYE_ICON_HIDDEN = `
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l9.644-9.644"></path>
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4"></path>
  `;

  /**
   * PasswordVisibilityToggle class - Handles password visibility toggles
   */
  class PasswordVisibilityToggle {
    private debug: boolean;

    constructor(config: PasswordVisibilityConfig = {}) {
      this.debug = config.debug || false;
    }

    /**
     * Initialize the password visibility toggles
     */
    public initialize(): void {
      this.log('Initializing PasswordVisibilityToggle');

      const passwordToggles = document.querySelectorAll('.password-toggle');

      this.log(`Found ${passwordToggles.length} password toggle buttons`);

      passwordToggles.forEach(button => {
        this.setupToggleButton(button as HTMLButtonElement);
      });
    }

    /**
     * Setup a single toggle button
     */
    private setupToggleButton(button: HTMLButtonElement): void {
      const targetId = button.getAttribute('data-target');

      if (!targetId) {
        console.warn(
          '[PasswordVisibilityToggle] Toggle button missing data-target attribute:',
          button
        );
        return;
      }

      const targetInput = document.getElementById(targetId) as HTMLInputElement;

      if (!targetInput) {
        console.warn(
          '[PasswordVisibilityToggle] Target input not found:',
          targetId
        );
        return;
      }

      button.addEventListener('click', () => {
        this.togglePasswordVisibility(button, targetInput);
      });

      this.log('Setup toggle button for input:', targetId);
    }

    /**
     * Toggle password visibility for a specific input
     */
    private togglePasswordVisibility(
      button: HTMLButtonElement,
      targetInput: HTMLInputElement
    ): void {
      const isVisible = targetInput.type === 'text';

      targetInput.type = isVisible ? 'password' : 'text';

      const svg = button.querySelector('svg');

      if (svg) {
        if (isVisible) {
          svg.innerHTML = EYE_ICON_VISIBLE;
          this.log('Password hidden for:', targetInput.id);
        } else {
          svg.innerHTML = EYE_ICON_HIDDEN;
          this.log('Password visible for:', targetInput.id);
        }
      }
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
      if (this.debug) {
        console.log('[PasswordVisibilityToggle]', ...args);
      }
    }
  }

  if (typeof window !== 'undefined') {
    (window as any).PasswordVisibilityToggle = PasswordVisibilityToggle;
  }

  // Module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PasswordVisibilityToggle;
  }
})();
