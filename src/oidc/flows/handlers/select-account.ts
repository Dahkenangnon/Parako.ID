import { Request, Response, NextFunction } from 'express';
import Provider from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IOIDCSelectAccountHandler } from '../../../di/interfaces/oidc-select-account-handler.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../../../di/interfaces/client-device-info-manager.interface.js';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';
import type { ClientDeviceInfos } from '../../../utils/client-info.js';

/**
 * OIDC Select Account Handler
 * Handles account selection for OIDC interactions
 */
@injectable()
export class OIDCSelectAccountHandler implements IOIDCSelectAccountHandler {
  private readonly oidcPath: string;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils
  ) {
    this.oidcPath = this.configManager.getConfig().oidc.path;
  }

  /**
   * POST /interaction/:uid/select_account handler
   * Processes account selection for select_account prompt
   */
  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const { uid, prompt, params } = interactionDetails;

      const deviceInfos =
        this.clientDeviceInfoManager.extractDeviceInfoFromRequest(req);

      if (prompt.name !== 'select_account') {
        this.logger.error('Expected select_account prompt but got', {
          promptName: prompt.name,
        });
        return res.render(this.viewResolver.views.auth.oidc.error, {
          errorType: 'InvalidPrompt',
          errorMessage:
            'Invalid interaction prompt. Expected select_account prompt.',
        });
      }

      const validation = this.oidcUtils.validateAccountSelection(req);
      if (!validation.isValid) {
        this.sessionManager
          .flash(req)
          .error('Please select an account to continue.');
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }

      const authenticatedUsers = this.sessionManager.getAuthenticatedUsers(req);
      let selectedAccount = null;

      if (authenticatedUsers) {
        if (
          authenticatedUsers.active &&
          (authenticatedUsers.active.id === validation.accountId ||
            authenticatedUsers.active.username === validation.accountId)
        ) {
          selectedAccount = authenticatedUsers.active;
        } else {
          selectedAccount = authenticatedUsers.others.find(
            acc =>
              acc.id === validation.accountId ||
              acc.username === validation.accountId
          );
        }
      }

      if (!selectedAccount) {
        this.logger.warn('Selected account not found in session', {
          selectedAccountId: validation.accountId,
        });

        this.sessionManager
          .flash(req)
          .error('The selected account is no longer available.');
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }

      if (
        authenticatedUsers &&
        authenticatedUsers.active &&
        authenticatedUsers.active.id !== selectedAccount.id
      ) {
        const switchResult = this.sessionManager.switchUser(
          req,
          selectedAccount.id
        );

        if (!switchResult.success) {
          if (switchResult.reason === 'reauth_required') {
            this.logger.info('Account switch requires re-authentication', {
              selectedAccountId: selectedAccount.id,
              uid,
            });
            this.sessionManager
              .flash(req)
              .info('Please re-enter your password to switch accounts.');
            return res.redirect(
              `${this.oidcPath}/interaction/${uid}?switch_to=${selectedAccount.id}`
            );
          }

          this.logger.error('Failed to switch to selected account', {
            selectedAccountId: selectedAccount.id,
            reason: switchResult.reason,
          });

          this.sessionManager
            .flash(req)
            .error('Failed to switch to the selected account.');
          return res.redirect(`${this.oidcPath}/interaction/${uid}`);
        }
      }

      try {
        selectedAccount.last_used = Date.now();
        const currentAuthUsers = this.sessionManager.getAuthenticatedUsers(req);
        if (currentAuthUsers && currentAuthUsers.active) {
          currentAuthUsers.active.last_used = Date.now();
          this.sessionManager.set(req, 'authenticatedUsers', currentAuthUsers);
        }
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'Error updating lastUsed timestamp',
        });
      }

      this.logger.info('Account selected in OIDC select_account prompt', {
        uid,
        selectedAccount: selectedAccount.username,
        accountId: selectedAccount.username,
      });

      try {
        this.activityService.success(
          'oidc.select_account',
          'User selected account for OIDC login',
          null,
          {
            ip_address: req.ip,
            user_agent: req.headers['user-agent'] as string,
            client_id: params.client_id as string,
            device_infos: deviceInfos as ClientDeviceInfos,
            actor: {
              id: selectedAccount.id,
              username: selectedAccount.username,
              actor_type: 'user',
            },
            target: {
              target_type: 'none',
            },
          }
        );
      } catch (error) {
        this.logger.error(error as Error, {
          context: 'Error logging account selection activity',
        });
      }

      this.logger.debug('Completing select_account interaction', {
        uid,
        accountId: selectedAccount.username,
        accountIdType: typeof selectedAccount.username,
      });

      try {
        const result = {
          // Required to mark login flow as completed
          select_account: {
            accountId: selectedAccount.username,
          },
          login: {
            accountId: selectedAccount.username,
            amr: ['pwd'],
            acr: 'urn:pwd',
          },
          ts: Math.floor(Date.now() / 1000),
        };

        return await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: false,
        });
      } catch (interactionError) {
        this.logger.error(interactionError as Error, {
          context: 'Error completing select_account interaction',
          uid,
          accountId: selectedAccount.username,
          errorMessage: (interactionError as Error).message,
        });

        this.sessionManager
          .flash(req)
          .error('Failed to complete account selection. Please try again.');
        return res.redirect(`${this.oidcPath}/interaction/${uid}`);
      }
    } catch (err) {
      this.logger.error(err as Error, {
        context: 'Error in select account handler',
      });
      next(err);
    }
  };
}
