import type { Request } from 'express';

import type {
  IActivityService,
  ActivityOptions,
  ActivityUser,
  ActorInfo,
} from '../di/interfaces/activity-service.interface.js';
import type { IClientDeviceInfoManager } from '../di/interfaces/client-device-info-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';

/**
 * Request-scoped activity logger.
 *
 * Auto-injects `ip_address`, `user_agent`, `device_infos`, the
 * resolved `actor`, and the `requestId` correlation id (matching the
 * value `RequestLoggerMiddleware` stamps onto the HTTP log line and
 * the `X-Request-ID` response header).
 *
 * Caller-supplied fields are NEVER overwritten — `client_id`,
 * `interaction_uid`, `grantId`, `requested_scopes`, `target`, and an
 * explicit `actor` all pass through verbatim.
 *
 * Actor resolution precedence:
 *   1. Caller-supplied `actor` in `extra`.
 *   2. Active browser-session user (tagged with `defaultActorType`).
 *   3. `{ actor_type: 'anonymous' }` when no session user exists.
 *
 * The OIDC flow handlers always supply an explicit `actor` resolved
 * from the OIDC `session.accountId` so the audit record names the
 * authenticated end-user, not whatever browser-session principal
 * happens to be active.
 */

export interface ActivityLoggerDeps {
  activityService: IActivityService;
  sessionManager: Pick<ISessionManager, 'getActiveUser'>;
  clientDeviceInfoManager: Pick<
    IClientDeviceInfoManager,
    'getClientInfoFromRequest'
  >;
}

export type ActivityLevel = 'success' | 'failed' | 'info' | 'warning';

export interface RequestActivityLogger {
  success(
    type: string,
    user?: ActivityUser | null,
    description?: string,
    extra?: ActivityOptions
  ): void;
  failed(
    type: string,
    user?: ActivityUser | null,
    description?: string,
    extra?: ActivityOptions
  ): void;
  info(
    type: string,
    user?: ActivityUser | null,
    description?: string,
    extra?: ActivityOptions
  ): void;
  warning(
    type: string,
    user?: ActivityUser | null,
    description?: string,
    extra?: ActivityOptions
  ): void;
}

/** Default actor resolver: browser session → anonymous. */
function resolveActor(
  deps: ActivityLoggerDeps,
  req: Request,
  defaultActorType: ActorInfo['actor_type']
): ActorInfo {
  const sessionUser = deps.sessionManager.getActiveUser(req);
  if (sessionUser) {
    return {
      id: (sessionUser as { id?: string }).id,
      username: sessionUser.username,
      email: sessionUser.email,
      full_name: (sessionUser as { full_name?: string }).full_name,
      given_name: (sessionUser as { given_name?: string }).given_name,
      family_name: (sessionUser as { family_name?: string }).family_name,
      role: (sessionUser as { role?: string }).role,
      is_admin: (sessionUser as { is_admin?: boolean }).is_admin,
      actor_type: defaultActorType ?? 'user',
    };
  }
  return { actor_type: 'anonymous' };
}

export interface ActivityLoggerOptions {
  /**
   * Actor type used when the active browser-session user is the actor
   * (e.g. `'admin'` from admin controllers, `'user'` from account
   * controllers). Ignored when the caller passes an explicit `actor`
   * in `extra`.
   */
  defaultActorType?: ActorInfo['actor_type'];
}

export function activityLoggerFor(
  deps: ActivityLoggerDeps,
  req: Request,
  options: ActivityLoggerOptions = {}
): RequestActivityLogger {
  const deviceInfos =
    deps.clientDeviceInfoManager.getClientInfoFromRequest(req);
  const requestId = (req as Request & { requestId?: string }).requestId;
  const defaultActor = resolveActor(
    deps,
    req,
    options.defaultActorType ?? 'user'
  );

  const log = (
    level: ActivityLevel,
    type: string,
    user: ActivityUser | null | undefined,
    description: string,
    extra: ActivityOptions = {}
  ): void => {
    const callerMetadata =
      extra.metadata && typeof extra.metadata === 'object'
        ? extra.metadata
        : {};

    const merged: ActivityOptions = {
      ip_address: extra.ip_address ?? deviceInfos.ip,
      user_agent: extra.user_agent ?? deviceInfos.user_agent,
      device_infos: extra.device_infos ?? deviceInfos,
      actor: extra.actor ?? defaultActor,
      client_id: extra.client_id,
      is_private: extra.is_private,
      related_activity_id: extra.related_activity_id,
      target: extra.target,
      metadata: {
        ...callerMetadata,
        ...(requestId && !('requestId' in callerMetadata) ? { requestId } : {}),
      },
    };

    deps.activityService[level](type, description, user ?? null, merged);
  };

  return {
    success: (type, user, description = '', extra) =>
      log('success', type, user, description, extra),
    failed: (type, user, description = '', extra) =>
      log('failed', type, user, description, extra),
    info: (type, user, description = '', extra) =>
      log('info', type, user, description, extra),
    warning: (type, user, description = '', extra) =>
      log('warning', type, user, description, extra),
  };
}
