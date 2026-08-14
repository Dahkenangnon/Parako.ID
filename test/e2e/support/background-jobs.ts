import { Queue } from 'bullmq';

import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  QUEUE_PREFIX,
} from '../../../src/jobs/config.js';
import { buildQueueRedisOptions } from '../../../src/jobs/redis.js';

export function createE2eBackgroundQueue(): Queue {
  const redisOptions = buildQueueRedisOptions({
    host: process.env.PARAKO_E2E_REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.PARAKO_E2E_REDIS_PORT ?? '6379'),
    database: Number(process.env.PARAKO_E2E_REDIS_DATABASE ?? '15'),
    password: process.env.PARAKO_E2E_REDIS_PASSWORD || undefined,
  });

  return new Queue(QUEUE_NAMES.BACKGROUND_TASKS, {
    connection: redisOptions,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}
