import type { Queue } from 'bullmq';
import { deriveRotationCron } from '../config.js';

export interface JwksRotationScheduleOptions {
  rotationIntervalDays: number;
}

/**
 * Register (or update) the periodic JWKS rotation schedule.
 *
 * Uses BullMQ's `upsertJobScheduler` which is idempotent — safe to
 * call on every worker startup. The cron frequency is derived from
 * `security.key_store.rotation_interval_days` in the app config.
 *
 * The actual rotation decision is made inside the handler via
 * `keyStore.needsRotation()`, so running the schedule more frequently
 * than the interval is harmless (it simply becomes a no-op check).
 */
export async function registerJwksRotationSchedule(
  queue: Queue,
  options: JwksRotationScheduleOptions
): Promise<void> {
  const pattern = deriveRotationCron(options.rotationIntervalDays);

  await queue.upsertJobScheduler(
    'jwks-rotation-periodic',
    { pattern, tz: 'UTC' },
    {
      name: 'jwks-rotation',
      data: { type: 'process', name: 'jwks-rotation' },
    }
  );
}
