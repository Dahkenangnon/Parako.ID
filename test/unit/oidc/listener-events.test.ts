import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';
import { OIDCListenerService } from '../../../src/oidc/listener.js';

type EventHandler = (...args: any[]) => unknown;

describe('OIDC listener event contract', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const metrics = {
    recordTokenIssued: vi.fn(),
    recordTokenError: vi.fn(),
    recordOidcInteraction: vi.fn(),
  };
  const context = {
    oidc: {
      client: { clientId: 'client-1' },
      session: { uid: 'session-1', accountId: 'account-1' },
      body: { grant_type: 'authorization_code' },
      prompts: new Set(['login']),
      entities: { Interaction: { uid: 'interaction-1' } },
    },
    ip: '203.0.113.10',
    get: vi.fn().mockReturnValue('test-agent'),
  };
  const token = {
    jti: 'token-1',
    clientId: 'client-1',
    accountId: 'account-1',
  };
  const interaction = {
    uid: 'interaction-1',
    params: { client_id: 'client-1' },
  };
  const client = { clientId: 'client-1', clientName: 'Example RP' };

  let handlers: Map<string, EventHandler>;

  beforeEach(async () => {
    vi.clearAllMocks();
    context.get.mockReturnValue('test-agent');
    handlers = new Map();
    const provider = {
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler);
      }),
    };

    await new OIDCListenerService(logger as any, metrics as any).setupListeners(
      provider as any
    );
  });

  async function emit(event: string, ...args: any[]): Promise<void> {
    const handler = handlers.get(event);
    expect(handler, `listener for ${event}`).toBeDefined();
    await tenantContext.run('tenant-a', async () => {
      await handler!(...args);
    });
  }

  it('registers the complete provider event surface', () => {
    expect([...handlers.keys()]).toEqual([
      'access_token.destroyed',
      'access_token.saved',
      'access_token.issued',
      'authorization_code.consumed',
      'authorization_code.destroyed',
      'authorization_code.saved',
      'authorization.accepted',
      'authorization.error',
      'authorization.success',
      'backchannel.error',
      'backchannel.success',
      'client_credentials.destroyed',
      'client_credentials.saved',
      'client_credentials.issued',
      'device_code.consumed',
      'device_code.destroyed',
      'device_code.saved',
      'session.destroyed',
      'session.saved',
      'end_session.error',
      'end_session.success',
      'interaction.destroyed',
      'interaction.ended',
      'interaction.saved',
      'interaction.started',
      'grant.error',
      'grant.revoked',
      'grant.success',
      'registration_access_token.destroyed',
      'registration_access_token.saved',
      'registration_create.error',
      'registration_create.success',
      'registration_delete.error',
      'registration_delete.success',
      'registration_read.error',
      'registration_update.error',
      'registration_update.success',
      'initial_access_token.destroyed',
      'initial_access_token.saved',
      'replay_detection.destroyed',
      'replay_detection.saved',
      'refresh_token.consumed',
      'refresh_token.destroyed',
      'refresh_token.saved',
      'pushed_authorization_request.error',
      'pushed_authorization_request.success',
      'pushed_authorization_request.destroyed',
      'pushed_authorization_request.saved',
      'jwks.error',
      'discovery.error',
      'introspection.error',
      'revocation.error',
      'userinfo.error',
      'server_error',
    ]);
  });

  it.each([
    [
      'access_token.destroyed',
      token,
      { token_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'access_token.saved',
      token,
      { token_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'access_token.issued',
      token,
      { token_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'authorization_code.consumed',
      token,
      { code_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'authorization_code.destroyed',
      token,
      { code_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'authorization_code.saved',
      token,
      { code_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'client_credentials.destroyed',
      token,
      { token_id: 'token-1', client_id: 'client-1' },
    ],
    [
      'client_credentials.saved',
      token,
      { token_id: 'token-1', client_id: 'client-1' },
    ],
    [
      'client_credentials.issued',
      token,
      { token_id: 'token-1', client_id: 'client-1' },
    ],
    [
      'device_code.consumed',
      token,
      { code_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'device_code.destroyed',
      token,
      { code_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'device_code.saved',
      token,
      { code_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'session.destroyed',
      { uid: 'session-1', accountId: 'account-1' },
      { session_id: 'session-1', account_id: 'account-1' },
    ],
    [
      'session.saved',
      { uid: 'session-1', accountId: 'account-1' },
      { session_id: 'session-1', account_id: 'account-1' },
    ],
    [
      'interaction.destroyed',
      interaction,
      { interaction_id: 'interaction-1', client_id: 'client-1' },
    ],
    [
      'interaction.saved',
      interaction,
      { interaction_id: 'interaction-1', client_id: 'client-1' },
    ],
    [
      'registration_access_token.destroyed',
      token,
      { token_id: 'token-1', client_id: 'client-1' },
    ],
    [
      'registration_access_token.saved',
      token,
      { token_id: 'token-1', client_id: 'client-1' },
    ],
    [
      'initial_access_token.destroyed',
      token,
      { token_id: 'token-1', client_id: 'client-1' },
    ],
    [
      'initial_access_token.saved',
      token,
      { token_id: 'token-1', client_id: 'client-1' },
    ],
    ['replay_detection.destroyed', token, { token_id: 'token-1' }],
    ['replay_detection.saved', token, { token_id: 'token-1' }],
    [
      'refresh_token.consumed',
      token,
      { token_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'refresh_token.destroyed',
      token,
      { token_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'refresh_token.saved',
      token,
      { token_id: 'token-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    ['pushed_authorization_request.destroyed', token, { token_id: 'token-1' }],
    ['pushed_authorization_request.saved', token, { token_id: 'token-1' }],
  ])('logs %s persistence metadata', async (event, value, expected) => {
    await emit(event, value);

    expect(logger.info).toHaveBeenCalledWith(event, {
      ...expected,
      tenant: 'tenant-a',
    });
  });

  it.each([
    [
      'authorization.accepted',
      [context],
      { client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'authorization.success',
      [context],
      { client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'backchannel.success',
      [context, client, 'account-1', 'sid-1'],
      { client_id: 'client-1', account_id: 'account-1', sid: 'sid-1' },
    ],
    [
      'end_session.success',
      [context],
      { session_id: 'session-1', account_id: 'account-1' },
    ],
    [
      'grant.revoked',
      [context, 'grant-1'],
      { grant_id: 'grant-1', client_id: 'client-1', account_id: 'account-1' },
    ],
    [
      'registration_create.success',
      [context, client],
      { client_id: 'client-1', client_name: 'Example RP' },
    ],
    [
      'registration_delete.success',
      [context, client],
      { client_id: 'client-1', client_name: 'Example RP' },
    ],
    [
      'registration_update.success',
      [context, client],
      { client_id: 'client-1', client_name: 'Example RP' },
    ],
    [
      'pushed_authorization_request.success',
      [context, client],
      { client_id: 'client-1' },
    ],
  ])('logs %s request metadata', async (event, args, expected) => {
    await emit(event, ...args);

    expect(logger.info).toHaveBeenCalledWith(event, {
      ...expected,
      ip_address: '203.0.113.10',
      user_agent: 'test-agent',
      tenant: 'tenant-a',
    });
  });

  it('records interaction lifecycle and successful token grants', async () => {
    await emit('interaction.ended', context);
    expect(logger.info).toHaveBeenCalledWith('interaction.ended', {
      interaction_id: 'interaction-1',
      prompts: ['login'],
      client_id: 'client-1',
      tenant: 'tenant-a',
    });
    expect(metrics.recordOidcInteraction).toHaveBeenCalledWith(
      'login',
      'ended',
      'tenant-a'
    );

    vi.clearAllMocks();
    await emit('interaction.started', context, { name: 'consent' });
    expect(logger.info).toHaveBeenCalledWith('interaction.started', {
      interaction_id: 'interaction-1',
      prompt_name: 'consent',
      client_id: 'client-1',
      tenant: 'tenant-a',
    });
    expect(metrics.recordOidcInteraction).toHaveBeenCalledWith(
      'consent',
      'started',
      'tenant-a'
    );

    vi.clearAllMocks();
    await emit('grant.success', context);
    expect(logger.info).toHaveBeenCalledWith(
      'grant.success',
      expect.objectContaining({ tenant: 'tenant-a' })
    );
    expect(metrics.recordTokenIssued).toHaveBeenCalledWith(
      'authorization_code',
      'tenant-a'
    );
  });

  it.each([
    ['authorization.error', 'authorization', [context]],
    [
      'backchannel.error',
      'backchannel',
      [context, client, 'account-1', 'sid-1'],
    ],
    ['end_session.error', 'end_session', [context]],
    ['grant.error', 'grant', [context]],
    ['registration_create.error', 'registration_create', [context]],
    ['registration_delete.error', 'registration_delete', [context]],
    ['registration_read.error', 'registration_read', [context]],
    ['registration_update.error', 'registration_update', [context]],
    [
      'pushed_authorization_request.error',
      'pushed_authorization_request',
      [context],
    ],
    ['jwks.error', 'jwks', [context]],
    ['discovery.error', 'discovery', [context]],
    ['introspection.error', 'introspection', [context]],
    ['revocation.error', 'revocation', [context]],
    ['userinfo.error', 'userinfo', [context]],
    ['server_error', 'server_error', [context]],
  ])('logs and meters %s', async (event, category, prefixArgs) => {
    const error = new Error(`${event} failed`);
    const args =
      event === 'backchannel.error'
        ? [prefixArgs[0], error, ...prefixArgs.slice(1)]
        : [prefixArgs[0], error];

    await emit(event, ...args);

    expect(logger.error).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ context: event, tenant: 'tenant-a' })
    );
    expect(metrics.recordTokenError).toHaveBeenCalledWith(
      category,
      event === 'grant.error' ? 'authorization_code' : undefined,
      'tenant-a'
    );
  });

  it('uses safe unknown values when optional event context is absent', async () => {
    const sparseContext = {
      ip: '198.51.100.4',
      get: vi.fn().mockReturnValue('sparse-agent'),
    };

    await emit('authorization.accepted', sparseContext);
    await emit('authorization.success', sparseContext);
    await emit(
      'backchannel.success',
      sparseContext,
      undefined,
      'account',
      'sid'
    );
    await emit('end_session.success', sparseContext);
    await emit('interaction.ended', sparseContext);
    await emit('interaction.started', sparseContext, undefined);
    await emit('grant.revoked', sparseContext, 'grant');
    await emit('grant.success', sparseContext);
    await emit('registration_create.success', sparseContext, undefined);
    await emit('registration_delete.success', sparseContext, undefined);
    await emit('registration_update.success', sparseContext, undefined);
    await emit(
      'pushed_authorization_request.success',
      sparseContext,
      undefined
    );

    expect(metrics.recordOidcInteraction).toHaveBeenCalledWith(
      'unknown',
      'ended',
      'tenant-a'
    );
    expect(metrics.recordOidcInteraction).toHaveBeenCalledWith(
      'unknown',
      'started',
      'tenant-a'
    );
    expect(metrics.recordTokenIssued).toHaveBeenCalledWith(
      'unknown',
      'tenant-a'
    );
  });

  it('handles sparse tokens, interactions, and error contexts', async () => {
    const sparseContext = {
      ip: '198.51.100.4',
      get: vi.fn().mockReturnValue('sparse-agent'),
    };
    const errorEvents = [
      'authorization.error',
      'end_session.error',
      'grant.error',
      'registration_create.error',
      'registration_delete.error',
      'registration_read.error',
      'registration_update.error',
      'pushed_authorization_request.error',
      'jwks.error',
      'discovery.error',
      'introspection.error',
      'revocation.error',
      'userinfo.error',
      'server_error',
    ];

    for (const event of errorEvents) {
      await emit(event, sparseContext, new Error('sparse failure'));
    }
    await emit(
      'backchannel.error',
      sparseContext,
      new Error('sparse failure'),
      undefined,
      'account',
      'sid'
    );

    for (const event of [
      'client_credentials.destroyed',
      'client_credentials.saved',
      'client_credentials.issued',
      'device_code.consumed',
      'device_code.destroyed',
      'device_code.saved',
      'session.destroyed',
      'session.saved',
      'interaction.destroyed',
      'interaction.saved',
      'registration_access_token.destroyed',
      'registration_access_token.saved',
      'initial_access_token.destroyed',
      'initial_access_token.saved',
      'replay_detection.destroyed',
      'replay_detection.saved',
      'refresh_token.consumed',
      'refresh_token.destroyed',
      'refresh_token.saved',
      'pushed_authorization_request.destroyed',
      'pushed_authorization_request.saved',
    ]) {
      await emit(event, undefined);
    }

    expect(metrics.recordTokenError).toHaveBeenCalledWith(
      'grant',
      undefined,
      'tenant-a'
    );
  });
});
