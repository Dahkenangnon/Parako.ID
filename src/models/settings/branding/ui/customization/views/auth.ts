import { Schema } from 'mongoose';
import { brandingOidcViewsSchema } from './oidc.js';

export const brandingAuthViewsSchema = new Schema(
  {
    login: { type: String },
    register: { type: String },
    forgot_password: { type: String },
    reset_password: { type: String },
    email_verification: { type: String },
    verify_email: { type: String },
    email_verification_success: { type: String },
    account_select: { type: String },
    continue: { type: String },
    multi_factor: { type: String },
    mfa_verify: { type: String },
    mfa_resend: { type: String },
    logout: { type: String },
    social_password_setup: { type: String },
    social_contact_info: { type: String },
    account_recovery: { type: String },
    recovery_backup_codes: { type: String },
    recovery_secondary_email: { type: String },
    recovery_verify_code: { type: String },
    setup_mfa: { type: String },
    social_callback: { type: String },
    oidc: brandingOidcViewsSchema,
  },
  { _id: false }
);
