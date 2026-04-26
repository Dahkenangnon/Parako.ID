import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IMetricsService } from '../di/interfaces/metrics-service.interface.js';
import {
  AccessToken,
  AuthorizationCode,
  Client,
  KoaContextWithOIDC,
} from 'oidc-provider';
import Provider, { errors as oidcErrors } from 'oidc-provider';
import { tenantContext } from '../multi-tenancy/tenant-context.js';

@injectable()
export class OIDCListenerService {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.MetricsService)
    private readonly metricsService: IMetricsService
  ) {}

  public setupListeners = async (provider: Provider): Promise<void> => {
    provider.on('access_token.destroyed', async (token: AccessToken) => {
      this.logger.info('access_token.destroyed', {
        token_id: token.jti,
        client_id: token.clientId,
        account_id: token.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('access_token.saved', async (token: AccessToken) => {
      this.logger.info('access_token.saved', {
        token_id: token.jti,
        client_id: token.clientId,
        account_id: token.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('access_token.issued', async (token: AccessToken) => {
      this.logger.info('access_token.issued', {
        token_id: token.jti,
        client_id: token.clientId,
        account_id: token.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on(
      'authorization_code.consumed',
      async (code: AuthorizationCode) => {
        this.logger.info('authorization_code.consumed', {
          code_id: code.jti,
          client_id: code.clientId,
          account_id: code.accountId,
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    provider.on(
      'authorization_code.destroyed',
      async (code: AuthorizationCode) => {
        this.logger.info('authorization_code.destroyed', {
          code_id: code.jti,
          client_id: code.clientId,
          account_id: code.accountId,
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    provider.on('authorization_code.saved', async (code: AuthorizationCode) => {
      this.logger.info('authorization_code.saved', {
        code_id: code.jti,
        client_id: code.clientId,
        account_id: code.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('authorization.accepted', async (ctx: KoaContextWithOIDC) => {
      this.logger.info('authorization.accepted', {
        client_id: ctx.oidc?.client?.clientId,
        account_id: ctx.oidc?.session?.accountId,
        ip_address: ctx.ip,
        user_agent: ctx.get('user-agent'),
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on(
      'authorization.error',
      async (ctx: KoaContextWithOIDC, error: oidcErrors.OIDCProviderError) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'authorization.error',
          client_id: ctx.oidc?.client?.clientId,
          account_id: ctx.oidc?.session?.accountId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError(
          'authorization',
          undefined,
          tenant
        );
      }
    );

    provider.on('authorization.success', async (ctx: KoaContextWithOIDC) => {
      this.logger.info('authorization.success', {
        client_id: ctx.oidc?.client?.clientId,
        account_id: ctx.oidc?.session?.accountId,
        ip_address: ctx.ip,
        user_agent: ctx.get('user-agent'),
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on(
      'backchannel.error',
      async (
        ctx: KoaContextWithOIDC,
        error: Error,
        client: any,
        accountId: string,
        sid: string
      ) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'backchannel.error',
          client_id: client?.clientId,
          account_id: accountId,
          sid,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError('backchannel', undefined, tenant);
      }
    );

    provider.on(
      'backchannel.success',
      async (
        ctx: KoaContextWithOIDC,
        client: any,
        accountId: string,
        sid: string
      ) => {
        this.logger.info('backchannel.success', {
          client_id: client?.clientId,
          account_id: accountId,
          sid,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    provider.on('client_credentials.destroyed', async (token: any) => {
      this.logger.info('client_credentials.destroyed', {
        token_id: token?.jti,
        client_id: token?.clientId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('client_credentials.saved', async (token: any) => {
      this.logger.info('client_credentials.saved', {
        token_id: token?.jti,
        client_id: token?.clientId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('client_credentials.issued', async (token: any) => {
      this.logger.info('client_credentials.issued', {
        token_id: token?.jti,
        client_id: token?.clientId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('device_code.consumed', async (code: any) => {
      this.logger.info('device_code.consumed', {
        code_id: code?.jti,
        client_id: code?.clientId,
        account_id: code?.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('device_code.destroyed', async (code: any) => {
      this.logger.info('device_code.destroyed', {
        code_id: code?.jti,
        client_id: code?.clientId,
        account_id: code?.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('device_code.saved', async (code: any) => {
      this.logger.info('device_code.saved', {
        code_id: code?.jti,
        client_id: code?.clientId,
        account_id: code?.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('session.destroyed', async (session: any) => {
      this.logger.info('session.destroyed', {
        session_id: session?.uid,
        account_id: session?.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('session.saved', async (session: any) => {
      this.logger.info('session.saved', {
        session_id: session?.uid,
        account_id: session?.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on(
      'end_session.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'end_session.error',
          session_id: ctx.oidc?.session?.uid,
          account_id: ctx.oidc?.session?.accountId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError('end_session', undefined, tenant);
      }
    );

    provider.on('end_session.success', async (ctx: KoaContextWithOIDC) => {
      this.logger.info('end_session.success', {
        session_id: ctx.oidc?.session?.uid,
        account_id: ctx.oidc?.session?.accountId,
        ip_address: ctx.ip,
        user_agent: ctx.get('user-agent'),
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('interaction.destroyed', async (interaction: any) => {
      this.logger.info('interaction.destroyed', {
        interaction_id: interaction?.uid,
        client_id: interaction?.params?.client_id,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('interaction.ended', async (ctx: KoaContextWithOIDC) => {
      const tenant = tenantContext.getTenantId();
      const prompts = Array.from(ctx.oidc?.prompts || []);
      this.logger.info('interaction.ended', {
        interaction_id: ctx.oidc?.entities?.Interaction?.uid,
        prompts,
        client_id: ctx.oidc?.client?.clientId,
        tenant,
      });
      this.metricsService.recordOidcInteraction(
        prompts[0] || 'unknown',
        'ended',
        tenant
      );
    });

    provider.on('interaction.saved', async (interaction: any) => {
      this.logger.info('interaction.saved', {
        interaction_id: interaction?.uid,
        client_id: interaction?.params?.client_id,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on(
      'interaction.started',
      async (ctx: KoaContextWithOIDC, prompt: any) => {
        const tenant = tenantContext.getTenantId();
        this.logger.info('interaction.started', {
          interaction_id: ctx.oidc?.entities?.Interaction?.uid,
          prompt_name: prompt?.name,
          client_id: ctx.oidc?.client?.clientId,
          tenant,
        });
        this.metricsService.recordOidcInteraction(
          prompt?.name || 'unknown',
          'started',
          tenant
        );
      }
    );

    provider.on(
      'grant.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'grant.error',
          client_id: ctx.oidc?.client?.clientId,
          account_id: ctx.oidc?.session?.accountId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError(
          'grant',
          (ctx.oidc?.body?.grant_type as string) || undefined,
          tenant
        );
      }
    );

    provider.on(
      'grant.revoked',
      async (ctx: KoaContextWithOIDC, grantId: string) => {
        this.logger.info('grant.revoked', {
          grant_id: grantId,
          client_id: ctx.oidc?.client?.clientId,
          account_id: ctx.oidc?.session?.accountId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    provider.on('grant.success', async (ctx: KoaContextWithOIDC) => {
      const tenant = tenantContext.getTenantId();
      this.logger.info('grant.success', {
        client_id: ctx.oidc?.client?.clientId,
        account_id: ctx.oidc?.session?.accountId,
        ip_address: ctx.ip,
        user_agent: ctx.get('user-agent'),
        tenant,
      });
      const grantType = (ctx.oidc?.body?.grant_type as string) || 'unknown';
      this.metricsService.recordTokenIssued(grantType, tenant);
    });

    provider.on('registration_access_token.destroyed', async (token: any) => {
      this.logger.info('registration_access_token.destroyed', {
        token_id: token?.jti,
        client_id: token?.clientId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('registration_access_token.saved', async (token: any) => {
      this.logger.info('registration_access_token.saved', {
        token_id: token?.jti,
        client_id: token?.clientId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on(
      'registration_create.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'registration_create.error',
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError(
          'registration_create',
          undefined,
          tenant
        );
      }
    );

    provider.on(
      'registration_create.success',
      async (ctx: KoaContextWithOIDC, client: any) => {
        this.logger.info('registration_create.success', {
          client_id: client?.clientId,
          client_name: client?.clientName,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    provider.on(
      'registration_delete.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'registration_delete.error',
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError(
          'registration_delete',
          undefined,
          tenant
        );
      }
    );

    provider.on(
      'registration_delete.success',
      async (ctx: KoaContextWithOIDC, client: any) => {
        this.logger.info('registration_delete.success', {
          client_id: client?.clientId,
          client_name: client?.clientName,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    provider.on(
      'registration_read.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'registration_read.error',
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError(
          'registration_read',
          undefined,
          tenant
        );
      }
    );

    provider.on(
      'registration_update.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'registration_update.error',
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError(
          'registration_update',
          undefined,
          tenant
        );
      }
    );

    provider.on(
      'registration_update.success',
      async (ctx: KoaContextWithOIDC, client: any) => {
        this.logger.info('registration_update.success', {
          client_id: client?.clientId,
          client_name: client?.clientName,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    // @ts-expect-error OIDC Provider event type not properly defined
    provider.on('initial_access_token.destroyed', async (token: any) => {
      this.logger.info('initial_access_token.destroyed', {
        token_id: token?.jti,
        client_id: token?.clientId,
        tenant: tenantContext.getTenantId(),
      });
    });

    // @ts-expect-error - Event type not properly defined in oidc-provider types
    provider.on('initial_access_token.saved', async (token: any) => {
      this.logger.info('initial_access_token.saved', {
        token_id: token?.jti,
        client_id: token?.clientId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('replay_detection.destroyed', async (token: any) => {
      this.logger.info('replay_detection.destroyed', {
        token_id: token?.jti,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('replay_detection.saved', async (token: any) => {
      this.logger.info('replay_detection.saved', {
        token_id: token?.jti,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('refresh_token.consumed', async (token: any) => {
      this.logger.info('refresh_token.consumed', {
        token_id: token?.jti,
        client_id: token?.clientId,
        account_id: token?.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('refresh_token.destroyed', async (token: any) => {
      this.logger.info('refresh_token.destroyed', {
        token_id: token?.jti,
        client_id: token?.clientId,
        account_id: token?.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('refresh_token.saved', async (token: any) => {
      this.logger.info('refresh_token.saved', {
        token_id: token?.jti,
        client_id: token?.clientId,
        account_id: token?.accountId,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on(
      'pushed_authorization_request.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'pushed_authorization_request.error',
          client_id: ctx.oidc?.client?.clientId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError(
          'pushed_authorization_request',
          undefined,
          tenant
        );
      }
    );

    provider.on(
      // @ts-expect-error OIDC Provider event type not properly defined
      'pushed_authorization_request.success',
      async (ctx: KoaContextWithOIDC, client: Client) => {
        this.logger.info('pushed_authorization_request.success', {
          client_id: client?.clientId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    provider.on(
      'pushed_authorization_request.destroyed',
      async (token: any) => {
        this.logger.info('pushed_authorization_request.destroyed', {
          token_id: token?.jti,
          tenant: tenantContext.getTenantId(),
        });
      }
    );

    provider.on('pushed_authorization_request.saved', async (token: any) => {
      this.logger.info('pushed_authorization_request.saved', {
        token_id: token?.jti,
        tenant: tenantContext.getTenantId(),
      });
    });

    provider.on('jwks.error', async (ctx: KoaContextWithOIDC, error: Error) => {
      const tenant = tenantContext.getTenantId();
      this.logger.error(error, {
        context: 'jwks.error',
        ip_address: ctx.ip,
        user_agent: ctx.get('user-agent'),
        tenant,
      });
      this.metricsService.recordTokenError('jwks', undefined, tenant);
    });

    provider.on(
      'discovery.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'discovery.error',
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError('discovery', undefined, tenant);
      }
    );

    provider.on(
      'introspection.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'introspection.error',
          client_id: ctx.oidc?.client?.clientId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError(
          'introspection',
          undefined,
          tenant
        );
      }
    );

    provider.on(
      'revocation.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'revocation.error',
          client_id: ctx.oidc?.client?.clientId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError('revocation', undefined, tenant);
      }
    );

    provider.on(
      'userinfo.error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'userinfo.error',
          client_id: ctx.oidc?.client?.clientId,
          account_id: ctx.oidc?.session?.accountId,
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError('userinfo', undefined, tenant);
      }
    );

    provider.on(
      'server_error',
      async (ctx: KoaContextWithOIDC, error: Error) => {
        const tenant = tenantContext.getTenantId();
        this.logger.error(error, {
          context: 'server_error',
          ip_address: ctx.ip,
          user_agent: ctx.get('user-agent'),
          tenant,
        });
        this.metricsService.recordTokenError('server_error', undefined, tenant);
      }
    );
  };
}
