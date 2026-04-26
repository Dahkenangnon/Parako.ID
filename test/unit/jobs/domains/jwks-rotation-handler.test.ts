import { describe, it, expect, vi } from 'vitest';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
  getLogger: vi.fn(),
  flush: vi.fn(),
  shutdown: vi.fn(),
};

function createMockKeyStore() {
  return {
    needsRotation: vi.fn().mockResolvedValue(false),
    rotate: vi.fn().mockResolvedValue(undefined),
    promoteKeys: vi.fn().mockResolvedValue(3),
    retireExpiredKeys: vi.fn().mockResolvedValue(0),
    initialize: vi.fn(),
    getJWKS: vi.fn(),
    getPublicJWKS: vi.fn(),
    listKeys: vi.fn(),
  };
}

describe('JWKS rotation handler', () => {
  it('should skip rotation when needsRotation() returns false', async () => {
    const mockKeyStore = createMockKeyStore();

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const result = await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation' },
      reportProgress,
      mockKeyStore,
      mockLogger
    );

    expect(mockKeyStore.needsRotation).toHaveBeenCalled();
    expect(mockKeyStore.rotate).not.toHaveBeenCalled();
    expect(result).toEqual({ rotated: false, reason: 'not-due' });
  });

  it('should rotate, promote, and retire when needsRotation() returns true (delay=0)', async () => {
    const mockKeyStore = createMockKeyStore();
    mockKeyStore.needsRotation.mockResolvedValue(true);

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const result = await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation' },
      reportProgress,
      mockKeyStore,
      mockLogger
    );

    expect(mockKeyStore.rotate).toHaveBeenCalled();
    expect(mockKeyStore.promoteKeys).toHaveBeenCalled();
    expect(mockKeyStore.retireExpiredKeys).toHaveBeenCalled();
    expect(reportProgress).toHaveBeenCalledWith(50);
    expect(reportProgress).toHaveBeenCalledWith(75);
    expect(reportProgress).toHaveBeenCalledWith(100);
    expect(result).toEqual({ rotated: true });
  });

  it('should call onRotated and onPromoted callbacks after successful rotation', async () => {
    const mockKeyStore = createMockKeyStore();
    mockKeyStore.needsRotation.mockResolvedValue(true);

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const onRotated = vi.fn().mockResolvedValue(undefined);
    const onPromoted = vi.fn().mockResolvedValue(undefined);
    const result = await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation' },
      reportProgress,
      mockKeyStore,
      mockLogger,
      onRotated,
      onPromoted
    );

    expect(result).toEqual({ rotated: true });
    expect(onRotated).toHaveBeenCalledTimes(1);
    expect(onPromoted).toHaveBeenCalledTimes(1);
  });

  it('should not call callbacks when rotation is skipped', async () => {
    const mockKeyStore = createMockKeyStore();

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const onRotated = vi.fn().mockResolvedValue(undefined);
    const onPromoted = vi.fn().mockResolvedValue(undefined);
    await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation' },
      reportProgress,
      mockKeyStore,
      mockLogger,
      onRotated,
      onPromoted
    );

    expect(onRotated).not.toHaveBeenCalled();
    expect(onPromoted).not.toHaveBeenCalled();
  });

  it('should re-throw errors and log them', async () => {
    const mockKeyStore = createMockKeyStore();
    mockKeyStore.needsRotation.mockRejectedValue(new Error('DB down'));

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await expect(
      jwksRotationHandler(
        { type: 'process', name: 'jwks-rotation' },
        reportProgress,
        mockKeyStore,
        mockLogger
      )
    ).rejects.toThrow('DB down');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('DB down'),
      expect.any(Object)
    );
  });

  // ── Delayed promotion via scheduleDelayedPromotion ──

  it('should schedule delayed promotion when promotionDelayMs > 0 and scheduleDelayedPromotion provided', async () => {
    const mockKeyStore = createMockKeyStore();
    mockKeyStore.needsRotation.mockResolvedValue(true);

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const onRotated = vi.fn().mockResolvedValue(undefined);
    const onPromoted = vi.fn().mockResolvedValue(undefined);
    const scheduleDelayedPromotion = vi.fn().mockResolvedValue(undefined);

    const result = await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation' },
      reportProgress,
      mockKeyStore,
      mockLogger,
      onRotated,
      onPromoted,
      {
        promotionDelayMs: 30000,
        scheduleDelayedPromotion,
      }
    );

    // Phase 1 should complete
    expect(mockKeyStore.rotate).toHaveBeenCalled();
    expect(onRotated).toHaveBeenCalledTimes(1);

    // Phase 2 should NOT run in this job — it's scheduled for later
    expect(mockKeyStore.promoteKeys).not.toHaveBeenCalled();
    expect(onPromoted).not.toHaveBeenCalled();
    expect(mockKeyStore.retireExpiredKeys).not.toHaveBeenCalled();

    // Delayed job should be scheduled
    expect(scheduleDelayedPromotion).toHaveBeenCalledWith(30000);

    expect(result).toEqual({
      rotated: true,
      promotionScheduled: true,
      promotionDelayMs: 30000,
    });
  });

  it('should run immediate promotion when delay > 0 but scheduleDelayedPromotion not provided', async () => {
    const mockKeyStore = createMockKeyStore();
    mockKeyStore.needsRotation.mockResolvedValue(true);

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const result = await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation' },
      reportProgress,
      mockKeyStore,
      mockLogger,
      undefined,
      undefined,
      { promotionDelayMs: 30000 }
    );

    // Falls back to immediate mode when callback is missing
    expect(mockKeyStore.promoteKeys).toHaveBeenCalled();
    expect(mockKeyStore.retireExpiredKeys).toHaveBeenCalled();
    expect(result).toEqual({ rotated: true });
  });

  // ── Promotion-only phase (triggered by delayed BullMQ job) ──

  it('should run promotion-only phase when data.phase is "promote"', async () => {
    const mockKeyStore = createMockKeyStore();

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const onPromoted = vi.fn().mockResolvedValue(undefined);

    const result = await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation', phase: 'promote' },
      reportProgress,
      mockKeyStore,
      mockLogger,
      undefined,
      onPromoted
    );

    // Should NOT check needsRotation or rotate — just promote + retire
    expect(mockKeyStore.needsRotation).not.toHaveBeenCalled();
    expect(mockKeyStore.rotate).not.toHaveBeenCalled();

    expect(mockKeyStore.promoteKeys).toHaveBeenCalled();
    expect(onPromoted).toHaveBeenCalledTimes(1);
    expect(mockKeyStore.retireExpiredKeys).toHaveBeenCalled();
    expect(result).toEqual({ rotated: false, promoted: true });
  });

  it('should pass tenantId from job data to all keyStore methods', async () => {
    const mockKeyStore = createMockKeyStore();
    mockKeyStore.needsRotation.mockResolvedValue(true);

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation', tenantId: 'tenant-abc' },
      reportProgress,
      mockKeyStore,
      mockLogger
    );

    expect(mockKeyStore.needsRotation).toHaveBeenCalledWith('tenant-abc');
    expect(mockKeyStore.rotate).toHaveBeenCalledWith('tenant-abc');
    expect(mockKeyStore.promoteKeys).toHaveBeenCalledWith('tenant-abc');
    expect(mockKeyStore.retireExpiredKeys).toHaveBeenCalledWith('tenant-abc');
  });

  it('should pass tenantId to keyStore methods in promotion-only phase', async () => {
    const mockKeyStore = createMockKeyStore();

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    await jwksRotationHandler(
      {
        type: 'process',
        name: 'jwks-rotation',
        phase: 'promote',
        tenantId: 'tenant-xyz',
      },
      reportProgress,
      mockKeyStore,
      mockLogger
    );

    expect(mockKeyStore.promoteKeys).toHaveBeenCalledWith('tenant-xyz');
    expect(mockKeyStore.retireExpiredKeys).toHaveBeenCalledWith('tenant-xyz');
  });

  it('should pass undefined tenantId when not provided in job data', async () => {
    const mockKeyStore = createMockKeyStore();
    mockKeyStore.needsRotation.mockResolvedValue(true);

    const { jwksRotationHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.js');

    const reportProgress = vi.fn().mockResolvedValue(undefined);
    await jwksRotationHandler(
      { type: 'process', name: 'jwks-rotation' },
      reportProgress,
      mockKeyStore,
      mockLogger
    );

    // tenantId is optional, so keyStore methods receive undefined (falls back to 'default' internally)
    expect(mockKeyStore.needsRotation).toHaveBeenCalledWith(undefined);
    expect(mockKeyStore.rotate).toHaveBeenCalledWith(undefined);
    expect(mockKeyStore.promoteKeys).toHaveBeenCalledWith(undefined);
    expect(mockKeyStore.retireExpiredKeys).toHaveBeenCalledWith(undefined);
  });
});

describe('JWKS rotation schedule', () => {
  it('registerJwksRotationSchedule() calls upsertJobScheduler with config-derived cron', async () => {
    const mockQueue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    };

    const { registerJwksRotationSchedule } =
      await import('../../../../src/jobs/schedules/jwks-rotation.schedule.js');

    // 90 days → monthly cron
    await registerJwksRotationSchedule(mockQueue as any, {
      rotationIntervalDays: 90,
    });

    expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
      'jwks-rotation-periodic',
      expect.objectContaining({
        pattern: '0 2 1 * *', // monthly for 90 days
        tz: 'UTC',
      }),
      expect.objectContaining({
        name: 'jwks-rotation',
        data: { type: 'process', name: 'jwks-rotation' },
      })
    );
  });

  it('uses weekly cron for 14-day interval', async () => {
    const mockQueue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    };

    const { registerJwksRotationSchedule } =
      await import('../../../../src/jobs/schedules/jwks-rotation.schedule.js');

    await registerJwksRotationSchedule(mockQueue as any, {
      rotationIntervalDays: 14,
    });

    expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
      'jwks-rotation-periodic',
      expect.objectContaining({ pattern: '0 2 * * 0' }),
      expect.any(Object)
    );
  });
});
