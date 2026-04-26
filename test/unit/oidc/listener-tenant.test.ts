import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';
import { OIDCListenerService } from '../../../src/oidc/listener.js';

/**
 * Verify that the OIDC Listener passes tenant context to:
 * 1. Log metadata (for structured log filtering per tenant)
 * 2. Metrics labels (for per-tenant monitoring dashboards)
 */

describe('OIDC Listener — Tenant Scoping', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockMetricsService = {
    recordTokenIssued: vi.fn(),
    recordTokenError: vi.fn(),
    recordOidcInteraction: vi.fn(),
  };

  let listenerService: OIDCListenerService;

  // Capture provider.on() registrations
  type EventHandler = (...args: any[]) => any;
  let eventHandlers: Map<string, EventHandler>;
  let mockProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers = new Map();

    mockProvider = {
      on: (event: string, handler: EventHandler) => {
        eventHandlers.set(event, handler);
      },
    };

    listenerService = new OIDCListenerService(
      mockLogger as any,
      mockMetricsService as any
    );
  });

  it('grant.success passes tenant to log metadata and recordTokenIssued', async () => {
    await listenerService.setupListeners(mockProvider);

    const handler = eventHandlers.get('grant.success');
    expect(handler).toBeDefined();

    const mockCtx = {
      oidc: {
        client: { clientId: 'test-client' },
        session: { accountId: 'user-123' },
        body: { grant_type: 'authorization_code' },
      },
      ip: '10.0.0.1',
      get: vi.fn().mockReturnValue('test-agent'),
    };

    await tenantContext.run('acme', async () => {
      await handler!(mockCtx);
    });

    // Log should include tenant
    expect(mockLogger.info).toHaveBeenCalledWith(
      'grant.success',
      expect.objectContaining({ tenant: 'acme' })
    );

    // Metrics should include tenant
    expect(mockMetricsService.recordTokenIssued).toHaveBeenCalledWith(
      'authorization_code',
      'acme'
    );
  });

  it('grant.error passes tenant to metrics', async () => {
    await listenerService.setupListeners(mockProvider);

    const handler = eventHandlers.get('grant.error');
    expect(handler).toBeDefined();

    const mockCtx = {
      oidc: {
        client: { clientId: 'test-client' },
        session: { accountId: 'user-123' },
        body: { grant_type: 'client_credentials' },
      },
      ip: '10.0.0.1',
      get: vi.fn().mockReturnValue('test-agent'),
    };
    const error = new Error('test error');

    await tenantContext.run('globex', async () => {
      await handler!(mockCtx, error);
    });

    expect(mockMetricsService.recordTokenError).toHaveBeenCalledWith(
      'grant',
      'client_credentials',
      'globex'
    );
  });

  it('interaction.started passes tenant to metrics', async () => {
    await listenerService.setupListeners(mockProvider);

    const handler = eventHandlers.get('interaction.started');
    expect(handler).toBeDefined();

    const mockCtx = {
      oidc: {
        entities: { Interaction: { uid: 'int-1' } },
        client: { clientId: 'test-client' },
      },
      ip: '10.0.0.1',
      get: vi.fn().mockReturnValue('test-agent'),
    };

    await tenantContext.run('acme', async () => {
      await handler!(mockCtx, { name: 'login' });
    });

    expect(mockMetricsService.recordOidcInteraction).toHaveBeenCalledWith(
      'login',
      'started',
      'acme'
    );
  });

  it('error events include tenant in metrics when context is available', async () => {
    await listenerService.setupListeners(mockProvider);

    const errorEvents = [
      'introspection.error',
      'revocation.error',
      'userinfo.error',
    ];

    for (const eventName of errorEvents) {
      vi.clearAllMocks();
      const handler = eventHandlers.get(eventName);
      expect(handler, `handler for ${eventName}`).toBeDefined();

      const mockCtx = {
        oidc: { client: { clientId: 'test' }, session: { accountId: 'u1' } },
        ip: '10.0.0.1',
        get: vi.fn().mockReturnValue('agent'),
      };

      await tenantContext.run('tenant-x', async () => {
        await handler!(mockCtx, new Error('test'));
      });

      // Verify tenant passed to recordTokenError
      const metricsCalls = mockMetricsService.recordTokenError.mock.calls;
      expect(
        metricsCalls.length,
        `${eventName} should call recordTokenError`
      ).toBe(1);
      expect(
        metricsCalls[0][2],
        `${eventName} should pass tenant to recordTokenError`
      ).toBe('tenant-x');
    }
  });

  it('server_error includes tenant in both log and metrics', async () => {
    await listenerService.setupListeners(mockProvider);

    const handler = eventHandlers.get('server_error');
    expect(handler).toBeDefined();

    const mockCtx = {
      ip: '10.0.0.1',
      get: vi.fn().mockReturnValue('agent'),
    };

    await tenantContext.run('beta', async () => {
      await handler!(mockCtx, new Error('internal'));
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tenant: 'beta' })
    );
    expect(mockMetricsService.recordTokenError).toHaveBeenCalledWith(
      'server_error',
      undefined,
      'beta'
    );
  });
});
