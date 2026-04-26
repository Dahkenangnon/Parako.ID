import { describe, it, expect } from 'vitest';
import {
  DEFAULT_JOB_OPTIONS,
  DEFAULT_WORKER_OPTIONS,
  deriveRotationCron,
} from '../../../src/jobs/config.js';

describe('Jobs config', () => {
  it('DEFAULT_JOB_OPTIONS should configure 3 attempts with exponential backoff', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
      type: 'exponential',
      delay: 1000,
    });
  });

  it('DEFAULT_JOB_OPTIONS should have removal policies', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toBeDefined();
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBeDefined();
  });

  it('DEFAULT_WORKER_OPTIONS should have concurrency, lockDuration, and stalledInterval', () => {
    expect(DEFAULT_WORKER_OPTIONS.concurrency).toBeGreaterThan(0);
    expect(DEFAULT_WORKER_OPTIONS.lockDuration).toBeGreaterThan(0);
    expect(DEFAULT_WORKER_OPTIONS.stalledInterval).toBeGreaterThan(0);
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
