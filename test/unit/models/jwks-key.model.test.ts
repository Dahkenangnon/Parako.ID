import mongoose from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';

import { createJwksKeyModel } from '../../../src/models/jwks-key.model.js';

describe('JWKS key model', () => {
  afterEach(() => {
    if (mongoose.models.JwksKey) mongoose.deleteModel('JwksKey');
  });

  it('defines tenant-scoped lookup and uniqueness indexes', () => {
    const model = createJwksKeyModel();

    expect(model.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ tenant_id: 1, status: 1 }, expect.any(Object)],
        [{ tenant_id: 1, kid: 1 }, expect.objectContaining({ unique: true })],
        [
          { tenant_id: 1, alg: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { status: 'active', promoted: true },
          }),
        ],
      ])
    );
  });

  it('reuses the compiled model during hot reload', () => {
    const first = createJwksKeyModel();

    expect(createJwksKeyModel()).toBe(first);
  });

  it('can compile an isolated model registry for concurrent database harnesses', () => {
    const isolatedMongoose = new mongoose.Mongoose();

    expect(createJwksKeyModel(isolatedMongoose)).not.toBe(
      mongoose.models.JwksKey
    );
    expect(isolatedMongoose.models.JwksKey).toBeDefined();
  });
});
