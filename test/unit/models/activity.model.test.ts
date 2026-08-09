import mongoose from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createActivityModel,
  type ActivityModel,
} from '../../../src/models/activity.model.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

describe('Activity Mongoose model', () => {
  let Activity: ActivityModel | undefined;

  afterEach(() => {
    if (mongoose.models.Activity) {
      mongoose.deleteModel('Activity');
    }
    Activity = undefined;
  });

  it('reuses the registered model across repeated factory calls', () => {
    Activity = createActivityModel();

    expect(createActivityModel()).toBe(Activity);
  });

  it('is tenant-scoped even when compiled before the global plugin', () => {
    Activity = createActivityModel();
    const activity = tenantContext.run(
      'tenant-a',
      () =>
        new Activity!({
          type: 'login_success',
          description: 'User signed in',
          ip_address: '127.0.0.1',
        })
    );

    expect((Activity.schema as any)._tenantPluginApplied).toBe(true);
    expect(Activity.schema.path('tenant_id')?.options).toMatchObject({
      required: true,
      index: true,
    });
    expect(activity.tenant_id).toBe('tenant-a');
  });

  it('applies audit defaults and exposes a safe serialized identifier', () => {
    Activity = createActivityModel();
    const activity = new Activity({
      type: 'login_success',
      description: 'User signed in',
      ip_address: '127.0.0.1',
    });

    expect(activity).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      tenant_id: 'default',
      type: 'login_success',
      description: 'User signed in',
      ip_address: '127.0.0.1',
      status: 'info',
      is_private: false,
      timestamp: expect.any(Date),
      actor: { actor_type: 'user' },
      target: { target_type: 'none' },
      device_infos: {
        is_new_device: false,
        requires_2fa: false,
        is_suspicious: false,
        risk_level: 'low',
        device_trust: { trusted: false },
      },
    });
    expect(typeof Activity.paginate).toBe('function');

    const serialized = activity.toJSON();
    expect(serialized.id).toMatch(/^[a-f0-9]{24}$/);
    expect(serialized).not.toHaveProperty('_id');
    expect(serialized).not.toHaveProperty('__v');
  });

  it('normalizes identities and retains complete device context', () => {
    Activity = createActivityModel();
    const actorId = new mongoose.Types.ObjectId();
    const targetId = new mongoose.Types.ObjectId();
    const trustedAt = new Date('2026-07-01T00:00:00.000Z');
    const trustedUntil = new Date('2026-08-01T00:00:00.000Z');
    const activity = new Activity({
      type: 'account.updated',
      description: 'Profile changed',
      ip_address: '192.0.2.10',
      user_agent: 'Demo Browser',
      client_id: 'demo-client',
      related_activity_id: 'previous-activity',
      status: 'success',
      is_private: true,
      actor: {
        user_id: actorId,
        username: '  Maria  ',
        email: '  MARIA@EXAMPLE.TEST  ',
        full_name: 'Maria Example',
        given_name: 'Maria',
        family_name: 'Example',
        actor_type: 'admin',
      },
      target: {
        target_type: 'user',
        user_id: targetId,
        username: '  Pat  ',
        email: '  PAT@EXAMPLE.TEST  ',
        full_name: 'Pat Example',
        given_name: 'Pat',
        family_name: 'Example',
        entity_id: 'profile-1',
        entity_name: 'Profile',
        entity_data: { changed: ['locale'] },
      },
      device_infos: {
        fingerprint: 'fingerprint',
        fingerprint_js_id: 'fingerprint-js',
        browser: { name: 'Browser', version: '1' },
        os: { name: 'OS', version: '2' },
        device: { type: 'desktop', vendor: 'Vendor', model: 'Model' },
        language: 'fr',
        timezone_guess: 'Africa/Porto-Novo',
        platform: 'Linux',
        screen: { width: 1920, height: 1080, pixel_ratio: 2 },
        hardware_concurrency: 8,
        memory: 16,
        is_new_device: true,
        requires_2fa: true,
        is_suspicious: true,
        confidence_score: 87,
        risk_level: 'high',
        matched_device_id: 'device-1',
        reason: 'New network',
        geo_location: {
          country: 'BJ',
          region: 'Littoral',
          city: 'Cotonou',
          latitude: 6.37,
          longitude: 2.39,
          timezone: 'Africa/Porto-Novo',
        },
        device_trust: {
          trusted: true,
          trusted_at: trustedAt,
          trusted_until: trustedUntil,
          fingerprint: 'trusted-fingerprint',
        },
      },
    });

    expect(activity.actor).toMatchObject({
      user_id: actorId,
      username: 'Maria',
      email: 'maria@example.test',
      actor_type: 'admin',
    });
    expect(activity.target).toMatchObject({
      user_id: targetId,
      username: 'Pat',
      email: 'pat@example.test',
      target_type: 'user',
      entity_data: { changed: ['locale'] },
    });
    expect(activity.device_infos).toMatchObject({
      fingerprint: 'fingerprint',
      fingerprint_js_id: 'fingerprint-js',
      timezone_guess: 'Africa/Porto-Novo',
      requires_2fa: true,
      confidence_score: 87,
      risk_level: 'high',
      geo_location: { country: 'BJ', city: 'Cotonou' },
      device_trust: {
        trusted: true,
        trusted_at: trustedAt,
        trusted_until: trustedUntil,
        fingerprint: 'trusted-fingerprint',
      },
    });
  });

  it('requires the core audit fields', async () => {
    Activity = createActivityModel();
    const activity = new Activity({
      timestamp: null,
      status: null,
    });

    await expect(activity.validate()).rejects.toMatchObject({
      errors: {
        type: expect.any(mongoose.Error.ValidatorError),
        description: expect.any(mongoose.Error.ValidatorError),
        timestamp: expect.any(mongoose.Error.ValidatorError),
        ip_address: expect.any(mongoose.Error.ValidatorError),
        status: expect.any(mongoose.Error.ValidatorError),
      },
    });
  });

  it.each([
    ['status', { status: 'unknown' }],
    ['actor.actor_type', { actor: { actor_type: 'robot' } }],
    ['target.target_type', { target: { target_type: 'database' } }],
    ['device_infos.risk_level', { device_infos: { risk_level: 'severe' } }],
    [
      'device_infos.confidence_score',
      { device_infos: { confidence_score: -1 } },
    ],
    [
      'device_infos.confidence_score',
      { device_infos: { confidence_score: 101 } },
    ],
  ])('rejects an invalid %s', async (path, invalidValue) => {
    Activity = createActivityModel();
    const activity = new Activity({
      type: 'risk.assessed',
      description: 'Risk assessed',
      ip_address: '192.0.2.20',
      ...invalidValue,
    });

    await expect(activity.validate()).rejects.toMatchObject({
      errors: { [path]: expect.any(mongoose.Error.ValidatorError) },
    });
  });

  it('accepts both confidence score boundaries', async () => {
    Activity = createActivityModel();
    const minimum = new Activity({
      type: 'risk.assessed',
      description: 'Minimum risk confidence',
      ip_address: '192.0.2.21',
      device_infos: { confidence_score: 0 },
    });
    const maximum = new Activity({
      type: 'risk.assessed',
      description: 'Maximum risk confidence',
      ip_address: '192.0.2.22',
      device_infos: { confidence_score: 100 },
    });

    await expect(minimum.validate()).resolves.toBeUndefined();
    await expect(maximum.validate()).resolves.toBeUndefined();
  });

  it('declares the activity collection, timestamps, and operational indexes', () => {
    Activity = createActivityModel();

    expect(Activity.collection.collectionName).toBe('activities');
    expect(Activity.schema.options.timestamps).toEqual({
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });

    const indexFields = Activity.schema.indexes().map(([fields]) => fields);
    expect(indexFields).toEqual(
      expect.arrayContaining([
        { tenant_id: 1 },
        { 'device_infos.fingerprint': 1 },
        { 'device_infos.fingerprint_js_id': 1 },
        { 'device_infos.risk_level': 1 },
        { 'device_infos.is_new_device': 1 },
        { 'device_infos.is_suspicious': 1 },
        { 'device_infos.geo_location.country': 1 },
        {
          'device_infos.device_trust.fingerprint': 1,
          'device_infos.device_trust.trusted_until': 1,
        },
        { tenant_id: 1, timestamp: -1 },
        { type: 1, timestamp: -1 },
        { tenant_id: 1, 'actor.user_id': 1, timestamp: -1 },
        { 'actor.actor_type': 1, timestamp: -1 },
        {
          'target.user_id': 1,
          'target.target_type': 1,
          timestamp: -1,
        },
        { 'target.target_type': 1, timestamp: -1 },
      ])
    );
  });
});
