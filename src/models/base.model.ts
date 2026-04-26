import type { Model } from 'mongoose';

export type { IBaseModel } from '../types/base.js';

export type TypedModel<T, M> = Model<
  T,
  Record<string, never>,
  M,
  Record<string, unknown>
>;
