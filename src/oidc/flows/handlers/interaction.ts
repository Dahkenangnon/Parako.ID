import { Request, Response, NextFunction } from 'express';
import Provider, { Client, Grant, InteractionResults } from 'oidc-provider';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../../di/types.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IUserService } from '../../../di/interfaces/user-service.interface.js';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { IOIDCInteractionHandler } from '../../../di/interfaces/oidc-interaction-handler.interface.js';
import type { ISessionManager } from '../../../di/interfaces/session-manager.interface.js';
import type { INotificationService } from '../../../di/interfaces/notification-service.interface.js';
import type { IMfaUtils } from '../../../di/interfaces/mfa-utils.interface.js';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';

/**
 * OIDC Interaction Handler
 * Handles OIDC interaction flows
 */
@injectable()
export class OIDCInteractionHandler implements IOIDCInteractionHandler {
  private readonly oidcPath: string;

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.NotificationService)
    private readonly notificationService: INotificationService,
    @inject(TYPES.MfaUtils) private readonly mfaUtils: IMfaUtils,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils
  ) {
    this.oidcPath = this.configManager.getConfig().oidc.path;
  }

  /**
   * GET /interaction/:uid handler
   * Displays login or consent screens based on the interaction details
   */
  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
    provider: Provider
  ): Promise<void> => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const { uid, prompt, params, session } = interactionDetails;

      const client: Client = (await provider.Client.find(
        params.client_id as string
      )) as Client;

      // Generate CSRF token for OIDC forms
      if (!this.sessionManager.get(req, 'csrfToken')) {
        this.sessionManager.generateCsrfToken(req);
      }

      const templateVars = this.oidcUtils.prepareTemplateVariables(
        prompt,
        params,
        req
      );
      res.locals = {
        ...res.locals,
        ...templateVars,
      };

      switch (prompt.name) {
        case 'login': {
          if (await this.sessionManager.isAuthenticated(req)) {
            const activeUser = this.sessionManager.getActiveUser(req);

            if (!activeUser || !activeUser.username) {
              this.logger.warn(
                'Session is authenticated but activeUser is missing or invalid'
              );

              const stepMessage = (params.step_message as string) || '';

              return res.render(this.viewResolver.views.auth.oidc.login, {
                client,
                uid,
                details: prompt.details,
                params,
                title: `Sign-in - ${this.configManager.getConfig().application.title}`,
                stepMessage: stepMessage.trim(),
              });
            }

            const result: InteractionResults = {
              login: {
                accountId: activeUser.username,
              },
            };

            try {
              const currentAuthUsers =
                this.sessionManager.getAuthenticatedUsers(req);
              if (currentAuthUsers && currentAuthUsers.active) {
                currentAuthUsers.active.last_used = Date.now();
                this.sessionManager.set(
                  req,
                  'authenticatedUsers',
                  currentAuthUsers
                );
              }
            } catch (error) {
              this.logger.error(error as Error, {
                context: 'Error updating lastUsed timestamp',
              });
            }

            try {
              await this.userService.updateUserLastLoginDate(
                activeUser.id,
                activeUser.username
              );
            } catch (error) {
              this.logger.error(error as Error, {
                context: 'Error updating last login date',
              });
            }

            return await provider.interactionFinished(req, res, result, {
              mergeWithLastSubmission: false,
            });
          }

          // Steps messages for custom invitation text which is displayed
          // in the login form
          const stepMessage = (params.step_message as string) || '';

          return res.render(this.viewResolver.views.auth.oidc.login, {
            client,
            uid,
            details: prompt.details,
            params,
            title: `Sign-in - ${this.configManager.getConfig().application.title}`,
            stepMessage: stepMessage.trim(),
            csrfToken: this.sessionManager.get(req, 'csrfToken'),
          });
        }

        case 'mfa': {
          this.logger.debug('MFA prompt triggered', {
            uid,
            promptName: prompt.name,
          });
          const activeUser = this.sessionManager.getActiveUser(req);
          if (!activeUser) {
            this.logger.warn('MFA prompt reached without active session');
            return res.redirect(`${this.oidcPath}/interaction/${uid}`);
          }

          try {
            const userDoc = await this.userService.findByUsername(
              activeUser.username
            );
            if (!userDoc?.mfa?.enabled || !userDoc.mfa.methods) {
              this.logger.warn(
                'MFA prompt but user does not have MFA enabled',
                { username: activeUser.username }
              );

              return await provider.interactionFinished(
                req,
                res,
                {
                  login: {
                    accountId: activeUser.username,
                    amr: ['pwd'],
                    acr: 'urn:pwd',
                  },
                  ts: Math.floor(Date.now() / 1000),
                },
                { mergeWithLastSubmission: false }
              );
            }

            const enabledMethods = this.mfaUtils.getEnabledMethods(userDoc);

            if (enabledMethods.length === 0) {
              // No methods enabled, skip MFA
              return await provider.interactionFinished(
                req,
                res,
                {
                  login: {
                    accountId: activeUser.username,
                    amr: ['pwd'],
                    acr: 'urn:pwd',
                  },
                  ts: Math.floor(Date.now() / 1000),
                },
                { mergeWithLastSubmission: false }
              );
            }

            const selectedMethod =
              (this.sessionManager.get(req, 'selectedMfaMethod') as string) ||
              null;

            // If multiple methods enabled and no selection made, show selection page
            if (enabledMethods.length > 1 && !selectedMethod) {
              this.logger.info('Showing MFA method selection page', {
                username: activeUser.username,
                enabledMethods,
              });

              return res.render(this.viewResolver.views.auth.oidc.mfa_select, {
                client,
                uid,
                params,
                title: `Choose Verification - ${this.configManager.getConfig().application.title}`,
                enabledMethods: {
                  totp: enabledMethods.includes('totp'),
                  email: enabledMethods.includes('email'),
                  webauthn: enabledMethods.includes('webauthn'),
                },
                selectUrl: `${this.oidcPath}/interaction/${uid}/mfa/select`,
                csrfToken: this.sessionManager.get(req, 'csrfToken'),
              });
            }

            const mfaMethod =
              selectedMethod ||
              userDoc.mfa.preferred_method ||
              enabledMethods[0];

            if (selectedMethod) {
              this.sessionManager.set(req, 'selectedMfaMethod', null);
            }

            if (mfaMethod === 'webauthn') {
              this.logger.info('WebAuthn MFA requested for user', {
                username: activeUser.username,
              });

              return res.render(
                this.viewResolver.views.auth.oidc.mfa_webauthn,
                {
                  client,
                  uid,
                  params,
                  title: `Passkey Verification - ${this.configManager.getConfig().application.title}`,
                  user: { ...activeUser, mfa_method: 'webauthn' },
                  csrfToken: this.sessionManager.get(req, 'csrfToken'),
                }
              );
            }

            if (mfaMethod === 'email') {
              this.logger.info('Email MFA requested for user', {
                username: activeUser.username,
              });

              const otpResult = this.mfaUtils.generateEmailOtp(600);
              await this.userService.setEmailOtp(
                activeUser.username,
                otpResult.code,
                600
              );

              await this.notificationService.sendTemplatedEmail(
                userDoc.email ?? '',
                `Your ${this.configManager.getConfig().application.title} login code`,
                'email/mail.njk',
                {
                  title: `Your ${this.configManager.getConfig().application.title} login code`,
                  content: `<p>Your one-time code to finish the login process is <strong>${otpResult.code}</strong>. It expires in 10 minutes.</p>
                    <p>For your security, never share this code with anyone. If you did not request this code, please ignore this email.</p>`,
                  username:
                    `${userDoc.given_name || ''} ${userDoc.family_name || ''}`.trim(),
                }
              );
            } else if (mfaMethod === 'totp') {
              this.logger.info('TOTP MFA requested for user', {
                username: activeUser.username,
              });
            }

            return res.render(this.viewResolver.views.auth.oidc.mfa, {
              client,
              uid,
              params,
              title: `Two-Factor Authentication - ${this.configManager.getConfig().application.title}`,
              user: { ...activeUser, mfa_method: mfaMethod },
              csrfToken: this.sessionManager.get(req, 'csrfToken'),
            });
          } catch (err) {
            // On error, skip MFA
            this.logger.error(err as Error, { context: 'MFA setup error' });
            return await provider.interactionFinished(
              req,
              res,
              {
                login: {
                  accountId: activeUser.username,
                  amr: ['pwd'],
                  acr: 'urn:pwd',
                },
                ts: Math.floor(Date.now() / 1000),
              },
              { mergeWithLastSubmission: false }
            );
          }
        }

        case 'consent': {
          // For internal clients, we don't need to show the consent screen
          // because the client is already trusted.
          if (client.isInternalClient) {
            this.logger.info('Client is internal, skipping consent', {
              clientId: client.clientId,
            });

            let grant: Grant | undefined;
            if (interactionDetails.grantId) {
              grant = (await provider.Grant.find(
                interactionDetails.grantId
              )) as Grant;
            } else {
              grant = new provider.Grant({
                accountId: session?.accountId,
                clientId: params.client_id as string,
              }) as Grant;
            }

            if (
              prompt.details.missingOIDCScope &&
              Array.isArray(prompt.details.missingOIDCScope)
            ) {
              grant.addOIDCScope(prompt.details.missingOIDCScope.join(' '));
            }

            if (
              prompt.details.missingOIDCClaims &&
              Array.isArray(prompt.details.missingOIDCClaims)
            ) {
              grant.addOIDCClaims(prompt.details.missingOIDCClaims);
            }

            if (prompt.details.missingResourceScopes) {
              for (const [rs, scopes] of Object.entries(
                prompt.details.missingResourceScopes
              )) {
                if (Array.isArray(scopes)) {
                  grant.addResourceScope(rs, scopes.join(' '));
                }
              }
            }

            const grantId = await grant.save();

            const consent: Record<string, any> = {};
            if (!interactionDetails.grantId) {
              consent.grantId = grantId;
            }

            return provider.interactionFinished(
              req,
              res,
              { consent },
              { mergeWithLastSubmission: true }
            );
          }

          // Below will run for non-internal clients where user consent is required
          const activeUser = this.sessionManager.getActiveUser(req);
          const user = this.oidcUtils.formatUserForTemplate(activeUser);

          return res.render(this.viewResolver.views.auth.oidc.consent, {
            client: {
              clientName:
                (client as any).clientName ||
                (client as any).client_name ||
                'Application',
              clientId: (client as any).clientId || (client as any).client_id,
              policyUri:
                (client as any).policyUri || (client as any).policy_uri,
              tosUri: (client as any).tosUri || (client as any).tos_uri,
              clientUri:
                (client as any).clientUri || (client as any).client_uri,
              logoUri:
                (client as any).logoUri ||
                (client as any).logo_uri ||
                '/images/logo-light.svg',
            },
            uid,
            details: prompt.details,
            params,
            title: `Authorize Access - ${this.configManager.getConfig().application.title}`,
            user,
            scopes: this.oidcUtils.transformScopesForTemplate(
              new Set(templateVars.missingOIDCScope)
            ),
            csrfToken: this.sessionManager.get(req, 'csrfToken'),
          });
        }

        case 'select_account': {
          this.logger.debug('Processing select_account prompt', { uid });

          const authenticatedUsers =
            this.sessionManager.getAuthenticatedUsers(req);

          if (
            !authenticatedUsers ||
            (!authenticatedUsers.active &&
              (!authenticatedUsers.others ||
                authenticatedUsers.others.length === 0))
          ) {
            this.logger.warn('No accounts available for select_account prompt');

            const oidcInteractionUrl = `${this.configManager.getConfig().deployment.url}${this.oidcPath}/interaction/${uid}`;

            // Show a user-friendly page that allows authentication instead of an error
            // He will be able to click and login internally, then continue the same flow
            return res.render(this.viewResolver.views.auth.account_select, {
              title: `Select Account - ${this.configManager.getConfig().application.title}`,
              message: 'Select Account',
              client,
              uid,
              details: prompt.details,
              params,
              clientName:
                client.clientName || client.client_name || 'Application',
              clientLogo:
                client.logoUri || client.logo_uri || '/images/logo-light.svg',
              accounts: [],
              interactionUid: uid,
              csrfToken: this.sessionManager.get(req, 'csrfToken'),
              noAccountsAvailable: true,
              continueUrl: oidcInteractionUrl,
            });
          }

          res.locals = {
            ...res.locals,
            csrfToken: this.sessionManager.get(req, 'csrfToken'),
          };

          const accounts =
            this.oidcUtils.prepareAccountsList(authenticatedUsers);
          const oidcInteractionUrl = `${this.configManager.getConfig().deployment.url}${this.oidcPath}/interaction/${uid}`;

          return res.render(this.viewResolver.views.auth.account_select, {
            title: `Select Account - ${this.configManager.getConfig().application.title}`,
            message: 'Select Account',
            client,
            uid,
            details: prompt.details,
            params,
            clientName:
              client.clientName || client.client_name || 'Application',
            clientLogo:
              client.logoUri || client.logo_uri || '/images/logo-light.svg',
            accounts,
            interactionUid: uid,
            continueUrl: oidcInteractionUrl,
            csrfToken: this.sessionManager.get(req, 'csrfToken'),
          });
        }

        default:
          return next();
      }
    } catch (err) {
      this.logger.error(err as Error, {
        context: 'Error in interaction handler',
      });
      return next(err);
    }
  };
}
