/**
 * WebAuthn Registration Manager
 * Handles passkey registration flow from account settings
 */
/* eslint-disable no-undef */
(function () {
  'use strict';

  // Types for WebAuthn registration
  interface WebAuthnRegisterConfig {
    apiBasePath: string;
    registerOptionsUrl: string;
    registerVerifyUrl: string;
    successRedirectUrl: string;
    csrfToken: string;
    debug: boolean;
  }

  interface WebAuthnRegisterTranslations {
    registerButton: string;
    registering: string;
    saving: string;
    successTitle: string;
    successMessage: string;
    errorTitle: string;
    errorNotSecure: string;
    errorNotSupported: string;
    errorCancelled: string;
    errorGeneric: string;
  }

  interface WebAuthnRegisterState {
    config: WebAuthnRegisterConfig;
    translations: WebAuthnRegisterTranslations;
  }

  interface RegistrationOptionsResponse {
    ok: boolean;
    options?: PublicKeyCredentialCreationOptionsJSON;
    error?: string;
  }

  interface RegistrationVerifyResponse {
    ok: boolean;
    credential?: {
      credential_id: string;
      friendly_name: string;
    };
    error?: string;
  }

  // PublicKeyCredentialCreationOptionsJSON type from @simplewebauthn/types
  interface PublicKeyCredentialCreationOptionsJSON {
    rp: {
      name: string;
      id?: string;
    };
    user: {
      id: string;
      name: string;
      displayName: string;
    };
    challenge: string;
    pubKeyCredParams: Array<{
      type: 'public-key';
      alg: number;
    }>;
    timeout?: number;
    excludeCredentials?: Array<{
      id: string;
      type: 'public-key';
      transports?: AuthenticatorTransport[];
    }>;
    authenticatorSelection?: {
      authenticatorAttachment?: AuthenticatorAttachment;
      requireResidentKey?: boolean;
      residentKey?: ResidentKeyRequirement;
      userVerification?: UserVerificationRequirement;
    };
    attestation?: AttestationConveyancePreference;
    extensions?: AuthenticationExtensionsClientInputs;
  }

  /**
   * WebAuthn Registration Manager Class
   */
  class WebAuthnRegisterManager {
    private config: WebAuthnRegisterConfig;
    private translations: WebAuthnRegisterTranslations;

    // DOM Elements
    private statusEl: HTMLElement | null = null;
    private registerBtn: HTMLButtonElement | null = null;
    private registerBtnText: HTMLElement | null = null;
    private saveBtn: HTMLButtonElement | null = null;
    private friendlyNameSection: HTMLElement | null = null;
    private friendlyNameInput: HTMLInputElement | null = null;

    private registrationResponse: Credential | null = null;
    private isProcessing = false;

    constructor(state: WebAuthnRegisterState) {
      this.config = state.config;
      this.translations = state.translations;
    }

    /**
     * Initialize the registration manager
     */
    public init(): void {
      this.statusEl = document.getElementById('webauthn-status');
      this.registerBtn = document.getElementById(
        'webauthn-register-btn'
      ) as HTMLButtonElement;
      this.registerBtnText = document.getElementById('register-btn-text');
      this.saveBtn = document.getElementById(
        'webauthn-save-btn'
      ) as HTMLButtonElement;
      this.friendlyNameSection = document.getElementById(
        'friendly-name-section'
      );
      this.friendlyNameInput = document.getElementById(
        'friendly_name'
      ) as HTMLInputElement;

      // Check secure context (HTTPS) — required for WebAuthn API availability
      if (!window.isSecureContext) {
        this.showError(this.translations.errorNotSecure);
        if (this.registerBtn) {
          this.registerBtn.disabled = true;
        }
        return;
      }

      if (!this.isWebAuthnSupported()) {
        this.showError(this.translations.errorNotSupported);
        if (this.registerBtn) {
          this.registerBtn.disabled = true;
        }
        return;
      }

      this.bindEvents();

      this.log('WebAuthn Register Manager initialized');
    }

    /**
     * Check if WebAuthn is supported in this browser
     */
    private isWebAuthnSupported(): boolean {
      return !!(
        window.PublicKeyCredential &&
        typeof window.PublicKeyCredential === 'function'
      );
    }

    /**
     * Bind event handlers
     */
    private bindEvents(): void {
      if (this.registerBtn) {
        this.registerBtn.addEventListener('click', () =>
          this.startRegistration()
        );
      }

      if (this.saveBtn) {
        this.saveBtn.addEventListener('click', () => this.saveCredential());
      }
    }

    /**
     * Start the WebAuthn registration process
     */
    private async startRegistration(): Promise<void> {
      if (this.isProcessing) return;

      this.isProcessing = true;
      this.hideStatus();
      this.setButtonLoading(true);

      try {
        // Step 1: Get registration options from server
        const optionsResponse = await this.getRegistrationOptions();

        if (!optionsResponse.ok || !optionsResponse.options) {
          throw new Error(
            optionsResponse.error || 'Failed to get registration options'
          );
        }

        this.log('Got registration options', optionsResponse.options);

        // Step 2: Start WebAuthn ceremony
        const credential = await this.createCredential(optionsResponse.options);

        if (!credential) {
          throw new Error('No credential returned from authenticator');
        }

        this.log('Credential created', credential);

        this.registrationResponse = credential;

        // Step 3: Show friendly name input with pre-filled device name
        this.showFriendlyNameInput(credential as PublicKeyCredential);
      } catch (error) {
        this.handleError(error);
      } finally {
        this.isProcessing = false;
        this.setButtonLoading(false);
      }
    }

    /**
     * Get registration options from the server
     */
    private async getRegistrationOptions(): Promise<RegistrationOptionsResponse> {
      const response = await fetch(this.config.registerOptionsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.config.csrfToken,
        },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    }

    /**
     * Create credential using WebAuthn API
     */
    private async createCredential(
      options: PublicKeyCredentialCreationOptionsJSON
    ): Promise<PublicKeyCredential | null> {
      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions =
        {
          rp: options.rp,
          user: {
            id: this.base64urlToBuffer(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          challenge: this.base64urlToBuffer(options.challenge),
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          excludeCredentials: options.excludeCredentials?.map(cred => ({
            id: this.base64urlToBuffer(cred.id),
            type: cred.type,
            transports: cred.transports,
          })),
          authenticatorSelection: options.authenticatorSelection,
          attestation: options.attestation,
          extensions: options.extensions,
        };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      });

      return credential as PublicKeyCredential | null;
    }

    /**
     * Detect device name from user agent and credential transports
     */
    private detectDeviceName(credential: PublicKeyCredential): string {
      const response = credential.response as AuthenticatorAttestationResponse;
      const transports = response.getTransports?.() || [];
      const isInternal = transports.includes('internal');

      if (!isInternal && transports.length > 0) {
        return 'Security Key';
      }

      const ua = navigator.userAgent.toLowerCase();

      if (ua.includes('iphone')) {
        return 'iPhone';
      }

      if (ua.includes('ipad')) {
        return 'iPad';
      }

      if (ua.includes('macintosh') || ua.includes('mac os')) {
        return 'Mac Touch ID';
      }

      if (ua.includes('windows')) {
        return 'Windows Hello';
      }

      if (ua.includes('android')) {
        return 'Android Device';
      }

      if (ua.includes('linux')) {
        return 'Linux Device';
      }

      return 'Passkey';
    }

    /**
     * Show the friendly name input section
     */
    private showFriendlyNameInput(credential?: PublicKeyCredential): void {
      if (this.friendlyNameSection) {
        this.friendlyNameSection.classList.remove('hidden');
      }

      if (this.registerBtn) {
        this.registerBtn.classList.add('hidden');
      }

      if (this.saveBtn) {
        this.saveBtn.classList.remove('hidden');
      }

      // Pre-fill the friendly name with detected device name
      if (this.friendlyNameInput && credential) {
        const detectedName = this.detectDeviceName(credential);
        this.friendlyNameInput.value = detectedName;
        this.friendlyNameInput.select(); // Select the text so user can easily edit
      }

      if (this.friendlyNameInput) {
        this.friendlyNameInput.focus();
      }
    }

    /**
     * Save the credential to the server
     */
    private async saveCredential(): Promise<void> {
      if (this.isProcessing || !this.registrationResponse) return;

      this.isProcessing = true;
      this.hideStatus();

      if (this.saveBtn) {
        this.saveBtn.disabled = true;
        this.saveBtn.textContent = this.translations.saving;
      }

      try {
        const credential = this.registrationResponse as PublicKeyCredential;
        const response =
          credential.response as AuthenticatorAttestationResponse;

        // Server expects { credential: {...}, friendly_name: "..." }
        const requestBody = {
          credential: {
            id: credential.id,
            rawId: this.bufferToBase64url(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: this.bufferToBase64url(response.clientDataJSON),
              attestationObject: this.bufferToBase64url(
                response.attestationObject
              ),
              transports: response.getTransports?.() || [],
            },
            clientExtensionResults: credential.getClientExtensionResults(),
          },
          friendly_name: this.friendlyNameInput?.value.trim() || undefined,
        };

        const verifyResponse = await fetch(this.config.registerVerifyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this.config.csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify(requestBody),
        });

        const result: RegistrationVerifyResponse = await verifyResponse.json();

        if (!result.ok) {
          throw new Error(result.error || 'Failed to verify registration');
        }

        this.log('Registration verified', result);

        this.showSuccess(this.translations.successMessage);

        setTimeout(() => {
          window.location.href = this.config.successRedirectUrl;
        }, 1500);
      } catch (error) {
        this.handleError(error);

        if (this.saveBtn) {
          this.saveBtn.disabled = false;
          this.saveBtn.textContent = this.translations.registerButton;
        }
      } finally {
        this.isProcessing = false;
      }
    }

    /**
     * Handle errors during registration
     */
    private handleError(error: unknown): void {
      this.log('Error during registration', error);

      let message = this.translations.errorGeneric;

      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          message = this.translations.errorCancelled;
        } else if (error.name === 'NotSupportedError') {
          message = this.translations.errorNotSupported;
        } else if (error.message) {
          message = error.message;
        }
      }

      this.showError(message);
    }

    /**
     * Set button loading state
     */
    private setButtonLoading(loading: boolean): void {
      if (this.registerBtn) {
        this.registerBtn.disabled = loading;
      }

      if (this.registerBtnText) {
        this.registerBtnText.textContent = loading
          ? this.translations.registering
          : this.translations.registerButton;
      }
    }

    /**
     * Show success message
     */
    private showSuccess(message: string): void {
      if (this.statusEl) {
        this.statusEl.className =
          'mb-4 p-3 border-2 border-green-500 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200';
        this.statusEl.innerHTML = `
          <div class="flex items-center">
            <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <div>
              <p class="font-medium">${this.translations.successTitle}</p>
              <p class="text-sm">${message}</p>
            </div>
          </div>
        `;
        this.statusEl.classList.remove('hidden');
      }
    }

    /**
     * Show error message
     */
    private showError(message: string): void {
      if (this.statusEl) {
        this.statusEl.className =
          'mb-4 p-3 border-2 border-red-500 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200';
        this.statusEl.innerHTML = `
          <div class="flex items-center">
            <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
            <div>
              <p class="font-medium">${this.translations.errorTitle}</p>
              <p class="text-sm">${message}</p>
            </div>
          </div>
        `;
        this.statusEl.classList.remove('hidden');
      }
    }

    /**
     * Hide status message
     */
    private hideStatus(): void {
      if (this.statusEl) {
        this.statusEl.classList.add('hidden');
      }
    }

    /**
     * Convert base64url string to ArrayBuffer
     */
    private base64urlToBuffer(base64url: string): ArrayBuffer {
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
      const padLen = (4 - (base64.length % 4)) % 4;
      const padded = base64 + '='.repeat(padLen);
      const binary = atob(padded);
      const buffer = new ArrayBuffer(binary.length);
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return buffer;
    }

    /**
     * Convert ArrayBuffer to base64url string
     */
    private bufferToBase64url(buffer: ArrayBuffer): string {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    /**
     * Debug logging
     */
    private log(message: string, data?: unknown): void {
      if (this.config.debug) {
        console.log(`[WebAuthn Register] ${message}`, data || '');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateEl = document.getElementById('___WEBAUTHN_REGISTER_STATE___');
    if (!stateEl) {
      console.error('[WebAuthn Register] State element not found');
      return;
    }

    try {
      const state: WebAuthnRegisterState = JSON.parse(
        stateEl.textContent || '{}'
      );
      const manager = new WebAuthnRegisterManager(state);
      manager.init();
    } catch (error) {
      console.error('[WebAuthn Register] Failed to initialize:', error);
    }
  });
})();
