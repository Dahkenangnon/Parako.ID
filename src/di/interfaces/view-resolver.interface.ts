import { Application } from 'express';
import nunjucks from 'nunjucks';
export interface ViewResolverConfig {
  enabled: boolean;
  customViewsRoot: string;
  defaultViewsRoot: string;
  viewExtension: string;
}

export interface ViewKeys {
  auth: {
    login: string;
    register: string;
    forgot_password: string;
    reset_password: string;
    email_verification: string;
    verify_email: string;
    email_verification_success: string;
    phone_verification: string;
    account_select: string;
    continue: string;
    multi_factor: string;
    mfa_verify: string;
    mfa_resend: string;
    logout: string;
    social_password_setup: string;
    social_contact_info: string;
    account_recovery: string;
    recovery_backup_codes: string;
    recovery_secondary_email: string;
    recovery_verify_code: string;
    recovery_method_select: string;
    recovery_security_questions: string;
    recovery_sms: string;
    recovery_codes_display: string;
    setup_mfa: string;
    setup_webauthn: string;
    mfa_select: string;
    mfa_webauthn: string;
    mfa_no_fallback: string;
    social_callback: string;
    oidc: {
      consent: string;
      device_flow_code_input: string;
      device_flow_confirm_code: string;
      device_flow_success: string;
      error: string;
      login: string;
      logout_success: string;
      logout: string;
      mfa: string;
      mfa_select: string;
      mfa_webauthn: string;
      mfa_no_fallback: string;
      newDeviceVerify: string;
    };
  };
  accounts: {
    my_account: string;
    settings_profile: string;
    settings_preferences: string;
    settings_notifications: string;
    settings_security: string;
    settings_recovery: string;
    settings_social: string;
    apps: string;
    sessions: string;
    recovery_codes: string;
    recovery_setup: string;
    security_questions_setup: string;
    passkeys: string;
  };
  errors: {
    unauthorized: string;
    forbidden: string;
    notfound: string;
    server_error: string;
    rate_limit: string;
  };
  email: {
    mail: string;
  };
  home: {
    index: string;
  };
}

/**
 * Interface for view resolver service
 * Defines the contract for view resolution operations
 */
export interface IViewResolver {
  /**
   * Get type-safe view keys for controllers
   * Usage: res.render(viewResolver.views.auth.login, {...})
   */
  get views(): ViewKeys;

  /**
   * Configure Express app with resolved view paths
   * Sets up Nunjucks with proper view directories
   * @param app - Express application instance
   * @param njk - Nunjucks module
   * @returns Nunjucks environment or null if configuration fails
   */
  configureExpressViews(
    app: Application,
    njk: typeof nunjucks
  ): nunjucks.Environment | null;

  reloadConfig(): void;

  /**
   * Get current configuration
   * @returns Current view resolver configuration
   */
  getCurrentConfig(): ViewResolverConfig;
}
