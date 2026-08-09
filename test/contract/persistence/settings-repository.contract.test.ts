import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  createSettingsRepositoryHarness,
  type SettingsRepositoryHarness,
} from '../support/settings-repository-harness.js';

describe.sequential('settings repository persistence contract', () => {
  // Vitest skips the contract cases when beforeAll fails. Definite assignment
  // models that lifecycle without weakening every test with an optional repo.
  let harness!: SettingsRepositoryHarness;
  const key = `settings-contract-${randomUUID()}`;
  const tenantIds = ['default', 'contract-tenant-a', 'contract-tenant-b'];

  beforeAll(async () => {
    harness = await createSettingsRepositoryHarness();
    await harness.cleanup(key);
    await harness.cleanupTenantSettings(tenantIds);
    await harness.cleanupJwks('default');
  });

  afterEach(async () => {
    if (!harness) return;
    await harness.cleanup(key);
    await harness.cleanupTenantSettings(tenantIds);
    await harness.cleanupJwks('default');
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('preserves revision history while keeping exactly one active revision', async () => {
    await harness.repository.save(key, { description: 'first' });
    await harness.repository.save(key, { description: 'second' });
    const latest = await harness.repository.save(key, { description: 'third' });

    const history = await harness.repository.findHistory(key, 10);

    expect(history).toHaveLength(3);
    expect(history.map(revision => revision.description)).toEqual([
      'third',
      'second',
      'first',
    ]);
    expect(new Set(history.map(revision => revision._version)).size).toBe(3);
    expect(history.filter(revision => revision.is_active)).toEqual([
      expect.objectContaining({ id: latest.id, description: 'third' }),
    ]);
    await expect(harness.repository.findActive(key)).resolves.toMatchObject({
      id: latest.id,
      description: 'third',
    });
  });

  it('serializes concurrent saves without losing revisions or creating multiple active rows', async () => {
    await harness.repository.save(key, { description: 'initial' });
    const descriptions = [
      'concurrent-a',
      'concurrent-b',
      'concurrent-c',
      'concurrent-d',
    ];

    await Promise.all(
      descriptions.map(description =>
        harness.repository.save(key, { description })
      )
    );

    const history = await harness.repository.findHistory(key, 10);

    expect(history).toHaveLength(5);
    expect(history.map(revision => revision.description)).toEqual(
      expect.arrayContaining(['initial', ...descriptions])
    );
    expect(new Set(history.map(revision => revision._version)).size).toBe(5);
    expect(history.filter(revision => revision.is_active)).toHaveLength(1);
  });

  it('preserves tenant override history while keeping one active revision', async () => {
    await harness.runAsTenant('default', () =>
      harness.tenantRepository.save({ branding: { companyName: 'first' } })
    );
    await harness.runAsTenant('default', () =>
      harness.tenantRepository.save({ branding: { companyName: 'second' } })
    );
    const latest = await harness.runAsTenant('default', () =>
      harness.tenantRepository.save({ branding: { companyName: 'third' } })
    );

    await expect(harness.tenantRevisionCount('default')).resolves.toBe(3);
    await expect(
      harness.runAsTenant('default', () =>
        harness.tenantRepository.findActive()
      )
    ).resolves.toMatchObject({
      id: latest.id,
      is_active: true,
      branding: { companyName: 'third' },
    });
  });

  it('isolates tenant override reads, writes, and revision counts', async () => {
    if (!harness.supportsTenantIsolation) {
      expect(harness.adapter).toBe('sqlite');
      return;
    }

    await harness.runAsTenant('contract-tenant-a', () =>
      harness.tenantRepository.save({ branding: { companyName: 'Tenant A' } })
    );
    await harness.runAsTenant('contract-tenant-b', () =>
      harness.tenantRepository.save({ branding: { companyName: 'Tenant B' } })
    );

    await expect(
      harness.runAsTenant('contract-tenant-a', () =>
        harness.tenantRepository.findActive()
      )
    ).resolves.toMatchObject({
      tenant_id: 'contract-tenant-a',
      branding: { companyName: 'Tenant A' },
    });
    await expect(
      harness.runAsTenant('contract-tenant-b', () =>
        harness.tenantRepository.findActive()
      )
    ).resolves.toMatchObject({
      tenant_id: 'contract-tenant-b',
      branding: { companyName: 'Tenant B' },
    });
    await expect(
      harness.tenantRevisionCount('contract-tenant-a')
    ).resolves.toBe(1);
    await expect(
      harness.tenantRevisionCount('contract-tenant-b')
    ).resolves.toBe(1);
  });

  it('serializes concurrent tenant override saves without losing revisions', async () => {
    await harness.runAsTenant('default', () =>
      harness.tenantRepository.save({ branding: { companyName: 'initial' } })
    );
    const names = [
      'concurrent-a',
      'concurrent-b',
      'concurrent-c',
      'concurrent-d',
    ];

    await Promise.all(
      names.map(companyName =>
        harness.runAsTenant('default', () =>
          harness.tenantRepository.save({ branding: { companyName } })
        )
      )
    );

    const revisions = await harness.tenantRevisions('default');
    expect(revisions).toHaveLength(5);
    expect(new Set(revisions.map(revision => revision._version)).size).toBe(5);
    expect(revisions.filter(revision => revision.is_active)).toHaveLength(1);
  });

  it('creates one initial JWKS keyset across concurrent initializers', async () => {
    const stores = Array.from({ length: 4 }, () => harness.createKeyStore());

    await Promise.all(stores.map(store => store.initialize('default')));

    await expect(harness.jwksCount('default')).resolves.toBe(1);
  });
});
