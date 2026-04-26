import { Schema } from 'mongoose';

export const brandingErrorsViewsSchema = new Schema(
  {
    unauthorized: { type: String },
    forbidden: { type: String },
    notfound: { type: String },
    server_error: { type: String },
    rate_limit: { type: String },
  },
  { _id: false }
);
