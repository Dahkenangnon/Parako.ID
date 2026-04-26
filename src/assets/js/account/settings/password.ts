/**
 * PasswordValidator - Manages password confirmation validation
 *
 * Features:
 * - Real-time password confirmation matching
 * - Custom validation messages
 * - Special case handling for users without existing passwords
 * - Integration with HTML5 form validation API
 *
 * @version 1.0.0
 * @author Parako.ID Team
 */

(function () {
  'use strict';

  /**
   * Configuration interface for PasswordValidator
   */
  interface PasswordValidatorConfig {
    isSpecialPasswordCase: boolean;
    translations: {
      passwordMismatch: string;
    };
    debug?: boolean;
  }

  /**
   * PasswordValidator class - Handles password validation
   */
  class PasswordValidator {
    private config: PasswordValidatorConfig;
    private debug: boolean;
    private newPassword: HTMLInputElement | null;
    private confirmPassword: HTMLInputElement | null;
    private currentPassword: HTMLInputElement | null;

    constructor(config: PasswordValidatorConfig) {
      this.config = config;
      this.debug = config.debug || false;
      this.newPassword = null;
      this.confirmPassword = null;
      this.currentPassword = null;
    }

    /**
     * Initialize the password validator
     */
    public initialize(): void {
      this.log('Initializing PasswordValidator');

      this.newPassword = document.getElementById(
        'new-password'
      ) as HTMLInputElement;
      this.confirmPassword = document.getElementById(
        'confirm-password'
      ) as HTMLInputElement;
      this.currentPassword = document.getElementById(
        'current-password'
      ) as HTMLInputElement;

      this.setupPasswordMatchValidation();
      this.handleSpecialPasswordCase();
    }

    /**
     * Setup password confirmation matching validation
     */
    private setupPasswordMatchValidation(): void {
      if (!this.newPassword || !this.confirmPassword) {
        this.log('Password inputs not found, skipping validation setup');
        return;
      }

      this.newPassword.addEventListener('input', () => {
        this.validatePasswordMatch();
      });

      this.confirmPassword.addEventListener('input', () => {
        this.validatePasswordMatch();
      });

      this.log('Password match validation setup complete');
    }

    /**
     * Validate password confirmation match
     */
    private validatePasswordMatch(): void {
      if (!this.newPassword || !this.confirmPassword) return;

      if (this.newPassword.value !== this.confirmPassword.value) {
        this.confirmPassword.setCustomValidity(
          this.config.translations.passwordMismatch
        );
        this.log('Password mismatch detected');
      } else {
        this.confirmPassword.setCustomValidity('');
        this.log('Passwords match');
      }
    }

    /**
     * Handle special case where current password is not required
     * (e.g., user registered via social login and has no password set)
     */
    private handleSpecialPasswordCase(): void {
      if (!this.config.isSpecialPasswordCase) {
        this.log('Not a special password case');
        return;
      }

      if (this.currentPassword) {
        this.currentPassword.removeAttribute('required');
        this.log(
          'Removed required attribute from current password (special case)'
        );
      }
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
      if (this.debug) {
        console.log('[PasswordValidator]', ...args);
      }
    }
  }

  if (typeof window !== 'undefined') {
    (window as any).PasswordValidator = PasswordValidator;
  }

  // Module export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PasswordValidator;
  }
})();
