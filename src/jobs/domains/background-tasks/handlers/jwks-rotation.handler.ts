import { z } from 'zod';
import type { IKeyStore } from '../../../../di/interfaces/key-store.interface.js';
import type { ILogger } from '../../../../di/interfaces/logger.interface.js';
import type { BackgroundJobData } from '../worker.js';

/**
 * Zod schema to validate JWKS rotation job data.
 * Ensures the worker rejects malformed payloads instead of proceeding
 * with undefined behavior.
 */
const JwksRotationJobSchema = z.object({
  type: z.string(),
  name: z.literal('jwks-rotation'),
  phase: z.enum(['promote']).optional(),
  tenantId: z.string().optional(),
});

export interface JwksRotationResult {
  rotated: boolean;
  promoted?: boolean;
  promotionScheduled?: boolean;
  promotionDelayMs?: number;
  reason?: string;
  error?: string;
}

export interface JwksRotationOptions {
  /** Milliseconds to delay promotion after rotation. 0 = immediate. */
  promotionDelayMs?: number;
  /**
   * Callback to schedule a delayed BullMQ job for Phase 2 (promotion).
   * If not provided and delay > 0, falls back to immediate promotion.
   */
  scheduleDelayedPromotion?: (delayMs: number) => Promise<void>;
}

/**
 * Background task handler for automatic JWKS key rotation.
 *
 * Supports two modes via `data.phase`:
 *
 * **Full rotation (phase undefined):**
 *   Phase 1 (rotate): New keys generated as unpromoted (verification only)
 *   Phase 2 (promote): Keys promoted to signing priority
 *   - With `promotionDelayMs=0`: both phases run in a single job
 *   - With `promotionDelayMs>0` + `scheduleDelayedPromotion`: Phase 1 runs,
 *     then a delayed BullMQ job is scheduled for Phase 2 (survives restarts)
 *
 * **Promotion only (phase='promote'):**
 *   Runs Phase 2 only — called by the delayed BullMQ job after Phase 1.
 *
 * The handler is intentionally pure — it receives its dependencies
 * explicitly so it can be unit-tested without a DI container.
 */
export async function jwksRotationHandler(
  data: BackgroundJobData,
  reportProgress: (progress: number) => Promise<void>,
  keyStore: IKeyStore,
  logger?: ILogger,
  onRotated?: () => Promise<void>,
  onPromoted?: () => Promise<void>,
  options?: JwksRotationOptions
): Promise<JwksRotationResult> {
  const log = (msg: string, ctx?: Record<string, unknown>) =>
    logger?.info(msg, { component: 'jwks-rotation', ...ctx });

  const parseResult = JwksRotationJobSchema.safeParse(data);
  if (!parseResult.success) {
    const message = `Invalid JWKS rotation job data: ${parseResult.error.message}`;
    logger?.error(message, { component: 'jwks-rotation', data });
    throw new Error(message);
  }

  const { tenantId } = parseResult.data;

  // ── Promotion-only phase (scheduled by a previous rotation job) ──
  if (parseResult.data.phase === 'promote') {
    return handlePromotionPhase(
      keyStore,
      reportProgress,
      log,
      onPromoted,
      tenantId
    );
  }

  // ── Full rotation flow ──
  try {
    log('Checking if key rotation is needed');
    const needs = await keyStore.needsRotation(tenantId);
    await reportProgress(25);

    if (!needs) {
      log('Key rotation not due, skipping');
      return { rotated: false, reason: 'not-due' };
    }

    // Phase 1: generate new unpromoted keys, move old active → expiring
    log('Rotating keys (phase 1: unpromoted)');
    await keyStore.rotate(tenantId);
    await reportProgress(50);

    if (onRotated) {
      log('Notifying web process of key rotation (phase 1)');
      await onRotated();
    }

    const delayMs = options?.promotionDelayMs ?? 0;
    const canSchedule =
      delayMs > 0 && typeof options?.scheduleDelayedPromotion === 'function';

    if (canSchedule) {
      // Delayed mode: schedule promotion as a separate BullMQ job
      log('Scheduling delayed promotion via BullMQ', {
        delayMs,
      });
      await options!.scheduleDelayedPromotion!(delayMs);
      await reportProgress(100);
      return {
        rotated: true,
        promotionScheduled: true,
        promotionDelayMs: delayMs,
      };
    }

    // Immediate mode: promote + retire in the same job
    log('Promoting keys (phase 2: signing priority)');
    await keyStore.promoteKeys(tenantId);
    await reportProgress(75);

    if (onPromoted) {
      log('Notifying web process of key promotion (phase 2)');
      await onPromoted();
    }

    log('Retiring expired keys past overlap window');
    await keyStore.retireExpiredKeys(tenantId);

    await reportProgress(100);

    log('Key rotation completed successfully');
    return { rotated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error(`JWKS rotation failed: ${message}`, {
      component: 'jwks-rotation',
    });
    throw error; // re-throw so BullMQ marks the job as failed
  }
}

/**
 * Handles the promotion-only phase (Phase 2), triggered by a delayed BullMQ job.
 */
async function handlePromotionPhase(
  keyStore: IKeyStore,
  reportProgress: (progress: number) => Promise<void>,
  log: (msg: string, ctx?: Record<string, unknown>) => void,
  onPromoted?: () => Promise<void>,
  tenantId?: string
): Promise<JwksRotationResult> {
  log('Running promotion-only phase (scheduled by previous rotation)');

  await keyStore.promoteKeys(tenantId);
  await reportProgress(50);

  if (onPromoted) {
    log('Notifying web process of key promotion');
    await onPromoted();
  }

  log('Retiring expired keys past overlap window');
  await keyStore.retireExpiredKeys(tenantId);
  await reportProgress(100);

  log('Promotion phase completed successfully');
  return { rotated: false, promoted: true };
}
