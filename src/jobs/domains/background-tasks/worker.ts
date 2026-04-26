import { Worker, Job } from 'bullmq';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  DEFAULT_WORKER_OPTIONS,
} from '../../config.js';
import { buildQueueRedisOptions, type QueueRedisOptions } from '../../redis.js';
import {
  tenantContext,
  DEFAULT_TENANT_ID,
} from '../../../multi-tenancy/tenant-context.js';

/**
 * Typed payload for background task jobs.
 *
 * Every job in the background-tasks queue MUST include `name` (used to
 * dispatch to the correct handler) and `type` (metadata for logging).
 * `tenantId` enables multi-tenant isolation in the future.
 */
export interface BackgroundJobData {
  type: string;
  name: string;
  tenantId?: string;
  [key: string]: unknown;
}

/**
 * Handler function signature for background tasks.
 *
 * @param data - The job payload (typed as BackgroundJobData)
 * @param reportProgress - Callback to update the job's progress (0-100)
 * @returns The job result (stored in BullMQ for introspection)
 */
export type TaskHandler = (
  data: BackgroundJobData,
  reportProgress: (progress: number) => Promise<void>
) => Promise<unknown>;

/** Internal registry: task name → handler function */
const taskHandlers = new Map<string, TaskHandler>();

/**
 * Register a named task handler. Must be called before the worker
 * starts processing jobs that reference this task name.
 */
export function registerTaskHandler(name: string, handler: TaskHandler): void {
  taskHandlers.set(name, handler);
}

/** Retrieve a registered handler (used in tests and the processor). */
export function getTaskHandler(name: string): TaskHandler | undefined {
  return taskHandlers.get(name);
}

/**
 * Factory for the background-tasks worker.
 *
 * The worker picks jobs off the `background-tasks` queue and dispatches
 * them to the matching registered handler based on `job.data.name`.
 *
 * Jobs without a matching handler are rejected immediately so they
 * exhaust their retry budget and land in the failed set for inspection.
 */
export function createBackgroundTaskWorker(
  redisOpts: QueueRedisOptions
): Worker {
  return new Worker(
    QUEUE_NAMES.BACKGROUND_TASKS,
    async (job: Job<BackgroundJobData>) => {
      const taskName = job.data?.name;

      if (!taskName) {
        throw new Error(`Job ${job.id} is missing "name" in data payload`);
      }

      const handler = taskHandlers.get(taskName);

      if (!handler) {
        throw new Error(
          `No handler registered for task "${taskName}" (job ${job.id})`
        );
      }

      // (DB queries, Redis keys, etc.) execute within the correct tenant.
      const tenantId = job.data.tenantId || DEFAULT_TENANT_ID;
      return tenantContext.run(tenantId, () =>
        handler(job.data, (progress: number) => job.updateProgress(progress))
      );
    },
    {
      connection: buildQueueRedisOptions(redisOpts),
      prefix: QUEUE_PREFIX,
      concurrency: DEFAULT_WORKER_OPTIONS.concurrency,
      lockDuration: DEFAULT_WORKER_OPTIONS.lockDuration,
      stalledInterval: DEFAULT_WORKER_OPTIONS.stalledInterval,
    }
  );
}
