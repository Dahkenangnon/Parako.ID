import type { Queue } from 'bullmq';
import type { ILogger } from '../../di/interfaces/logger.interface.js';

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Manages the lifecycle of all BullMQ queues in the worker process.
 *
 * Responsibilities:
 * - Registry of named queues for lookup by other subsystems
 * - Aggregated stats collection for health-check endpoints
 * - Coordinated graceful shutdown
 */
export class QueueManager {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly logger: ILogger) {}

  registerQueue(name: string, queue: Queue): void {
    if (this.queues.has(name)) {
      this.logger.warn(`Queue "${name}" already registered, replacing`, {
        component: 'QueueManager',
      });
    }
    this.queues.set(name, queue);
    this.logger.debug(`Queue registered: ${name}`, {
      component: 'QueueManager',
    });
  }

  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  getQueueNames(): string[] {
    return [...this.queues.keys()];
  }

  async getStats(): Promise<Record<string, QueueStats>> {
    const stats: Record<string, QueueStats> = {};

    for (const [name, queue] of this.queues) {
      try {
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed'
        );
        stats[name] = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        };
      } catch (error) {
        this.logger.error(
          `Failed to get stats for queue "${name}": ${error instanceof Error ? error.message : String(error)}`,
          { component: 'QueueManager' }
        );
      }
    }

    return stats;
  }

  async closeAll(): Promise<void> {
    const errors: Array<{ name: string; error: string }> = [];

    for (const [name, queue] of this.queues) {
      try {
        await queue.close();
      } catch (error) {
        errors.push({
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (errors.length > 0) {
      this.logger.warn('Some queues failed to close cleanly', {
        component: 'QueueManager',
        errors,
      });
    }

    this.queues.clear();
    this.logger.info('All queues closed', { component: 'QueueManager' });
  }
}
