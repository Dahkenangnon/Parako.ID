import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

/**
 * Test that Mongoose models have correct compound indexes with tenant_id
 * for multi-tenant isolation. Unique constraints must include tenant_id
 * so that different tenants can have the same username, email, etc.
 */

// Minimal mock dependencies for model factories that require DI
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockConfigManager = {
  getConfig: vi.fn().mockReturnValue({
    auth: { username: { custom_identifier: false } },
    features: { multi_tenancy: { enabled: false } },
    security: {
      authentication: {
        roles: { available: ['user', 'admin'], default: 'user' },
      },
    },
  }),
  subscribe: vi.fn(),
};

const mockPasswordUtils = {
  hash: vi.fn(),
  verify: vi.fn(),
};

describe('Mongoose Model Tenant Indexes', () => {
  /**
   * Helper: Extract index definitions from a schema.
   * Returns array of { fields, options } for each index.
   */
  function getSchemaIndexes(schema: mongoose.Schema) {
    return schema.indexes().map(([fields, options]) => ({
      fields,
      options: options || {},
    }));
  }

  /**
   * Helper: Check if a specific compound index exists.
   */
  function hasIndex(
    indexes: ReturnType<typeof getSchemaIndexes>,
    fields: Record<string, number>,
    options?: {
      unique?: boolean;
      sparse?: boolean;
      partialFilterExpression?: unknown;
    }
  ): boolean {
    return indexes.some(idx => {
      const fieldsMatch = JSON.stringify(idx.fields) === JSON.stringify(fields);
      if (!options) return fieldsMatch;

      let optionsMatch = true;
      if (options.unique !== undefined)
        optionsMatch = optionsMatch && idx.options.unique === options.unique;
      if (options.sparse !== undefined)
        optionsMatch = optionsMatch && idx.options.sparse === options.sparse;
      if (options.partialFilterExpression !== undefined)
        optionsMatch =
          optionsMatch &&
          JSON.stringify(idx.options.partialFilterExpression) ===
            JSON.stringify(options.partialFilterExpression);
      return fieldsMatch && optionsMatch;
    });
  }

  describe('User model indexes', () => {
    let userSchema: mongoose.Schema;

    beforeEach(async () => {
      // Clear model cache to get fresh schema
      delete (mongoose.models as Record<string, unknown>).User;
      delete (mongoose.connection.collections as Record<string, unknown>).users;

      const { createUserModel } =
        await import('../../../src/models/user.model.js');
      const UserModel = createUserModel(
        mockLogger as any,
        mockConfigManager as any,
        mockPasswordUtils as any
      );
      userSchema = UserModel.schema;
    });

    it('should have compound unique index { tenant_id: 1, username: 1 }', () => {
      const indexes = getSchemaIndexes(userSchema);
      expect(
        hasIndex(indexes, { tenant_id: 1, username: 1 }, { unique: true })
      ).toBe(true);
    });

    it('should have compound unique index { tenant_id: 1, email: 1 } with partialFilterExpression', () => {
      const indexes = getSchemaIndexes(userSchema);
      expect(
        hasIndex(
          indexes,
          { tenant_id: 1, email: 1 },
          {
            unique: true,
            partialFilterExpression: { email: { $type: 'string' } },
          }
        )
      ).toBe(true);
    });

    it('should NOT have single-field unique { username: 1 }', () => {
      const indexes = getSchemaIndexes(userSchema);
      expect(hasIndex(indexes, { username: 1 }, { unique: true })).toBe(false);
    });

    it('should NOT have single-field unique { email: 1 }', () => {
      const indexes = getSchemaIndexes(userSchema);
      expect(
        hasIndex(indexes, { email: 1 }, { unique: true, sparse: true })
      ).toBe(false);
    });

    it('should have compound unique index { tenant_id: 1, custom_identifier_1: 1 } with partialFilterExpression', () => {
      const indexes = getSchemaIndexes(userSchema);
      expect(
        hasIndex(
          indexes,
          { tenant_id: 1, custom_identifier_1: 1 },
          {
            unique: true,
            partialFilterExpression: {
              custom_identifier_1: { $type: 'string' },
            },
          }
        )
      ).toBe(true);
    });

    it('should have compound unique index { tenant_id: 1, custom_identifier_2: 1 } with partialFilterExpression', () => {
      const indexes = getSchemaIndexes(userSchema);
      expect(
        hasIndex(
          indexes,
          { tenant_id: 1, custom_identifier_2: 1 },
          {
            unique: true,
            partialFilterExpression: {
              custom_identifier_2: { $type: 'string' },
            },
          }
        )
      ).toBe(true);
    });

    it('should have compound unique index { tenant_id: 1, custom_identifier_3: 1 } with partialFilterExpression', () => {
      const indexes = getSchemaIndexes(userSchema);
      expect(
        hasIndex(
          indexes,
          { tenant_id: 1, custom_identifier_3: 1 },
          {
            unique: true,
            partialFilterExpression: {
              custom_identifier_3: { $type: 'string' },
            },
          }
        )
      ).toBe(true);
    });

    it('should NOT have single-field unique { custom_identifier_1: 1 }', () => {
      const indexes = getSchemaIndexes(userSchema);
      expect(
        hasIndex(indexes, { custom_identifier_1: 1 }, { unique: true })
      ).toBe(false);
    });
  });

  describe('Settings model indexes (global — no tenant_id after ConfLayer)', () => {
    let settingsSchema: mongoose.Schema;

    beforeEach(async () => {
      delete (mongoose.models as Record<string, unknown>).Settings;

      const { createSettingsModel } =
        await import('../../../src/models/settings.model.js');
      const SettingsModel = createSettingsModel();
      settingsSchema = SettingsModel.schema;
    });

    it('should have compound unique index { key: 1, is_active: 1 } with partialFilter (global)', () => {
      const indexes = getSchemaIndexes(settingsSchema);
      expect(
        hasIndex(
          indexes,
          { key: 1, is_active: 1 },
          {
            unique: true,
            partialFilterExpression: { is_active: true },
          }
        )
      ).toBe(true);
    });

    it('should NOT have tenant-scoped compound { tenant_id: 1, key: 1, is_active: 1 }', () => {
      const indexes = getSchemaIndexes(settingsSchema);
      expect(
        hasIndex(
          indexes,
          { tenant_id: 1, key: 1, is_active: 1 },
          { unique: true }
        )
      ).toBe(false);
    });
  });

  describe('SocialIntegration model indexes', () => {
    let socialSchema: mongoose.Schema;

    beforeEach(async () => {
      delete (mongoose.models as Record<string, unknown>).SocialIntegration;

      const { createSocialIntegrationModel } =
        await import('../../../src/models/social-integration.model.js');
      const SocialModel = createSocialIntegrationModel();
      socialSchema = SocialModel.schema;
    });

    it('should have compound unique index { tenant_id: 1, user_id: 1, method: 1 }', () => {
      const indexes = getSchemaIndexes(socialSchema);
      expect(
        hasIndex(
          indexes,
          { tenant_id: 1, user_id: 1, method: 1 },
          { unique: true }
        )
      ).toBe(true);
    });

    it('should have compound unique index { tenant_id: 1, provider_sub: 1, method: 1 }', () => {
      const indexes = getSchemaIndexes(socialSchema);
      expect(
        hasIndex(
          indexes,
          { tenant_id: 1, provider_sub: 1, method: 1 },
          { unique: true }
        )
      ).toBe(true);
    });

    it('should NOT have single compound { user_id: 1, method: 1 } unique', () => {
      const indexes = getSchemaIndexes(socialSchema);
      expect(
        hasIndex(indexes, { user_id: 1, method: 1 }, { unique: true })
      ).toBe(false);
    });

    it('should NOT have single compound { provider_sub: 1, method: 1 } unique', () => {
      const indexes = getSchemaIndexes(socialSchema);
      expect(
        hasIndex(indexes, { provider_sub: 1, method: 1 }, { unique: true })
      ).toBe(false);
    });
  });

  describe('Activity model indexes', () => {
    let activitySchema: mongoose.Schema;

    beforeEach(async () => {
      delete (mongoose.models as Record<string, unknown>).Activity;

      const { createActivityModel } =
        await import('../../../src/models/activity.model.js');
      const ActivityModel = createActivityModel();
      activitySchema = ActivityModel.schema;
    });

    it('should have compound index { tenant_id: 1, timestamp: -1 }', () => {
      const indexes = getSchemaIndexes(activitySchema);
      expect(hasIndex(indexes, { tenant_id: 1, timestamp: -1 })).toBe(true);
    });

    it('should have compound index { tenant_id: 1, actor.user_id: 1, timestamp: -1 }', () => {
      const indexes = getSchemaIndexes(activitySchema);
      expect(
        hasIndex(indexes, { tenant_id: 1, 'actor.user_id': 1, timestamp: -1 })
      ).toBe(true);
    });
  });
});
