import type { JobsOptions, WorkerOptions } from 'bullmq';

/** Redis key prefix for all BullMQ queues — prevents collisions in shared Redis. */
export const QUEUE_PREFIX = 'parako' as const;

/** Centralised queue name registry — add new queues here. */
export const QUEUE_NAMES = {
  BACKGROUND_TASKS: 'background-tasks',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Sensible defaults applied to every job unless the caller overrides. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: { age: 24 * 3600, count: 200 },
  removeOnFail: { age: 7 * 24 * 3600, count: 500 },
};

/** Worker defaults — tune concurrency per-queue via overrides. */
export const DEFAULT_WORKER_OPTIONS: Pick<
  WorkerOptions,
  'concurrency' | 'lockDuration' | 'stalledInterval'
> = {
  concurrency: 5,
  lockDuration: 30_000,
  stalledInterval: 30_000,
};

/**
 * Derive a cron expression for JWKS rotation from the configured
 * `rotation_interval_days`.
 *
 * - 1-6 days  → run daily at 02:00 UTC
 * - 7-29 days → run weekly on Sunday at 02:00 UTC
 * - 30+ days  → run on the 1st of each month at 02:00 UTC
 *
 * The rotation handler itself uses `needsRotation()` as the final gate,
 * so running the check more often than strictly needed is harmless.
 */
export function deriveRotationCron(intervalDays: number): string {
  if (intervalDays <= 6) return '0 2 * * *'; // daily
  if (intervalDays <= 29) return '0 2 * * 0'; // weekly (Sunday)
  return '0 2 1 * *'; // monthly (1st)
}
