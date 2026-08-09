import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSocialIntegrationModel,
  type SocialIntegrationModel,
  type TokenData,
} from '../../../src/models/social-integration.model.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';
import { ensureEncrypted, isEncrypted } from '../../../src/utils/encryption.js';

describe('SocialIntegration Mongoose model', () => {
  let SocialIntegration: SocialIntegrationModel | undefined;

  afterEach(() => {
    if (mongoose.models.SocialIntegration) {
      mongoose.deleteModel('SocialIntegration');
    }
    SocialIntegration = undefined;
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('is tenant-scoped even when compiled before the global plugin', () => {
    SocialIntegration = createSocialIntegrationModel();
    const integration = tenantContext.run(
      'tenant-a',
      () =>
        new SocialIntegration!({
          user_id: 'user-1',
          method: 'google',
          provider_sub: 'google-subject',
          provider_data: { sub: 'google-subject' },
        })
    );

    expect((SocialIntegration.schema as any)._tenantPluginApplied).toBe(true);
    expect(SocialIntegration.schema.path('tenant_id')?.options).toMatchObject({
      required: true,
      index: true,
    });
    expect(integration.tenant_id).toBe('tenant-a');
  });

  it('reports no decrypted token data when no tokens were provided', () => {
    SocialIntegration = createSocialIntegrationModel();
    const integration = new SocialIntegration({
      user_id: 'user-1',
      method: 'local',
      provider_sub: 'local-user-1',
      provider_data: { sub: 'local-user-1' },
    });

    expect(integration.getDecryptedTokens()).toBeUndefined();
    expect(integration.isTokenExpired()).toBe(false);

    integration.tokens = undefined;
    expect(integration.getDecryptedTokens()).toBeUndefined();
  });

  it('decrypts complete and partial legacy token data', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    SocialIntegration = createSocialIntegrationModel();
    const expiresAt = new Date('2026-08-02T13:00:00.000Z');
    const integration = new SocialIntegration({
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      tokens: {
        access_token: ensureEncrypted('access-secret'),
        refresh_token: ensureEncrypted('refresh-secret'),
        id_token: ensureEncrypted('id-secret'),
        token_type: 'DPoP',
        expires_at: expiresAt,
        scope: 'openid profile',
      },
    });
    const partialLegacy = new SocialIntegration({
      user_id: 'user-2',
      method: 'github',
      provider_sub: 'github-subject',
      provider_data: { sub: 'github-subject' },
      tokens: { refresh_token: ensureEncrypted('legacy-refresh') },
    });

    expect(integration.getDecryptedTokens()).toEqual({
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
      id_token: 'id-secret',
      token_type: 'DPoP',
      expires_at: expiresAt,
      scope: 'openid profile',
    });
    expect(partialLegacy.getDecryptedTokens()).toEqual({
      access_token: '',
      refresh_token: 'legacy-refresh',
      id_token: undefined,
      token_type: 'Bearer',
      expires_at: undefined,
      scope: undefined,
    });
  });

  it('treats a token as expired only after the one-minute buffer boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
    SocialIntegration = createSocialIntegrationModel();
    const integration = new SocialIntegration({
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      tokens: {
        access_token: 'encrypted-token-placeholder',
        expires_at: new Date('2026-08-02T12:01:00.000Z'),
      },
    });

    expect(integration.isTokenExpired()).toBe(false);

    vi.setSystemTime(new Date('2026-08-02T12:00:00.001Z'));
    expect(integration.isTokenExpired()).toBe(true);
  });

  it('encrypts plaintext tokens and enforces the active tenant before insert', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    SocialIntegration = createSocialIntegrationModel();
    const insertOne = vi
      .spyOn(SocialIntegration.collection, 'insertOne')
      .mockImplementation(async document => ({
        acknowledged: true,
        insertedId: document._id ?? new mongoose.Types.ObjectId(),
      }));
    const integration = new SocialIntegration({
      tenant_id: 'foreign-tenant',
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      tokens: {
        access_token: 'access-plaintext',
        refresh_token: 'refresh-plaintext',
        id_token: 'id-plaintext',
      },
    });

    await tenantContext.run('tenant-a', () => integration.save());

    expect(integration.tenant_id).toBe('tenant-a');
    const tokens = integration.tokens as TokenData;
    expect(isEncrypted(tokens.access_token)).toBe(true);
    expect(isEncrypted(tokens.refresh_token!)).toBe(true);
    expect(isEncrypted(tokens.id_token!)).toBe(true);
    expect(integration.getDecryptedTokens()).toMatchObject({
      access_token: 'access-plaintext',
      refresh_token: 'refresh-plaintext',
      id_token: 'id-plaintext',
    });
    expect(insertOne).toHaveBeenCalledOnce();
  });

  it('persists partial legacy and tokenless records without inventing secrets', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    SocialIntegration = createSocialIntegrationModel();
    const insertOne = vi
      .spyOn(SocialIntegration.collection, 'insertOne')
      .mockImplementation(async document => ({
        acknowledged: true,
        insertedId: document._id ?? new mongoose.Types.ObjectId(),
      }));
    const accessOnly = new SocialIntegration({
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      tokens: { access_token: 'access-plaintext' },
    });
    const refreshOnly = new SocialIntegration({
      user_id: 'user-2',
      method: 'github',
      provider_sub: 'github-subject',
      provider_data: { sub: 'github-subject' },
      tokens: { refresh_token: 'refresh-plaintext' },
    });
    const tokenless = new SocialIntegration({
      user_id: 'user-3',
      method: 'local',
      provider_sub: 'local-subject',
      provider_data: { sub: 'local-subject' },
    });
    tokenless.tokens = undefined;

    await accessOnly.save();
    await refreshOnly.save();
    await tokenless.save();

    expect(accessOnly.getDecryptedTokens()).toMatchObject({
      access_token: 'access-plaintext',
      refresh_token: undefined,
      id_token: undefined,
    });
    expect(refreshOnly.getDecryptedTokens()).toMatchObject({
      access_token: '',
      refresh_token: 'refresh-plaintext',
      id_token: undefined,
    });
    expect(tokenless.getDecryptedTokens()).toBeUndefined();
    expect(insertOne).toHaveBeenCalledTimes(3);
  });

  it('never serializes stored OAuth token secrets', () => {
    SocialIntegration = createSocialIntegrationModel();
    const integration = new SocialIntegration({
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      tokens: {
        access_token: 'encrypted-access',
        refresh_token: 'encrypted-refresh',
        id_token: 'encrypted-id',
        token_type: 'Bearer',
        scope: 'openid profile',
      },
    });

    const serialized = integration.toJSON() as Record<string, any>;

    expect(serialized.tokens).toMatchObject({
      token_type: 'Bearer',
      scope: 'openid profile',
    });
    expect(serialized.tokens).not.toHaveProperty('access_token');
    expect(serialized.tokens).not.toHaveProperty('refresh_token');
    expect(serialized.tokens).not.toHaveProperty('id_token');
  });

  it('retains every supported provider profile claim', () => {
    SocialIntegration = createSocialIntegrationModel();
    const integration = new SocialIntegration({
      user_id: 'user-1',
      method: 'google',
      provider_sub: '  google-subject  ',
      provider_username: '  maria  ',
      provider_data: {
        sub: 'google-subject',
        email: 'maria@example.test',
        email_verified: true,
        phone_number: '+22901020304',
        phone_number_verified: true,
        name: 'Maria Example',
        given_name: 'Maria',
        family_name: 'Example',
        picture: 'https://example.test/maria.png',
        locale: 'fr',
        provider_username: 'maria',
        raw_data: { organization: 'Example' },
      },
    });

    expect(integration).toMatchObject({
      provider_sub: 'google-subject',
      provider_username: 'maria',
      provider_data: {
        sub: 'google-subject',
        email: 'maria@example.test',
        email_verified: true,
        phone_number: '+22901020304',
        phone_number_verified: true,
        name: 'Maria Example',
        given_name: 'Maria',
        family_name: 'Example',
        picture: 'https://example.test/maria.png',
        locale: 'fr',
        provider_username: 'maria',
        raw_data: { organization: 'Example' },
      },
    });
  });

  it('reuses the model with stable storage and safe defaults', () => {
    SocialIntegration = createSocialIntegrationModel();
    const integration = new SocialIntegration({
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
    });

    expect(createSocialIntegrationModel()).toBe(SocialIntegration);
    expect(SocialIntegration.collection.collectionName).toBe(
      'socialintegrations'
    );
    expect(SocialIntegration.schema.options.timestamps).toEqual({
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
    expect(typeof SocialIntegration.paginate).toBe('function');
    expect(integration).toMatchObject({
      tenant_id: 'default',
      is_active: true,
      tokens: { token_type: 'Bearer' },
      metadata: {
        created_by: 'user',
        linked_at: expect.any(Date),
        sync_errors: [],
      },
    });
    expect(integration.toJSON()).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      user_id: 'user-1',
    });
  });

  it('requires identity and provider subject data', async () => {
    SocialIntegration = createSocialIntegrationModel();
    const integration = new SocialIntegration({
      user_id: null,
      method: null,
      provider_sub: '   ',
      provider_data: { sub: null },
    });

    await expect(integration.validate()).rejects.toMatchObject({
      errors: {
        user_id: expect.any(mongoose.Error.ValidatorError),
        method: expect.any(mongoose.Error.ValidatorError),
        provider_sub: expect.any(mongoose.Error.ValidatorError),
        'provider_data.sub': expect.any(mongoose.Error.ValidatorError),
      },
    });
  });

  it.each([
    ['method', { method: 'saml' }],
    ['metadata.created_by', { metadata: { created_by: 'importer' } }],
  ])('rejects an invalid %s', async (path, invalidValue) => {
    SocialIntegration = createSocialIntegrationModel();
    const integration = new SocialIntegration({
      user_id: 'user-1',
      method: 'google',
      provider_sub: 'google-subject',
      provider_data: { sub: 'google-subject' },
      ...invalidValue,
    });

    await expect(integration.validate()).rejects.toMatchObject({
      errors: { [path]: expect.any(mongoose.Error.ValidatorError) },
    });
  });

  it('declares tenant-safe identity uniqueness and lookup indexes', () => {
    SocialIntegration = createSocialIntegrationModel();
    const indexes = SocialIntegration.schema.indexes();

    expect(indexes).toContainEqual([
      { tenant_id: 1, user_id: 1, method: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(indexes).toContainEqual([
      { tenant_id: 1, provider_sub: 1, method: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(indexes).toContainEqual([
      { method: 1, is_active: 1 },
      expect.any(Object),
    ]);
    expect(indexes).toContainEqual([{ last_used: -1 }, expect.any(Object)]);
  });
});
