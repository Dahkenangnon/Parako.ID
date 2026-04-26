import { z } from 'zod';
import type { BackgroundJobData } from '../worker.js';
import type { INotificationService } from '../../../../di/interfaces/notification-service.interface.js';
import type { IActivityService } from '../../../../di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../../../di/interfaces/logger.interface.js';
import { checkBreachBySha1 } from '../../../../utils/password-breach.js';

/**
 * Zod schema to validate password breach check job payload.
 */
const PasswordBreachCheckSchema = z.object({
  type: z.string(),
  name: z.literal('password-breach-check'),
  sha1Prefix: z.string().length(5),
  sha1Suffix: z.string().min(1),
  userId: z.string(),
  email: z.string(),
  username: z.string(),
  tenantId: z.string().optional(),
  apiTimeoutMs: z.number().int().min(500).default(3000),
  minBreachCount: z.number().int().min(1).default(1),
});

/**
 * Password breach check handler for the background-tasks worker.
 *
 * Checks a pre-computed SHA1 hash against HIBP and, if breached,
 * sends a security alert email and logs an audit activity.
 */
export function createPasswordBreachCheckHandler(
  notificationService: INotificationService,
  activityService: IActivityService,
  logger: ILogger
) {
  return async (
    data: BackgroundJobData,
    _reportProgress: (progress: number) => Promise<void>
  ): Promise<unknown> => {
    const parsed = PasswordBreachCheckSchema.parse(data);
    const {
      sha1Prefix,
      sha1Suffix,
      userId,
      email,
      username,
      apiTimeoutMs,
      minBreachCount,
    } = parsed;

    const result = await checkBreachBySha1(
      sha1Prefix,
      sha1Suffix,
      apiTimeoutMs
    );

    if (!result.breached || result.count < minBreachCount) {
      logger.debug('Password breach check: not breached or below threshold', {
        userId,
        breached: result.breached,
        count: result.count,
        minBreachCount,
      });
      return {
        checked: true,
        breached: result.breached,
        breachCount: result.count,
        notified: false,
      };
    }

    // Password is breached — notify user and log activity
    let notified = false;

    // Log activity first (always succeeds since it's async-queued)
    activityService.warning(
      'password_breach_detected',
      `Password found in ${result.count} known data breaches`,
      { _id: userId, username, email },
      {
        metadata: {
          breachCount: result.count,
          source: 'hibp_login_check',
        },
      }
    );

    try {
      await notificationService.sendSecurityAlert(
        { userId, email, username },
        'password_breached',
        {
          breachCount: result.count,
          recommendation:
            'Change your password immediately and avoid reusing passwords across services.',
        }
      );
      notified = true;
    } catch (error) {
      logger.error('Failed to send breach notification email', {
        userId,
        error: (error as Error).message,
      });
    }

    return {
      checked: true,
      breached: true,
      breachCount: result.count,
      notified,
    };
  };
}
