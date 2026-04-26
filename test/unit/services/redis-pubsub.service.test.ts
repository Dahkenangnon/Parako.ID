import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis before importing the service
const mockPublish = vi.fn().mockResolvedValue(1);
const mockSubscribe = vi.fn().mockResolvedValue('OK');
const mockUnsubscribe = vi.fn().mockResolvedValue('OK');
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockQuit = vi.fn().mockResolvedValue('OK');
const mockOn = vi.fn();
const mockDuplicate = vi.fn();

vi.mock('ioredis', () => {
  const MockRedis = vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    publish: mockPublish,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    quit: mockQuit,
    on: mockOn,
    duplicate: mockDuplicate,
  }));
  return { default: MockRedis };
});

// Mock inversify decorators
vi.mock('inversify', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

// Import after mocks are set up
import { RedisPubSubService } from '../../../src/services/redis-pubsub.service.js';

function createService(): RedisPubSubService {
  const mockLogger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return new (RedisPubSubService as any)(mockLogger);
}

describe('RedisPubSubService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup duplicate mock to return a fresh mock client
    mockDuplicate.mockReturnValue({
      connect: mockConnect,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
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
  });
});
