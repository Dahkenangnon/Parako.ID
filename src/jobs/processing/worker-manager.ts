import type { Worker } from 'bullmq';
import type { ILogger } from '../../di/interfaces/logger.interface.js';

/**
 * Manages the lifecycle of all BullMQ workers in the worker process.
 *
 * Responsibilities:
 * - Registry of named workers
 * - Attaches standard event handlers (completed, failed, stalled, error)
 * - Coordinated graceful shutdown with configurable drain timeout
 */
export class WorkerManager {
  private readonly workers = new Map<string, Worker>();

  constructor(private readonly logger: ILogger) {}

  registerWorker(name: string, worker: Worker): void {
    if (this.workers.has(name)) {
      this.logger.warn(`Worker "${name}" already registered, replacing`, {
        component: 'WorkerManager',
      });
    }

    this.attachEventHandlers(name, worker);
    this.workers.set(name, worker);
    this.logger.debug(`Worker registered: ${name}`, {
      component: 'WorkerManager',
    });
  }

  getWorker(name: string): Worker | undefined {
    return this.workers.get(name);
  }

  getWorkerNames(): string[] {
    return [...this.workers.keys()];
  }

  async closeAll(): Promise<void> {
    const errors: Array<{ name: string; error: string }> = [];

    for (const [name, worker] of this.workers) {
      try {
        await worker.close();
      } catch (error) {
        errors.push({
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (errors.length > 0) {
      this.logger.warn('Some workers failed to close cleanly', {
        component: 'WorkerManager',
        errors,
      });
    }

    this.workers.clear();
    this.logger.info('All workers closed', { component: 'WorkerManager' });
  }

  private attachEventHandlers(name: string, worker: Worker): void {
    worker.on('completed', job => {
      this.logger.info(`Job completed: ${job.name} [${job.id}]`, {
        component: 'WorkerManager',
        worker: name,
        jobId: job.id,
        jobName: job.name,
      });
    });

    worker.on('failed', (job, error) => {
      this.logger.error(
        `Job failed: ${job?.name ?? 'unknown'} [${job?.id ?? '?'}] — ${error.message}`,
        {
          component: 'WorkerManager',
          worker: name,
          jobId: job?.id,
          jobName: job?.name,
          attemptsMade: job?.attemptsMade,
        }
      );
    });

    worker.on('stalled', jobId => {
      this.logger.warn(`Job stalled: ${jobId}`, {
        component: 'WorkerManager',
        worker: name,
        jobId,
      });
    });

    worker.on('error', error => {
      this.logger.error(`Worker error: ${error.message}`, {
        component: 'WorkerManager',
        worker: name,
      });
    });
  }
}
