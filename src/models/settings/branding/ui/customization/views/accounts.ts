import { Schema } from 'mongoose';

export const brandingAccountsViewsSchema = new Schema(
  {
    my_account: { type: String },
    settings: { type: String },
    apps: { type: String },
    sessions: { type: String },
    recovery_codes: { type: String },
    recovery_setup: { type: String },
    settings_profile: { type: String },
    settings_preferences: { type: String },
    settings_notifications: { type: String },
    settings_security: { type: String },
    settings_recovery: { type: String },
    settings_social: { type: String },
    security_questions_setup: { type: String },
    passkeys: { type: String },
  },
  { _id: false }
);
