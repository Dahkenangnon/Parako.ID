import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis before importing the service
const mockPublish = vi.fn().mockResolvedValue(1);
const mockSubscribe = vi.fn().mockResolvedValue('OK');
const mockUnsubscribe = vi.fn().mockResolvedValue('OK');
const mockPsubscribe = vi.fn().mockResolvedValue('OK');
const mockPunsubscribe = vi.fn().mockResolvedValue('OK');
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockQuit = vi.fn().mockResolvedValue('OK');
const mockOn = vi.fn();
const mockDuplicate = vi.fn();

vi.mock('ioredis', () => {
  const MockRedis = vi.fn().mockImplementation(function MockRedis() {
    return {
      connect: mockConnect,
      publish: mockPublish,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
      quit: mockQuit,
      on: mockOn,
      duplicate: mockDuplicate,
    };
  });
  return { default: MockRedis, Redis: MockRedis };
});

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

// Import after mocks are set up
import {
  getTenantChannel,
  RedisPubSubService,
} from '../../../src/services/redis-pubsub.service.js';

function createService(): RedisPubSubService {
  const mockLogger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return new (RedisPubSubService as any)(mockLogger);
}

function createServiceWithLogger() {
  const logger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger,
    service: new (RedisPubSubService as any)(logger) as RedisPubSubService,
  };
}

