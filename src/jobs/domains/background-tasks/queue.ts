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

/** Cached reachability result — checked once per process lifetime. */
let redisReachable: boolean | null = null;

/**
 * Factory for the background-tasks queue.
 *
 * Verifies Redis reachability on first call (cached for subsequent calls).
 * Returns `null` when Redis is not configured or unreachable — callers
 * must handle this gracefully (skip enqueueing, return error to user, etc.).
 *
 * The queue is the producer side — it stores jobs to be processed by
 * the corresponding worker. Callers schedule work via `queue.add()`.
 */
export async function createBackgroundTaskQueue(
  redisOpts: QueueRedisOptions | undefined
): Promise<Queue | null> {
  if (redisReachable === null) {
    const check = await checkRedisAvailability(redisOpts);
    redisReachable = check.available;
  }

  if (!redisReachable || !redisOpts) {
    return null;
  }

  return new Queue(QUEUE_NAMES.BACKGROUND_TASKS, {
    connection: buildQueueRedisOptions(redisOpts),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}
