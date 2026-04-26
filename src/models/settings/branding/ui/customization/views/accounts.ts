import { Schema } from 'mongoose';

export const brandingAccountsViewsSchema = new Schema(
  {
    my_account: { type: String },
    settings: { type: String },
    apps: { type: String },
    sessions: { type: String },
    recovery_codes: { type: String },
    recovery_setup: { type: String },
  },
  { _id: false }
);
