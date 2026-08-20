import { describe, expect, it } from 'vitest';

import { getDefaultFullConfig } from '../../../../src/config/constants.js';
import {
  createSecuritySettingsViewModel,
  createSettingsOverviewViewModel,
} from '../../../../src/controllers/admin/settings-view-model.js';

describe('admin settings view models', () => {
  it('summarizes configuration history without exposing configuration payloads', () => {
    const viewModel = createSettingsOverviewViewModel(
      [
        {
          _id: 'settings-2',
          version: '2.0.0',
          is_active: false,
          created_at: '2026-08-15T10:00:00.000Z',
          metadata: { last_modified_by: 'operator@example.com' },
        },
        {
          id: 'settings-1',
          version: '1.0.0',
          is_active: true,
          created_at: '2026-08-14T10:00:00.000Z',
        },
      ],
      false
    );

    expect(viewModel).toEqual({
      title: 'Settings Overview',
      isUsingFileConfig: false,
      currentVersion: '1.0.0',
      versionHistory: [
        {
          id: 'settings-2',
          version: '2.0.0',
          isActive: false,
          createdAt: '2026-08-15T10:00:00.000Z',
          updatedBy: 'operator@example.com',
        },
        {
          id: 'settings-1',
          version: '1.0.0',
          isActive: true,
          createdAt: '2026-08-14T10:00:00.000Z',
          updatedBy: undefined,
        },
      ],
    });
    expect(viewModel.versionHistory[0]).not.toHaveProperty('security');
    expect(viewModel.versionHistory[0]).not.toHaveProperty('integrations');
  });

  it('uses the newest version when no active version exists', () => {
    expect(
      createSettingsOverviewViewModel(
        [{ version: '3.0.0', is_active: false }],
        true
      )
    ).toMatchObject({
      currentVersion: '3.0.0',
      isUsingFileConfig: true,
    });

    expect(createSettingsOverviewViewModel([], false).currentVersion).toBe(
      '1.0.0'
    );
  });

  it('exposes only the security fields required by each page', () => {
    const security = getDefaultFullConfig().security;

    expect(
      Object.keys(
        createSecuritySettingsViewModel('authentication', security).config
      )
    ).toEqual(['authentication']);
    expect(
      Object.keys(createSecuritySettingsViewModel('mfa', security).config)
    ).toEqual(['authentication']);
    expect(
      Object.keys(
        createSecuritySettingsViewModel('protection', security).config
      ).sort()
    ).toEqual(['authentication', 'protection']);
    expect(
      Object.keys(createSecuritySettingsViewModel('secrets', security).config)
    ).toEqual(['secrets']);
  });

  it('provides the configured Redis prefix only to the sessions page', () => {
    const security = getDefaultFullConfig().security;
    const viewModel = createSecuritySettingsViewModel(
      'sessions',
      security,
      'custom-prefix'
    );

    expect(viewModel.config).toMatchObject({
      authentication: security.authentication,
      deployment: { redis_prefix: 'custom-prefix' },
    });
    expect(viewModel.config).not.toHaveProperty('secrets');
  });
});
