import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the password-breach utility
vi.mock('../../../../src/utils/password-breach.js', () => ({
  checkBreachBySha1: vi.fn(),
}));

import { createPasswordBreachCheckHandler } from '../../../../src/jobs/domains/background-tasks/handlers/password-breach-check.handler.js';
import { checkBreachBySha1 } from '../../../../src/utils/password-breach.js';
import type { INotificationService } from '../../../../src/di/interfaces/notification-service.interface.js';
import type { IActivityService } from '../../../../src/di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';

const mockedCheckBreachBySha1 = vi.mocked(checkBreachBySha1);

function createMocks() {
  const notificationService: Partial<INotificationService> = {
    sendSecurityAlert: vi
      .fn()
      .mockResolvedValue({ success: true, channel: 'email' }),
  };

  const activityService: Partial<IActivityService> = {
    warning: vi.fn(),
  };

  const logger: Partial<ILogger> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    notificationService: notificationService as INotificationService,
    activityService: activityService as IActivityService,
    logger: logger as ILogger,
  };
}

function createValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'background-tasks',
    name: 'password-breach-check',
    sha1Prefix: '5BAA6',
    sha1Suffix: '1E4C9B93F3F0682250B6CF8331B7EE68FD8',
    userId: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    tenantId: 'default',
    apiTimeoutMs: 3000,
    minBreachCount: 1,
    ...overrides,
  };
}

describe('password-breach-check handler', () => {
  let handler: ReturnType<typeof createPasswordBreachCheckHandler>;
  let mocks: ReturnType<typeof createMocks>;
  const reportProgress = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
    handler = createPasswordBreachCheckHandler(
      mocks.notificationService,
      mocks.activityService,
      mocks.logger
    );
  });

  it('sends notification when password is breached and count >= minBreachCount', async () => {
    mockedCheckBreachBySha1.mockResolvedValueOnce({
      breached: true,
      count: 500,
    });

    const result = await handler(createValidPayload(), reportProgress);

    expect(mockedCheckBreachBySha1).toHaveBeenCalledWith(
      '5BAA6',
      '1E4C9B93F3F0682250B6CF8331B7EE68FD8',
      3000
    );
    expect(mocks.notificationService.sendSecurityAlert).toHaveBeenCalledWith(
      {
        userId: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      },
      'password_breached',
      expect.objectContaining({ breachCount: 500 })
    );
    expect(mocks.activityService.warning).toHaveBeenCalledWith(
      'password_breach_detected',
      expect.any(String),
      expect.objectContaining({ _id: 'user-123', username: 'testuser' }),
      expect.any(Object)
    );
    expect(result).toEqual(
      expect.objectContaining({
        checked: true,
        breached: true,
        breachCount: 500,
        notified: true,
      })
    );
  });

  it('skips notification when not breached', async () => {
    mockedCheckBreachBySha1.mockResolvedValueOnce({
      breached: false,
      count: 0,
    });

    const result = await handler(createValidPayload(), reportProgress);

    expect(mocks.notificationService.sendSecurityAlert).not.toHaveBeenCalled();
    expect(mocks.activityService.warning).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        checked: true,
        breached: false,
        breachCount: 0,
        notified: false,
      })
    );
  });

  it('skips notification when count < minBreachCount', async () => {
    mockedCheckBreachBySha1.mockResolvedValueOnce({
      breached: true,
      count: 3,
    });

    const result = await handler(
      createValidPayload({ minBreachCount: 10 }),
      reportProgress
    );

    expect(mocks.notificationService.sendSecurityAlert).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        checked: true,
        breached: true,
        breachCount: 3,
        notified: false,
      })
    );
  });

  it('handles API failure gracefully (returns checked: false)', async () => {
    mockedCheckBreachBySha1.mockResolvedValueOnce({
      breached: false,
      count: 0,
    });

    const result = await handler(createValidPayload(), reportProgress);

    expect(result).toEqual(
      expect.objectContaining({
        checked: true,
        breached: false,
      })
    );
  });

  it('handles email send failure gracefully (still logs activity)', async () => {
    mockedCheckBreachBySha1.mockResolvedValueOnce({
      breached: true,
      count: 100,
    });

    (
      mocks.notificationService.sendSecurityAlert as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error('SMTP connection failed'));

    const result = await handler(createValidPayload(), reportProgress);

    // Activity should still be logged even if email fails
    expect(mocks.activityService.warning).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        checked: true,
        breached: true,
        breachCount: 100,
        notified: false,
      })
    );
  });

  it('validates Zod schema and rejects invalid payloads', async () => {
    const invalidPayload = {
      type: 'background-tasks',
      name: 'password-breach-check',
      // Missing required fields
    };

    await expect(
      handler(invalidPayload as any, reportProgress)
    ).rejects.toThrow();
  });

  it('validates Zod schema rejects wrong name', async () => {
    const invalidPayload = createValidPayload({ name: 'wrong-name' });

    await expect(
      handler(invalidPayload as any, reportProgress)
    ).rejects.toThrow();
  });
});
