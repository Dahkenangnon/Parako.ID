import { afterEach, describe, expect, it, vi } from 'vitest';

describe('repository decorator runtime compatibility', () => {
  afterEach(() => {
    vi.doUnmock('@prisma/client');
    vi.resetModules();
  });

  it('loads injectable repositories with Object metadata when the Prisma client constructor is unavailable', async () => {
    vi.doMock('@prisma/client', () => ({ PrismaClient: undefined }));
    vi.resetModules();

    const [activity, settings, socialIntegration, user] = await Promise.all([
      import('../../../../src/db/repositories/prisma/activity.repository.js'),
      import('../../../../src/db/repositories/prisma/settings.repository.js'),
      import('../../../../src/db/repositories/prisma/social-integration.repository.js'),
      import('../../../../src/db/repositories/prisma/user.repository.js'),
    ]);

    expect(activity.PrismaActivityRepository).toBeTypeOf('function');
    expect(settings.PrismaSettingsRepository).toBeTypeOf('function');
    expect(socialIntegration.PrismaSocialIntegrationRepository).toBeTypeOf(
      'function'
    );
    expect(user.PrismaUserRepository).toBeTypeOf('function');
  });
});
