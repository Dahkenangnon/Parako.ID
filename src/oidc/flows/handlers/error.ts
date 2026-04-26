import { Request, Response, NextFunction } from 'express';
import { errors as oidcErrors } from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IOIDCErrorHandler } from '../../../di/interfaces/oidc-error-handler.interface.js';
import type { ClientDeviceInfos } from '../../../utils/client-info.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';

/** Known OIDC error types for validation */
const KNOWN_ERROR_TYPES = [
  'access_denied',
  'expired_session',
  'server_error',
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'account_selection_required',
  'consent_required',
  'interaction_required',
  'login_required',
] as const;

/**
 * OIDC Error Handler
 * Handles OIDC provider errors
 */
@injectable()
export class OIDCErrorHandler implements IOIDCErrorHandler {
  constructor(
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager
  ) {}

  /**
   * Render error page for OIDC errors
   */
  handle = async (
    err: oidcErrors.OIDCProviderError,
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    const deviceInfos =
      this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);

    try {
      this.activityService.failed('oidc.error', 'OIDC provider error', null, {
        ip_address: req.ip,
        user_agent: deviceInfos?.user_agent,
        device_infos: deviceInfos as ClientDeviceInfos,
        actor: {
          actor_type: 'anonymous',
        },
        target: {
          target_type: 'system',
        },
      });
    } catch {
      // No logger available in this handler, so we silently ignore logging errors
    }

    if (err.name === 'account_selection_required') {
      return res.render(this.viewResolver.views.auth.oidc.error, {
        errorType: 'account_selection_required',
        errorMessage:
          'No accounts are available for selection. Please sign in first.',
      });
    }

    // Sanitize error type - only allow known error types to prevent XSS via type comparison
    const rawErrorType = err.name || err.error || '';
    const errorType = KNOWN_ERROR_TYPES.includes(
      rawErrorType as (typeof KNOWN_ERROR_TYPES)[number]
    )
      ? rawErrorType
      : 'server_error';

    // Nunjucks autoescape will handle HTML encoding
    const rawMessage = err.message || err.error_description || '';
    const errorMessage =
      typeof rawMessage === 'string'
        ? rawMessage.slice(0, 500) // Limit message length
        : 'An error occurred during the authentication process.';

    res.render(this.viewResolver.views.auth.oidc.error, {
      errorType,
      errorMessage,
    });
  };
}
