/**
 * Admin Users Form Manager
 *
 * Handles user create/edit form functionality:
 * - Password visibility toggle
 * - Password generation with crypto.getRandomValues
 * - Password matching validation
 * - Form validation with dialog alerts
 * - Textarea auto-resize
 */
(function () {
  'use strict';

  // Type Definitions

  interface UsersFormConfig {
    isCreateForm: boolean;
    translations: TranslationStrings;
  }

  interface TranslationStrings {
    validationError: string;
    requiredFields: string;
    invalidEmail: string;
    invalidEmailMessage: string;
    invalidPassword: string;
    passwordMinLength: string;
    passwordMismatch: string;
    passwordMismatchMessage: string;
    weakPassword: string;
    weakPasswordMessage: string;
    passwordsMatch: string;
    passwordsDoNotMatch: string;
  }

  interface DialogApi {
    showAlert: (
      title: string,
      message: string,
      options?: { variant?: string }
    ) => Promise<void>;
  }

  // Admin Users Form Manager Class

  class AdminUsersFormManager {
    private config: UsersFormConfig;
    private translations: TranslationStrings;

    // Character sets for password generation
    private readonly UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    private readonly LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
    private readonly NUMBERS = '0123456789';
    private readonly SPECIAL = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    private readonly defaultTranslations: TranslationStrings = {
      validationError: 'Validation Error',
      requiredFields: 'Please fill in all required fields',
      invalidEmail: 'Invalid Email',
      invalidEmailMessage: 'Please enter a valid email address',
      invalidPassword: 'Invalid Password',
      passwordMinLength: 'Password must be at least 8 characters long',
      passwordMismatch: 'Password Mismatch',
      passwordMismatchMessage: 'Passwords do not match',
      weakPassword: 'Weak Password',
      weakPasswordMessage:
        'Password must contain uppercase and lowercase letters, numbers, and special characters',
      passwordsMatch: 'Passwords match',
      passwordsDoNotMatch: 'Passwords do not match',
    };

    constructor(config: UsersFormConfig) {
      this.config = config;
      this.translations = {
        ...this.defaultTranslations,
        ...config.translations,
      };
    }

    public initialize(): void {
      this.setupPasswordVisibilityToggles();
      this.setupTextareaAutoResize();

      if (this.config.isCreateForm) {
        this.setupPasswordGeneration();
        this.setupPasswordMatchValidation();
        this.setupCreateFormValidation();
      } else {
        this.setupEditFormValidation();
      }

      this.exposeGlobalMethods();
    }

    /**
     * Setup password visibility toggle buttons
     */
    private setupPasswordVisibilityToggles(): void {
      document
        .querySelectorAll<HTMLButtonElement>(
          '[onclick*="togglePasswordVisibility"]'
        )
        .forEach(button => {
          const onclickAttr = button.getAttribute('onclick') || '';
          const match = onclickAttr.match(
            /togglePasswordVisibility\(['"]([^'"]+)['"]\)/
          );
          if (match) {
            const inputId = match[1];
            button.removeAttribute('onclick');
            button.addEventListener('click', e => {
              e.preventDefault();
              this.togglePasswordVisibility(inputId);
            });
          }
        });
    }

    /**
     * Toggle password field visibility
     */
    public togglePasswordVisibility(inputId: string): void {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      const icon = document.getElementById(inputId + '_icon');

      if (!input) return;

      if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
          icon.setAttribute('data-lucide', 'eye-off');
          this.refreshLucideIcons();
        }
      } else {
        input.type = 'password';
        if (icon) {
          icon.setAttribute('data-lucide', 'eye');
          this.refreshLucideIcons();
        }
      }
    }

    /**
     * Refresh Lucide icons after changing attributes
     */
    private refreshLucideIcons(): void {
      const lucide = (
        window as unknown as { lucide?: { createIcons: () => void } }
      ).lucide;
      if (lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
      }
    }

    /**
     * Setup password generation checkbox handler
     */
    private setupPasswordGeneration(): void {
      const generateCheckbox = document.getElementById(
        'generatePassword'
      ) as HTMLInputElement | null;
      if (!generateCheckbox) return;

      generateCheckbox.addEventListener('change', () => {
        this.handlePasswordGenerationToggle(generateCheckbox.checked);
      });
    }

    /**
     * Handle password generation toggle
     */
    private handlePasswordGenerationToggle(generate: boolean): void {
      const passwordField = document.getElementById(
        'password'
      ) as HTMLInputElement | null;
      const confirmField = document.getElementById(
        'confirm_password'
      ) as HTMLInputElement | null;

      if (!passwordField || !confirmField) return;

      if (generate) {
        const newPassword = this.generateSecurePassword();
        passwordField.value = newPassword;
        confirmField.value = newPassword;
        passwordField.readOnly = true;
        confirmField.readOnly = true;

        passwordField.type = 'text';
        confirmField.type = 'text';

        setTimeout(() => {
          passwordField.type = 'password';
          confirmField.type = 'password';
        }, 3000);
      } else {
        passwordField.value = '';
        confirmField.value = '';
        passwordField.readOnly = false;
        confirmField.readOnly = false;
      }

      this.checkPasswordMatch();
    }

    /**
     * Generate a cryptographically secure password
     */
    private generateSecurePassword(length: number = 12): string {
      const allChars =
        this.UPPERCASE + this.LOWERCASE + this.NUMBERS + this.SPECIAL;

      // Use crypto.getRandomValues for secure random generation
      const getSecureRandomChar = (chars: string): string => {
        const randomArray = new Uint32Array(1);
        window.crypto.getRandomValues(randomArray);
        return chars.charAt(randomArray[0] % chars.length);
      };

      let password = '';
      password += getSecureRandomChar(this.UPPERCASE);
      password += getSecureRandomChar(this.LOWERCASE);
      password += getSecureRandomChar(this.NUMBERS);
      password += getSecureRandomChar(this.SPECIAL);

      for (let i = password.length; i < length; i++) {
        password += getSecureRandomChar(allChars);
      }

      // Shuffle the password using Fisher-Yates algorithm
      const passwordArray = password.split('');
      for (let i = passwordArray.length - 1; i > 0; i--) {
        const randomArray = new Uint32Array(1);
        window.crypto.getRandomValues(randomArray);
        const j = randomArray[0] % (i + 1);
        [passwordArray[i], passwordArray[j]] = [
          passwordArray[j],
          passwordArray[i],
        ];
      }

      return passwordArray.join('');
    }

    /**
     * Setup password match validation
     */
    private setupPasswordMatchValidation(): void {
      const passwordField = document.getElementById(
        'password'
      ) as HTMLInputElement | null;
      const confirmField = document.getElementById(
        'confirm_password'
      ) as HTMLInputElement | null;

      if (passwordField) {
        passwordField.addEventListener('input', () =>
          this.checkPasswordMatch()
        );
      }

      if (confirmField) {
        confirmField.addEventListener('input', () => this.checkPasswordMatch());
      }
    }

    /**
     * Check if passwords match and update indicator
     */
    private checkPasswordMatch(): void {
      const passwordField = document.getElementById(
        'password'
      ) as HTMLInputElement | null;
      const confirmField = document.getElementById(
        'confirm_password'
      ) as HTMLInputElement | null;
      const indicator = document.getElementById('password_match_indicator');
      const text = document.getElementById('password_match_text');

      if (!passwordField || !confirmField || !indicator || !text) return;

      const password = passwordField.value;
      const confirmPassword = confirmField.value;

      if (confirmPassword.length > 0) {
        indicator.classList.remove('hidden');
        if (password === confirmPassword) {
          text.textContent = '\u2713 ' + this.translations.passwordsMatch;
          text.className = 'text-green-600 dark:text-green-400';
        } else {
          text.textContent = '\u2717 ' + this.translations.passwordsDoNotMatch;
          text.className = 'text-red-600 dark:text-red-400';
        }
      } else {
        indicator.classList.add('hidden');
      }
    }

    /**
     * Setup create form validation
     */
    private setupCreateFormValidation(): void {
      const form = document.getElementById(
        'createUserForm'
      ) as HTMLFormElement | null;
      if (!form) return;

      form.addEventListener('submit', async e => {
        const isValid = await this.validateCreateForm();
        if (!isValid) {
          e.preventDefault();
        }
      });
    }

    /**
     * Validate create user form
     */
    private async validateCreateForm(): Promise<boolean> {
      const email =
        (document.getElementById('email') as HTMLInputElement | null)?.value ||
        '';
      const givenName =
        (document.getElementById('given_name') as HTMLInputElement | null)
          ?.value || '';
      const familyName =
        (document.getElementById('family_name') as HTMLInputElement | null)
          ?.value || '';
      const password =
        (document.getElementById('password') as HTMLInputElement | null)
          ?.value || '';
      const confirmPassword =
        (document.getElementById('confirm_password') as HTMLInputElement | null)
          ?.value || '';

      if (
        !email ||
        !givenName ||
        !familyName ||
        !password ||
        !confirmPassword
      ) {
        await this.showValidationError(
          this.translations.validationError,
          this.translations.requiredFields
        );
        return false;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        await this.showValidationError(
          this.translations.invalidEmail,
          this.translations.invalidEmailMessage
        );
        return false;
      }

      if (password.length < 8) {
        await this.showValidationError(
          this.translations.invalidPassword,
          this.translations.passwordMinLength
        );
        return false;
      }

      if (password !== confirmPassword) {
        await this.showValidationError(
          this.translations.passwordMismatch,
          this.translations.passwordMismatchMessage
        );
        return false;
      }

      const hasUpper = /[A-Z]/.test(password);
      const hasLower = /[a-z]/.test(password);
      const hasNumber = /\d/.test(password);
      const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

      if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
        await this.showValidationError(
          this.translations.weakPassword,
          this.translations.weakPasswordMessage
        );
        return false;
      }

      return true;
    }

    /**
     * Setup edit form validation
     */
    private setupEditFormValidation(): void {
      const form = document.querySelector('form') as HTMLFormElement | null;
      if (!form) return;

      form.addEventListener('submit', async e => {
        const isValid = await this.validateEditForm();
        if (!isValid) {
          e.preventDefault();
        }
      });
    }

    /**
     * Validate edit user form
     */
    private async validateEditForm(): Promise<boolean> {
      const email =
        (document.getElementById('email') as HTMLInputElement | null)?.value ||
        '';
      const givenName =
        (document.getElementById('given_name') as HTMLInputElement | null)
          ?.value || '';
      const familyName =
        (document.getElementById('family_name') as HTMLInputElement | null)
          ?.value || '';
      const newPassword =
        (document.getElementById('new_password') as HTMLInputElement | null)
          ?.value || '';

      if (!email || !givenName || !familyName) {
        await this.showValidationError(
          this.translations.validationError,
          'Please fill in all required fields (Email, First Name, Last Name)'
        );
        return false;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        await this.showValidationError(
          this.translations.invalidEmail,
          this.translations.invalidEmailMessage
        );
        return false;
      }

      // Password validation (if provided)
      if (newPassword && newPassword.length < 8) {
        await this.showValidationError(
          this.translations.invalidPassword,
          this.translations.passwordMinLength
        );
        return false;
      }

      return true;
    }

    /**
     * Show validation error dialog
     */
    private async showValidationError(
      title: string,
      message: string
    ): Promise<void> {
      const dialogApi = (window as unknown as { dialog: DialogApi }).dialog;

      if (dialogApi && typeof dialogApi.showAlert === 'function') {
        await dialogApi.showAlert(title, message, { variant: 'error' });
      } else {
        alert(message);
      }
    }

    /**
     * Setup textarea auto-resize
     */
    private setupTextareaAutoResize(): void {
      const textareas = document.querySelectorAll(
        'textarea'
      ) as NodeListOf<HTMLElement>;
      textareas.forEach(textarea => {
        textarea.addEventListener('input', function (this: HTMLElement) {
          this.style.height = 'auto';
          this.style.height =
            (this as { scrollHeight: number }).scrollHeight + 'px';
        });
      });
    }

    /**
     * Expose methods globally for inline onclick handlers (legacy support)
     */
    private exposeGlobalMethods(): void {
      const win = window as unknown as {
        togglePasswordVisibility: (inputId: string) => void;
        generateRandomPassword: () => string;
        checkPasswordMatch: () => void;
      };

      win.togglePasswordVisibility = this.togglePasswordVisibility.bind(this);
      win.generateRandomPassword = this.generateSecurePassword.bind(this);
      win.checkPasswordMatch = this.checkPasswordMatch.bind(this);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateElement = document.getElementById(
      '___ADMIN_USERS_FORM_STATE___'
    );

    const isCreateForm = document.getElementById('createUserForm') !== null;

    const defaultConfig: UsersFormConfig = {
      isCreateForm,
      translations: {
        validationError: 'Validation Error',
        requiredFields: 'Please fill in all required fields',
        invalidEmail: 'Invalid Email',
        invalidEmailMessage: 'Please enter a valid email address',
        invalidPassword: 'Invalid Password',
        passwordMinLength: 'Password must be at least 8 characters long',
        passwordMismatch: 'Password Mismatch',
        passwordMismatchMessage: 'Passwords do not match',
        weakPassword: 'Weak Password',
        weakPasswordMessage:
          'Password must contain uppercase and lowercase letters, numbers, and special characters',
        passwordsMatch: 'Passwords match',
        passwordsDoNotMatch: 'Passwords do not match',
      },
    };

    try {
      const config = stateElement
        ? JSON.parse(stateElement.textContent || '{}')
        : {};
      const manager = new AdminUsersFormManager({
        ...defaultConfig,
        ...config,
        isCreateForm: config.isCreateForm ?? isCreateForm,
      });
      manager.initialize();
    } catch (error) {
      console.error('[AdminUsersFormManager] Initialization failed:', error);
      const manager = new AdminUsersFormManager(defaultConfig);
      manager.initialize();
    }
  });
})();
