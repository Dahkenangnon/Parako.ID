/**
 * WebAuthn Authentication Manager
 * Handles passkey authentication during OIDC MFA flow
 */
/* eslint-disable no-undef */
(function () {
  'use strict';

  // Types for WebAuthn authentication
  interface WebAuthnAuthConfig {
    uid?: string;
    oidcPath?: string;
    optionsUrl: string;
    verifyUrl: string;
    timerDuration: number;
    autoTrigger: boolean;
    csrfToken: string;
    debug: boolean;
    isOidcFlow?: boolean;
    loginUrl?: string;
  }

  interface WebAuthnAuthTranslations {
    authenticateButton: string;
    authenticating: string;
    successTitle: string;
    successMessage: string;
    errorTitle: string;
    errorNotSecure: string;
    errorNotSupported: string;
    errorCancelled: string;
    errorNoCredentials: string;
    errorGeneric: string;
    errorTimeout: string;
  }

  interface WebAuthnAuthState {
    config: WebAuthnAuthConfig;
    translations: WebAuthnAuthTranslations;
  }

  interface AuthenticationOptionsResponse {
    ok: boolean;
    options?: PublicKeyCredentialRequestOptionsJSON;
    error?: string;
  }

  interface AuthenticationVerifyResponse {
    ok: boolean;
    redirectUrl?: string;
    error?: string;
  }

  // PublicKeyCredentialRequestOptionsJSON type
  interface PublicKeyCredentialRequestOptionsJSON {
    challenge: string;
    timeout?: number;
    rpId?: string;
    allowCredentials?: Array<{
      id: string;
      type: 'public-key';
      transports?: AuthenticatorTransport[];
    }>;
    userVerification?: UserVerificationRequirement;
    extensions?: AuthenticationExtensionsClientInputs;
  }

  /**
   * WebAuthn Authentication Manager Class
   */
  class WebAuthnAuthenticateManager {
    private config: WebAuthnAuthConfig;
    private translations: WebAuthnAuthTranslations;

    // DOM Elements
    private statusEl: HTMLElement | null = null;
    private authBtn: HTMLButtonElement | null = null;
    private authBtnText: HTMLElement | null = null;
    private timerEl: HTMLElement | null = null;
    private tryAnotherBtn: HTMLElement | null = null;

    private isProcessing = false;
    private timerInterval: ReturnType<typeof setInterval> | null = null;
    private remainingSeconds = 0;

    constructor(state: WebAuthnAuthState) {
      this.config = state.config;
      this.translations = state.translations;
      this.remainingSeconds = state.config.timerDuration;
    }

    /**
     * Initialize the authentication manager
     */
    public init(): void {
      this.statusEl = document.getElementById('webauthn-status');
      this.authBtn = document.getElementById(
        'webauthn-auth-btn'
      ) as HTMLButtonElement;
      this.authBtnText = document.getElementById('auth-btn-text');
      this.timerEl = document.getElementById('timer');
      this.tryAnotherBtn = document.getElementById('try-another-method');

      // Check secure context (HTTPS) — required for WebAuthn API availability
      if (!window.isSecureContext) {
        this.showError(this.translations.errorNotSecure);
        if (this.authBtn) {
          this.authBtn.disabled = true;
        }
        return;
      }

      if (!this.isWebAuthnSupported()) {
        this.showError(this.translations.errorNotSupported);
        if (this.authBtn) {
          this.authBtn.disabled = true;
        }
        return;
      }

      this.bindEvents();

      this.startTimer();

      // Auto-trigger authentication if configured
      if (this.config.autoTrigger) {
        setTimeout(() => this.startAuthentication(), 500);
      }

      this.log('WebAuthn Authenticate Manager initialized');
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
      if (this.authBtn) {
        this.authBtn.addEventListener('click', () =>
          this.startAuthentication()
        );
      }

      if (this.tryAnotherBtn) {
        this.tryAnotherBtn.addEventListener('click', () =>
          this.tryAnotherMethod()
        );
      }
    }

    /**
     * Start the session timer
     */
    private startTimer(): void {
      this.updateTimerDisplay();

      this.timerInterval = setInterval(() => {
        this.remainingSeconds--;

        if (this.remainingSeconds <= 0) {
          this.stopTimer();
          this.showError(this.translations.errorTimeout);
          if (this.authBtn) {
            this.authBtn.disabled = true;
          }
          return;
        }

        this.updateTimerDisplay();
      }, 1000);
    }

    /**
     * Stop the session timer
     */
    private stopTimer(): void {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    }

    /**
     * Update the timer display
     */
    private updateTimerDisplay(): void {
      if (this.timerEl) {
        const minutes = Math.floor(this.remainingSeconds / 60);
        const seconds = this.remainingSeconds % 60;
        this.timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
    }

    /**
     * Start the WebAuthn authentication process
     */
    private async startAuthentication(): Promise<void> {
      if (this.isProcessing) return;

      this.isProcessing = true;
      this.hideStatus();
      this.setButtonLoading(true);

      try {
        // Step 1: Get authentication options from server
        const optionsResponse = await this.getAuthenticationOptions();

        if (!optionsResponse.ok || !optionsResponse.options) {
          throw new Error(
            optionsResponse.error || 'Failed to get authentication options'
          );
        }

        this.log('Got authentication options', optionsResponse.options);

        if (
          !optionsResponse.options.allowCredentials ||
          optionsResponse.options.allowCredentials.length === 0
        ) {
          throw new Error(this.translations.errorNoCredentials);
        }

        // Step 2: Start WebAuthn ceremony
        const credential = await this.getCredential(optionsResponse.options);

        if (!credential) {
          throw new Error('No credential returned from authenticator');
        }

        this.log('Got credential', credential);

        // Step 3: Verify with server
        const verifyResponse = await this.verifyAuthentication(credential);

        if (!verifyResponse.ok) {
          throw new Error(
            verifyResponse.error || 'Authentication verification failed'
          );
        }

        this.log('Authentication verified', verifyResponse);

        this.showSuccess(this.translations.successMessage);
        this.stopTimer();

        if (
          verifyResponse.redirectUrl &&
          this.isValidRedirectUrl(verifyResponse.redirectUrl)
        ) {
          setTimeout(() => {
            window.location.href = verifyResponse.redirectUrl!;
          }, 1000);
        }
      } catch (error) {
        this.handleError(error);
        this.setButtonLoading(false);
      } finally {
        this.isProcessing = false;
      }
    }

    /**
     * Get authentication options from the server
     */
    private async getAuthenticationOptions(): Promise<AuthenticationOptionsResponse> {
      const response = await fetch(this.config.optionsUrl, {
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
     * Get credential using WebAuthn API
     */
    private async getCredential(
      options: PublicKeyCredentialRequestOptionsJSON
    ): Promise<PublicKeyCredential | null> {
      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions =
        {
          challenge: this.base64urlToBuffer(options.challenge),
          timeout: options.timeout,
          rpId: options.rpId,
          allowCredentials: options.allowCredentials?.map(cred => ({
            id: this.base64urlToBuffer(cred.id),
            type: cred.type,
            transports: cred.transports,
          })),
          userVerification: options.userVerification,
          extensions: options.extensions,
        };

      const credential = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      });

      return credential as PublicKeyCredential | null;
    }

    /**
     * Verify authentication with the server
     */
    private async verifyAuthentication(
      credential: PublicKeyCredential
    ): Promise<AuthenticationVerifyResponse> {
      const response = credential.response as AuthenticatorAssertionResponse;

      const credentialData = {
        id: credential.id,
        rawId: this.bufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: this.bufferToBase64url(response.clientDataJSON),
          authenticatorData: this.bufferToBase64url(response.authenticatorData),
          signature: this.bufferToBase64url(response.signature),
          userHandle: response.userHandle
            ? this.bufferToBase64url(response.userHandle)
            : null,
        },
        clientExtensionResults: credential.getClientExtensionResults(),
      };

      const verifyResponse = await fetch(this.config.verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.config.csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({ credential: credentialData }),
      });

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${verifyResponse.status}`);
      }

      return verifyResponse.json();
    }

    /**
     * Try another authentication method
     */
    private tryAnotherMethod(): void {
      // For OIDC flow, redirect to MFA method selection
      if (this.config.isOidcFlow && this.config.oidcPath && this.config.uid) {
        window.location.href = `${this.config.oidcPath}/interaction/${this.config.uid}/mfa/select`;
      } else {
        // For regular auth flow, redirect to login page
        // The user will need to start the login process again
        window.location.href = this.config.loginUrl || '/auth/login';
      }
    }

    /**
     * Handle errors during authentication
     */
    private handleError(error: unknown): void {
      this.log('Error during authentication', error);

      let message = this.translations.errorGeneric;

      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          message = this.translations.errorCancelled;
        } else if (error.name === 'NotSupportedError') {
          message = this.translations.errorNotSupported;
        } else if (error.message === this.translations.errorNoCredentials) {
          message = this.translations.errorNoCredentials;
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
      if (this.authBtn) {
        this.authBtn.disabled = loading;
      }

      if (this.authBtnText) {
        this.authBtnText.textContent = loading
          ? this.translations.authenticating
          : this.translations.authenticateButton;
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
        console.log(`[WebAuthn Auth] ${message}`, data || '');
      }
    }

    /**
     * Validate redirect URL to prevent open redirect — safe protocols and same-origin only.
     */
    private isValidRedirectUrl(url: string): boolean {
      if (!url || typeof url !== 'string') return false;
      try {
        const parsed = new URL(url, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        return parsed.origin === window.location.origin || url.startsWith('/');
      } catch {
        return false;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const stateEl = document.getElementById('___WEBAUTHN_AUTH_STATE___');
    if (!stateEl) {
      console.error('[WebAuthn Auth] State element not found');
      return;
    }

    try {
      const state: WebAuthnAuthState = JSON.parse(stateEl.textContent || '{}');
      const manager = new WebAuthnAuthenticateManager(state);
      manager.init();
    } catch (error) {
      console.error('[WebAuthn Auth] Failed to initialize:', error);
    }
  });
})();
