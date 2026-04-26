import { Schema } from 'mongoose';

export const applicationSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    locales: {
      default: { type: String, required: true },
      available: { type: [String], required: true },
    },
  },
  { _id: false }
);
