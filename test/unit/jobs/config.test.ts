import { describe, it, expect } from 'vitest';
import {
  DEFAULT_JOB_OPTIONS,
  DEFAULT_WORKER_OPTIONS,
  QUEUE_NAMES,
  QUEUE_PREFIX,
  deriveRotationCron,
} from '../../../src/jobs/config.js';

describe('Jobs config', () => {
  it('namespaces the background queue in shared Redis deployments', () => {
    expect(QUEUE_PREFIX).toBe('parako');
    expect(QUEUE_NAMES).toEqual({ BACKGROUND_TASKS: 'background-tasks' });
  });

  it('applies bounded retry and retention policies to every job', () => {
    expect(DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1_000,
      },
      removeOnComplete: { age: 24 * 3_600, count: 200 },
      removeOnFail: { age: 7 * 24 * 3_600, count: 500 },
    });
  });

  it('uses explicit concurrency and lock timing for workers', () => {
    expect(DEFAULT_WORKER_OPTIONS).toEqual({
      concurrency: 5,
      lockDuration: 30_000,
      stalledInterval: 30_000,
    });
  });
});

describe('deriveRotationCron()', () => {
  it('returns daily cron for intervals <= 6 days', () => {
    expect(deriveRotationCron(1)).toBe('0 2 * * *');
    expect(deriveRotationCron(6)).toBe('0 2 * * *');
  });

  it('returns weekly cron for intervals 7-29 days', () => {
    expect(deriveRotationCron(7)).toBe('0 2 * * 0');
    expect(deriveRotationCron(14)).toBe('0 2 * * 0');
    expect(deriveRotationCron(29)).toBe('0 2 * * 0');
  });

  it('returns monthly cron for intervals >= 30 days', () => {
    expect(deriveRotationCron(30)).toBe('0 2 1 * *');
    expect(deriveRotationCron(90)).toBe('0 2 1 * *');
    expect(deriveRotationCron(365)).toBe('0 2 1 * *');
  });
});
