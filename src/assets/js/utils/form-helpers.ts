/**
 * Form Helpers Utility
 *
 * Provides common form-related functionality:
 * - Password visibility toggle
 * - Secure password generation (using crypto.getRandomValues)
 * - Password match validation
 * - Email validation
 * - Password strength calculation
 *
 * Security: Uses Web Crypto API for cryptographically secure random values
 * instead of Math.random() which is predictable.
 */
/* eslint-disable no-undef */
(function () {
  'use strict';

  // Type Definitions

  interface PasswordPolicy {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecial: boolean;
  }

  interface PasswordStrengthResult {
    score: number; // 0-100
    level: 'weak' | 'fair' | 'good' | 'strong';
    requirements: {
      length: boolean;
      uppercase: boolean;
      lowercase: boolean;
      numbers: boolean;
      special: boolean;
    };
  }

  interface ValidationResult {
    valid: boolean;
    message: string;
  }

  const CHAR_SETS = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    special: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  };

  const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecial: true,
  };

  // Password Visibility

  /**
   * Toggle password field visibility between text and password types
   * Updates the associated icon if using Lucide icons
   *
   * @param inputId - ID of the password input element
   * @param iconId - Optional ID of the icon element (defaults to inputId + '_icon')
   */
  function togglePasswordVisibility(inputId: string, iconId?: string): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const iconElementId = iconId || `${inputId}_icon`;
    const icon = document.getElementById(iconElementId);

    if (!input) {
      console.warn(`[FormHelpers] Input element '${inputId}' not found`);
      return;
    }

    if (input.type === 'password') {
      input.type = 'text';
      if (icon) {
        icon.setAttribute('data-lucide', 'eye-off');
      }
    } else {
      input.type = 'password';
      if (icon) {
        icon.setAttribute('data-lucide', 'eye');
      }
    }

    if (typeof (window as any).lucide?.createIcons === 'function') {
      (window as any).lucide.createIcons();
    }
  }

  /**
   * Get a cryptographically secure random integer in range [0, max)
   * Uses Web Crypto API for security
   */
  function getSecureRandomInt(max: number): number {
    const randomBuffer = new Uint32Array(1);
    crypto.getRandomValues(randomBuffer);
    return randomBuffer[0] % max;
  }

  /**
   * Get a random character from a string using secure random
   */
  function getSecureRandomChar(str: string): string {
    return str.charAt(getSecureRandomInt(str.length));
  }

  /**
   * Securely shuffle an array using Fisher-Yates algorithm with crypto random
   */
  function secureShuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = getSecureRandomInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Generate a cryptographically secure random password
   * Ensures password meets the specified policy requirements
   *
   * @param policy - Password policy requirements (optional)
   * @param length - Total password length (default: 12)
   * @returns Generated password string
   */
  function generateSecurePassword(
    policy: Partial<PasswordPolicy> = {},
    length: number = 12
  ): string {
    const mergedPolicy: PasswordPolicy = {
      ...DEFAULT_PASSWORD_POLICY,
      ...policy,
    };

    const effectiveLength = Math.max(length, mergedPolicy.minLength);
    const passwordChars: string[] = [];

    if (mergedPolicy.requireUppercase) {
      passwordChars.push(getSecureRandomChar(CHAR_SETS.uppercase));
    }
    if (mergedPolicy.requireLowercase) {
      passwordChars.push(getSecureRandomChar(CHAR_SETS.lowercase));
    }
    if (mergedPolicy.requireNumbers) {
      passwordChars.push(getSecureRandomChar(CHAR_SETS.numbers));
    }
    if (mergedPolicy.requireSpecial) {
      passwordChars.push(getSecureRandomChar(CHAR_SETS.special));
    }

    let allChars = '';
    if (mergedPolicy.requireUppercase) allChars += CHAR_SETS.uppercase;
    if (mergedPolicy.requireLowercase) allChars += CHAR_SETS.lowercase;
    if (mergedPolicy.requireNumbers) allChars += CHAR_SETS.numbers;
    if (mergedPolicy.requireSpecial) allChars += CHAR_SETS.special;

    if (!allChars) {
      allChars =
        CHAR_SETS.uppercase +
        CHAR_SETS.lowercase +
        CHAR_SETS.numbers +
        CHAR_SETS.special;
    }

    while (passwordChars.length < effectiveLength) {
      passwordChars.push(getSecureRandomChar(allChars));
    }

    // Securely shuffle to randomize position of required characters
    return secureShuffleArray(passwordChars).join('');
  }

  // Validation Functions

  /**
   * Validate email address format
   *
   * @param email - Email address to validate
   * @returns Validation result
   */
  function validateEmail(email: string): ValidationResult {
    if (!email || typeof email !== 'string') {
      return { valid: false, message: 'Email is required' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return { valid: false, message: 'Please enter a valid email address' };
    }

    return { valid: true, message: '' };
  }

  /**
   * Check if two passwords match
   *
   * @param password - First password
   * @param confirmPassword - Second password to compare
   * @returns Validation result
   */
  function validatePasswordMatch(
    password: string,
    confirmPassword: string
  ): ValidationResult {
    if (!password || !confirmPassword) {
      return { valid: false, message: 'Both password fields are required' };
    }

    if (password !== confirmPassword) {
      return { valid: false, message: 'Passwords do not match' };
    }

    return { valid: true, message: 'Passwords match' };
  }

  /**
   * Calculate password strength based on policy
   *
   * @param password - Password to evaluate
   * @param policy - Password policy to check against
   * @returns Strength result with score and requirements
   */
  function calculatePasswordStrength(
    password: string,
    policy: Partial<PasswordPolicy> = {}
  ): PasswordStrengthResult {
    const mergedPolicy: PasswordPolicy = {
      ...DEFAULT_PASSWORD_POLICY,
      ...policy,
    };

    const requirements = {
      length: password.length >= mergedPolicy.minLength,
      uppercase: !mergedPolicy.requireUppercase || /[A-Z]/.test(password),
      lowercase: !mergedPolicy.requireLowercase || /[a-z]/.test(password),
      numbers: !mergedPolicy.requireNumbers || /\d/.test(password),
      special:
        !mergedPolicy.requireSpecial ||
        /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
    };

    const metCount = Object.values(requirements).filter(Boolean).length;
    const totalCount = Object.keys(requirements).length;
    const score = Math.round((metCount / totalCount) * 100);

    let level: 'weak' | 'fair' | 'good' | 'strong';
    if (score < 40) {
      level = 'weak';
    } else if (score < 60) {
      level = 'fair';
    } else if (score < 80) {
      level = 'good';
    } else {
      level = 'strong';
    }

    return { score, level, requirements };
  }

  /**
   * Validate password against policy
   *
   * @param password - Password to validate
   * @param policy - Password policy requirements
   * @returns Validation result with specific message
   */
  function validatePassword(
    password: string,
    policy: Partial<PasswordPolicy> = {}
  ): ValidationResult {
    const mergedPolicy: PasswordPolicy = {
      ...DEFAULT_PASSWORD_POLICY,
      ...policy,
    };

    if (!password) {
      return { valid: false, message: 'Password is required' };
    }

    if (password.length < mergedPolicy.minLength) {
      return {
        valid: false,
        message: `Password must be at least ${mergedPolicy.minLength} characters`,
      };
    }

    if (mergedPolicy.requireUppercase && !/[A-Z]/.test(password)) {
      return {
        valid: false,
        message: 'Password must contain at least one uppercase letter',
      };
    }

    if (mergedPolicy.requireLowercase && !/[a-z]/.test(password)) {
      return {
        valid: false,
        message: 'Password must contain at least one lowercase letter',
      };
    }

    if (mergedPolicy.requireNumbers && !/\d/.test(password)) {
      return {
        valid: false,
        message: 'Password must contain at least one number',
      };
    }

    if (
      mergedPolicy.requireSpecial &&
      !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
    ) {
      return {
        valid: false,
        message: 'Password must contain at least one special character',
      };
    }

    return { valid: true, message: 'Password meets requirements' };
  }

  // DOM Helper Functions

  /**
   * Setup password match indicator on two password fields
   * Updates a visual indicator as the user types
   *
   * @param passwordId - ID of the password input
   * @param confirmId - ID of the confirm password input
   * @param indicatorId - ID of the indicator container element
   * @param textId - ID of the text element inside the indicator
   */
  function setupPasswordMatchIndicator(
    passwordId: string,
    confirmId: string,
    indicatorId: string,
    textId: string
  ): void {
    const passwordInput = document.getElementById(
      passwordId
    ) as HTMLInputElement | null;
    const confirmInput = document.getElementById(
      confirmId
    ) as HTMLInputElement | null;
    const indicator = document.getElementById(indicatorId);
    const textElement = document.getElementById(textId);

    if (!passwordInput || !confirmInput || !indicator || !textElement) {
      console.warn('[FormHelpers] Missing elements for password match setup');
      return;
    }

    const checkMatch = () => {
      const password = passwordInput.value;
      const confirm = confirmInput.value;

      if (confirm.length > 0) {
        indicator.classList.remove('hidden');
        if (password === confirm) {
          textElement.textContent = '\u2713 Passwords match';
          textElement.className = 'text-green-600 dark:text-green-400';
        } else {
          textElement.textContent = '\u2717 Passwords do not match';
          textElement.className = 'text-red-600 dark:text-red-400';
        }
      } else {
        indicator.classList.add('hidden');
      }
    };

    passwordInput.addEventListener('input', checkMatch);
    confirmInput.addEventListener('input', checkMatch);
  }

  /**
   * Setup auto-generate password functionality
   *
   * @param checkboxId - ID of the checkbox that triggers generation
   * @param passwordId - ID of the password input
   * @param confirmId - ID of the confirm password input (optional)
   * @param showDuration - Duration in ms to show the generated password (default: 3000)
   */
  function setupAutoGeneratePassword(
    checkboxId: string,
    passwordId: string,
    confirmId?: string,
    showDuration: number = 3000
  ): void {
    const checkbox = document.getElementById(
      checkboxId
    ) as HTMLInputElement | null;
    const passwordInput = document.getElementById(
      passwordId
    ) as HTMLInputElement | null;
    const confirmInput = confirmId
      ? (document.getElementById(confirmId) as HTMLInputElement | null)
      : null;

    if (!checkbox || !passwordInput) {
      console.warn(
        '[FormHelpers] Missing elements for auto-generate password setup'
      );
      return;
    }

    checkbox.addEventListener('change', function () {
      if (this.checked) {
        const newPassword = generateSecurePassword();
        passwordInput.value = newPassword;
        if (confirmInput) {
          confirmInput.value = newPassword;
        }

        // Make fields read-only while auto-generated
        passwordInput.readOnly = true;
        if (confirmInput) {
          confirmInput.readOnly = true;
        }

        passwordInput.type = 'text';
        if (confirmInput) {
          confirmInput.type = 'text';
        }

        setTimeout(() => {
          passwordInput.type = 'password';
          if (confirmInput) {
            confirmInput.type = 'password';
          }
        }, showDuration);
      } else {
        passwordInput.value = '';
        if (confirmInput) {
          confirmInput.value = '';
        }
        passwordInput.readOnly = false;
        if (confirmInput) {
          confirmInput.readOnly = false;
        }
      }

      passwordInput.dispatchEvent(new Event('input'));
      if (confirmInput) {
        confirmInput.dispatchEvent(new Event('input'));
      }
    });
  }

  const FormHelpers = {
    togglePasswordVisibility,
    generateSecurePassword,
    validateEmail,
    validatePassword,
    validatePasswordMatch,
    calculatePasswordStrength,
    setupPasswordMatchIndicator,
    setupAutoGeneratePassword,
    DEFAULT_PASSWORD_POLICY,
  };

  if (typeof window !== 'undefined') {
    (window as any).FormHelpers = FormHelpers;

    // Also expose togglePasswordVisibility directly for backwards compatibility
    // with existing onclick handlers in templates
    (window as any).togglePasswordVisibility = togglePasswordVisibility;
  }
})();