describe('RedisPubSubService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup duplicate mock to return a fresh mock client
    mockDuplicate.mockReturnValue({
      connect: mockConnect,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
      psubscribe: mockPsubscribe,
      punsubscribe: mockPunsubscribe,
      quit: mockQuit,
      on: mockOn,
    });
  });

  describe('connect()', () => {
    it('should connect successfully and set isConnected to true', async () => {
      const service = createService();

      await service.connect('redis://localhost:6379');

      expect(service.isConnected()).toBe(true);
      expect(mockConnect).toHaveBeenCalled();
    });

    it('should degrade gracefully on connection failure', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
      const service = createService();

      await service.connect('redis://localhost:6379');

      expect(service.isConnected()).toBe(false);
    });

    it('closes partially initialized clients when subscriber connection fails', async () => {
      mockConnect
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('subscriber unavailable'));
      const { logger, service } = createServiceWithLogger();

      await service.connect('redis://localhost:6379');

      expect(service.isConnected()).toBe(false);
      expect(mockQuit).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        '[RedisPubSub] Connection failed, operating in local-only mode',
        { error: 'subscriber unavailable' }
      );
    });

    it('replays channel and pattern subscriptions registered before Redis connects', async () => {
      const service = createService();
      service.subscribe('events', vi.fn());
      service.psubscribe('tenant:*:events', vi.fn());

      await service.connect('redis://localhost:6379');

      expect(mockSubscribe).toHaveBeenCalledWith('events');
      expect(mockPsubscribe).toHaveBeenCalledWith('tenant:*:events');
    });

    it('logs replay failures and remains connected', async () => {
      const { logger, service } = createServiceWithLogger();
      service.subscribe('events', vi.fn());
      service.psubscribe('tenant:*:events', vi.fn());
      mockSubscribe.mockRejectedValueOnce('channel replay failed');
      mockPsubscribe.mockRejectedValueOnce(new Error('pattern replay failed'));

      await service.connect('redis://localhost:6379');

      expect(service.isConnected()).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        '[RedisPubSub] Subscribe failed',
        { channel: 'events', error: 'channel replay failed' }
      );
      expect(logger.warn).toHaveBeenCalledWith(
        '[RedisPubSub] Psubscribe failed',
        { pattern: 'tenant:*:events', error: 'pattern replay failed' }
      );
    });

    it('closes existing clients before reconnecting', async () => {
      const service = createService();
      await service.connect('redis://localhost:6379');

      await service.connect('redis://localhost:6380');

      expect(mockQuit).toHaveBeenCalledTimes(2);
      expect(mockConnect).toHaveBeenCalledTimes(4);
      expect(service.isConnected()).toBe(true);
    });
  });

  describe('publish()', () => {
    it('should publish message to channel', async () => {
      const service = createService();
      await service.connect('redis://localhost:6379');

      await service.publish('test:channel', { foo: 'bar' });

      expect(mockPublish).toHaveBeenCalledWith(
        'test:channel',
        JSON.stringify({ foo: 'bar' })
      );
    });

    it('should be a no-op when disconnected', async () => {
      const service = createService();
      // Do not connect

      await service.publish('test:channel', { foo: 'bar' });

      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('logs publish failures without rejecting the caller', async () => {
      const { logger, service } = createServiceWithLogger();
      await service.connect('redis://localhost:6379');
      mockPublish.mockRejectedValueOnce(new Error('publish unavailable'));

      await expect(
        service.publish('test:channel', { foo: 'bar' })
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('[RedisPubSub] Publish failed', {
        channel: 'test:channel',
        error: 'publish unavailable',
      });
    });

    it('is a no-op if the publisher invariant is unavailable', async () => {
      const service = createService();
      (service as any).connected = true;

      await service.publish('test:channel', { foo: 'bar' });

      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe('subscribe()', () => {
    it('should register handler and subscribe to Redis on first handler', async () => {
      const service = createService();
      await service.connect('redis://localhost:6379');

      const handler = vi.fn();
      service.subscribe('test:channel', handler);

      expect(mockSubscribe).toHaveBeenCalledWith('test:channel');
    });

    it('should not re-subscribe on second handler for same channel', async () => {
      const service = createService();
      await service.connect('redis://localhost:6379');

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      service.subscribe('test:channel', handler1);
      service.subscribe('test:channel', handler2);

      // subscribe should only be called once for the channel
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });

    it('should dispatch messages to correct handlers', async () => {
      const service = createService();
      await service.connect('redis://localhost:6379');

      // Capture the message handler registered via sub.on('message', ...)
      let messageCallback: (
        channel: string,
        message: string
      ) => void = () => {};
      mockOn.mockImplementation((event: string, cb: any) => {
        if (event === 'message') messageCallback = cb;
      });

      // Re-connect to register the listener
      await service.connect('redis://localhost:6379');

      const handler = vi.fn();
      service.subscribe('test:channel', handler);

      // Simulate incoming message
      messageCallback('test:channel', JSON.stringify({ data: 'hello' }));

      expect(handler).toHaveBeenCalledWith({ data: 'hello' });
    });

    it('logs Redis subscription failures without removing the handler', async () => {
      const { logger, service } = createServiceWithLogger();
      await service.connect('redis://localhost:6379');
      mockSubscribe.mockRejectedValueOnce('subscribe unavailable');
      const handler = vi.fn();

      service.subscribe('test:channel', handler);
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          '[RedisPubSub] Subscribe failed',
          { channel: 'test:channel', error: 'subscribe unavailable' }
        );
      });
    });
  });

  describe('unsubscribe()', () => {
    it('should remove handler and unsubscribe when last handler removed', async () => {
      const service = createService();
      await service.connect('redis://localhost:6379');

      const handler = vi.fn();
      service.subscribe('test:channel', handler);
      service.unsubscribe('test:channel', handler);

      expect(mockUnsubscribe).toHaveBeenCalledWith('test:channel');
    });

    it('should not unsubscribe when other handlers remain', async () => {
      const service = createService();
      await service.connect('redis://localhost:6379');

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      service.subscribe('test:channel', handler1);
      service.subscribe('test:channel', handler2);

      service.unsubscribe('test:channel', handler1);

      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('ignores unknown handlers and supports local-only unsubscribe', () => {
      const service = createService();
      const handler = vi.fn();

      service.unsubscribe('missing', handler);
      service.subscribe('local', handler);
      service.unsubscribe('local', handler);

      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('logs Redis unsubscribe failures after local removal', async () => {
      const { logger, service } = createServiceWithLogger();
      await service.connect('redis://localhost:6379');
      mockUnsubscribe.mockRejectedValueOnce(new Error('unsubscribe failed'));
      const handler = vi.fn();
      service.subscribe('test:channel', handler);

      service.unsubscribe('test:channel', handler);

      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          '[RedisPubSub] Unsubscribe failed',
          { channel: 'test:channel', error: 'unsubscribe failed' }
        );
      });
    });
  });

  describe('tenant channels', () => {
    it('builds and delegates tenant-scoped operations', async () => {
      expect(getTenantChannel('parako', 'config', 'updated')).toBe(
        'parako:default:config:updated'
      );
      const service = createService();
      const publish = vi.spyOn(service, 'publish').mockResolvedValue(undefined);
      const subscribe = vi.spyOn(service, 'subscribe');
      const unsubscribe = vi.spyOn(service, 'unsubscribe');
      const handler = vi.fn();

      await service.publishForTenant('parako', ['jwks', 'rotated'], {
        keyId: 'key-1',
      });
      service.subscribeForTenant('parako', ['jwks', 'rotated'], handler);
      service.unsubscribeForTenant('parako', ['jwks', 'rotated'], handler);

      expect(publish).toHaveBeenCalledWith('parako:default:jwks:rotated', {
        keyId: 'key-1',
      });
      expect(subscribe).toHaveBeenCalledWith(
        'parako:default:jwks:rotated',
        handler
      );
      expect(unsubscribe).toHaveBeenCalledWith(
        'parako:default:jwks:rotated',
        handler
      );
    });
  });

  describe('pattern subscriptions', () => {
    it('subscribes once, dispatches safely, and unsubscribes the last handler', async () => {
      let patternCallback: (
        pattern: string,
        channel: string,
        message: string
      ) => void = () => {};
      mockOn.mockImplementation((event: string, callback: any) => {
        if (event === 'pmessage') patternCallback = callback;
      });
      const { logger, service } = createServiceWithLogger();
      await service.connect('redis://localhost:6379');
      const badHandler = vi.fn(() => {
        throw 'pattern handler failed';
      });
      const goodHandler = vi.fn();

      service.psubscribe('tenant:*:events', badHandler);
      service.psubscribe('tenant:*:events', goodHandler);
      patternCallback(
        'tenant:*:events',
        'tenant:one:events',
        JSON.stringify({ changed: true })
      );

      expect(mockPsubscribe).toHaveBeenCalledTimes(1);
      expect(goodHandler).toHaveBeenCalledWith({ changed: true });
      expect(logger.error).toHaveBeenCalledWith(
        '[RedisPubSub] Pattern handler error',
        { pattern: 'tenant:*:events', error: 'pattern handler failed' }
      );

      service.punsubscribe('tenant:*:events', badHandler);
      expect(mockPunsubscribe).not.toHaveBeenCalled();
      service.punsubscribe('tenant:*:events', goodHandler);
      expect(mockPunsubscribe).toHaveBeenCalledWith('tenant:*:events');
    });

    it('handles local-only, unknown, and Redis pattern subscription failures', async () => {
      const localService = createService();
      const localHandler = vi.fn();
      localService.punsubscribe('missing', localHandler);
      localService.psubscribe('local:*', localHandler);
      localService.punsubscribe('local:*', localHandler);
      expect(mockPunsubscribe).not.toHaveBeenCalled();

      const { logger, service } = createServiceWithLogger();
      await service.connect('redis://localhost:6379');
      mockPsubscribe.mockRejectedValueOnce(new Error('psubscribe failed'));
      const handler = vi.fn();
      service.psubscribe('remote:*', handler);
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          '[RedisPubSub] Psubscribe failed',
          { pattern: 'remote:*', error: 'psubscribe failed' }
        );
      });

      mockPunsubscribe.mockRejectedValueOnce('punsubscribe failed');
      service.punsubscribe('remote:*', handler);
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          '[RedisPubSub] Punsubscribe failed',
          { pattern: 'remote:*', error: 'punsubscribe failed' }
        );
      });
    });

    it('ignores missing handlers and logs malformed pattern messages', async () => {
      let patternCallback: (
        pattern: string,
        channel: string,
        message: string
      ) => void = () => {};
      mockOn.mockImplementation((event: string, callback: any) => {
        if (event === 'pmessage') patternCallback = callback;
      });
      const { logger, service } = createServiceWithLogger();
      await service.connect('redis://localhost:6379');

      patternCallback('missing:*', 'missing:one', '{}');
      service.psubscribe('tenant:*', vi.fn());
      patternCallback('tenant:*', 'tenant:one', 'not-json');

      expect(logger.warn).toHaveBeenCalledWith(
        '[RedisPubSub] Malformed pmessage',
        { pattern: 'tenant:*', raw: 'not-json' }
      );
    });

    it.each(['null', '[]', '"text"', '42'])(
      'rejects non-record pattern payload %s',
      async raw => {
        let patternCallback: (
          pattern: string,
          channel: string,
          message: string
        ) => void = () => {};
        mockOn.mockImplementation((event: string, callback: any) => {
          if (event === 'pmessage') patternCallback = callback;
        });
        const { logger, service } = createServiceWithLogger();
        await service.connect('redis://localhost:6379');
        const handler = vi.fn();
        service.psubscribe('tenant:*', handler);

        patternCallback('tenant:*', 'tenant:one', raw);

        expect(handler).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          '[RedisPubSub] Malformed pmessage',
          { pattern: 'tenant:*', raw }
        );
      }
    );
  });

  describe('disconnect()', () => {
    it('should clean up both clients and clear handlers', async () => {
      const service = createService();
      await service.connect('redis://localhost:6379');

      service.subscribe('test:channel', vi.fn());

      await service.disconnect();

      expect(service.isConnected()).toBe(false);
      // quit called for both sub and pub
      expect(mockQuit).toHaveBeenCalledTimes(2);
    });

    it('preserves non-Error disconnect failure details', async () => {
      const { logger, service } = createServiceWithLogger();
      await service.connect('redis://localhost:6379');
      mockQuit
        .mockRejectedValueOnce('subscriber quit failed')
        .mockRejectedValueOnce(new Error('publisher quit failed'));

      await service.disconnect();

      expect(logger.warn).toHaveBeenCalledWith(
        '[RedisPubSub] Disconnect errors',
        { errors: ['subscriber quit failed', 'publisher quit failed'] }
      );
    });

    it('is idempotent before connection and after clients are closed', async () => {
      const service = createService();

      await service.disconnect();
      await service.disconnect();

      expect(mockQuit).not.toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should log and skip malformed JSON messages', async () => {
      const service = createService();

      let messageCallback: (
        channel: string,
        message: string
      ) => void = () => {};
      mockOn.mockImplementation((event: string, cb: any) => {
        if (event === 'message') messageCallback = cb;
      });

      await service.connect('redis://localhost:6379');

      const handler = vi.fn();
      service.subscribe('test:channel', handler);

      // Simulate malformed message — should not throw
      messageCallback('test:channel', 'not-valid-json');

      expect(handler).not.toHaveBeenCalled();
    });

    it('should isolate handler errors without affecting other handlers', async () => {
      const service = createService();

      let messageCallback: (
        channel: string,
        message: string
      ) => void = () => {};
      mockOn.mockImplementation((event: string, cb: any) => {
        if (event === 'message') messageCallback = cb;
      });

      await service.connect('redis://localhost:6379');

      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('handler blew up');
      });
      const goodHandler = vi.fn();

      service.subscribe('test:channel', errorHandler);
      service.subscribe('test:channel', goodHandler);

      messageCallback('test:channel', JSON.stringify({ ok: true }));

      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalledWith({ ok: true });
    });

    it('ignores messages without registered or non-empty handler sets', async () => {
      let messageCallback: (
        channel: string,
        message: string
      ) => void = () => {};
      mockOn.mockImplementation((event: string, cb: any) => {
        if (event === 'message') messageCallback = cb;
      });
      const service = createService();
      await service.connect('redis://localhost:6379');

      messageCallback('missing', '{}');
      (service as any).handlers.set('empty', new Set());
      messageCallback('empty', '{}');
    });

    it.each(['null', '[]', '"text"', '42'])(
      'rejects non-record channel payload %s',
      async raw => {
        let messageCallback: (
          channel: string,
          message: string
        ) => void = () => {};
        mockOn.mockImplementation((event: string, callback: any) => {
          if (event === 'message') messageCallback = callback;
        });
        const { logger, service } = createServiceWithLogger();
        await service.connect('redis://localhost:6379');
        const handler = vi.fn();
        service.subscribe('events', handler);

        messageCallback('events', raw);

        expect(handler).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          '[RedisPubSub] Malformed message',
          { channel: 'events', raw }
        );
      }
    );
  });
});
