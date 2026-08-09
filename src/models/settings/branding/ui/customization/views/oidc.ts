import { Schema } from 'mongoose';

export const brandingOidcViewsSchema = new Schema(
  {
    consent: { type: String },
    device_flow_code_input: { type: String },
    device_flow_confirm_code: { type: String },
    device_flow_success: { type: String },
    error: { type: String },
    login: { type: String },
    logout_success: { type: String },
    logout: { type: String },
    mfa: { type: String },
    mfa_select: { type: String },
    mfa_webauthn: { type: String },
    mfa_no_fallback: { type: String },
    newDeviceVerify: { type: String },
  },
  { _id: false }
);
