import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  DEFAULT_JOB_OPTIONS,
} from '../../config.js';
import {
  buildQueueRedisOptions,
  checkRedisAvailability,
  type QueueRedisOptions,
} from '../../redis.js';

/** Cached reachability result for the most recently checked configuration. */
let redisReachable: boolean | null = null;
let checkedRedisOptionsKey: string | null = null;

/**
 * Factory for the background-tasks queue.
 *
 * Verifies Redis reachability for each distinct configuration (cached for
 * subsequent calls with the same options).
 * Returns `null` when Redis is not configured or unreachable — callers
 * must handle this gracefully (skip enqueueing, return error to user, etc.).
 *
 * The queue is the producer side — it stores jobs to be processed by
 * the corresponding worker. Callers schedule work via `queue.add()`.
 */
export async function createBackgroundTaskQueue(
  redisOpts: QueueRedisOptions | undefined
): Promise<Queue | null> {
  if (!redisOpts) {
    return null;
  }

  const redisOptionsKey = JSON.stringify([
    redisOpts.host,
    redisOpts.port,
    redisOpts.password ?? null,
    redisOpts.database ?? 0,
  ]);

  if (redisReachable === null || checkedRedisOptionsKey !== redisOptionsKey) {
    const check = await checkRedisAvailability(redisOpts);
    redisReachable = check.available;
    checkedRedisOptionsKey = redisOptionsKey;
  }

  if (!redisReachable) {
    return null;
  }

  return new Queue(QUEUE_NAMES.BACKGROUND_TASKS, {
    connection: buildQueueRedisOptions(redisOpts),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}
