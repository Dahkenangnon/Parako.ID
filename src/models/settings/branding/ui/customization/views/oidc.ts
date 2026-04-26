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
  },
  { _id: false }
);
