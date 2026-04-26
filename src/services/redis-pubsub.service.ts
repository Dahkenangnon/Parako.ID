import { injectable, inject } from 'inversify';
import Redis from 'ioredis';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IRedisPubSubService } from '../di/interfaces/redis-pubsub-service.interface.js';
import { TYPES } from '../di/types.js';
import { buildRedisKey } from '../multi-tenancy/redis-key.js';

/**
 * Build a tenant-scoped PubSub channel name.
 *
 * Uses the unified Redis key format: {prefix}:{tenantId}:{segments...}
 * The prefix and tenant ID are read from config/ALS respectively.
 *
 * @param prefix   - Global Redis prefix (deployment.redis_prefix)
 * @param segments - Channel segments after tenantId (e.g. 'jwks', 'rotated')
 * @returns Channel in format `{prefix}:{tenantId}:{segments...}`
 */
export function getTenantChannel(
  prefix: string,
  ...segments: string[]
): string {
  return buildRedisKey(prefix, ...segments);
}

type MessageHandler = (msg: Record<string, unknown>) => void;

/**
 * Redis Pub/Sub event bus for cross-process communication
 *
 * Uses two ioredis clients: one for publish commands (pub) and one
 * dedicated to subscriptions (sub). Redis requires separate connections
 * because a connection in subscribe mode cannot issue regular commands.
 */
@injectable()
export class RedisPubSubService implements IRedisPubSubService {
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private connected = false;
  private readonly handlers: Map<string, Set<MessageHandler>> = new Map();
  private readonly patternHandlers: Map<string, Set<MessageHandler>> =
    new Map();

  constructor(@inject(TYPES.Logger) private readonly logger: ILogger) {}

  async connect(redisUrl: string): Promise<void> {
    try {
      this.pub = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      await this.pub.connect();

      // Duplicate shares connection config but creates a separate connection
      this.sub = this.pub.duplicate();
      await this.sub.connect();

      this.sub.on('message', (channel: string, message: string) => {
        this.dispatchMessage(channel, message);
      });

      // Pattern subscriptions (PSUBSCRIBE) — used for cross-tenant channels
      this.sub.on(
        'pmessage',
        (pattern: string, _channel: string, message: string) => {
          this.dispatchPatternMessage(pattern, message);
        }
      );

      this.connected = true;
      this.logger.info('[RedisPubSub] Connected');
    } catch (error) {
      this.connected = false;
      this.pub = null;
      this.sub = null;
      this.logger.warn(
        '[RedisPubSub] Connection failed, operating in local-only mode',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  async publish(
    channel: string,
    message: Record<string, unknown>
  ): Promise<void> {
    if (!this.connected || !this.pub) return;

    try {
      await this.pub.publish(channel, JSON.stringify(message));
    } catch (error) {
      this.logger.warn('[RedisPubSub] Publish failed', {
        channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  subscribe(channel: string, handler: MessageHandler): void {
    let channelHandlers = this.handlers.get(channel);

    if (!channelHandlers) {
      channelHandlers = new Set();
      this.handlers.set(channel, channelHandlers);

      // First handler for this channel — subscribe at the Redis level
      if (this.connected && this.sub) {
        this.sub.subscribe(channel).catch(error => {
          this.logger.warn('[RedisPubSub] Subscribe failed', {
            channel,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    channelHandlers.add(handler);
  }

  unsubscribe(channel: string, handler: MessageHandler): void {
    const channelHandlers = this.handlers.get(channel);
    if (!channelHandlers) return;

    channelHandlers.delete(handler);

    if (channelHandlers.size === 0) {
      this.handlers.delete(channel);

      // Last handler removed — unsubscribe at the Redis level
      if (this.connected && this.sub) {
        this.sub.unsubscribe(channel).catch(error => {
          this.logger.warn('[RedisPubSub] Unsubscribe failed', {
            channel,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
  }

  async publishForTenant(
    prefix: string,
    segments: string[],
    message: Record<string, unknown>
  ): Promise<void> {
    return this.publish(getTenantChannel(prefix, ...segments), message);
  }

  subscribeForTenant(
    prefix: string,
    segments: string[],
    handler: MessageHandler
  ): void {
    this.subscribe(getTenantChannel(prefix, ...segments), handler);
  }

  unsubscribeForTenant(
    prefix: string,
    segments: string[],
    handler: MessageHandler
  ): void {
    this.unsubscribe(getTenantChannel(prefix, ...segments), handler);
  }

  psubscribe(pattern: string, handler: MessageHandler): void {
    let patHandlers = this.patternHandlers.get(pattern);

    if (!patHandlers) {
      patHandlers = new Set();
      this.patternHandlers.set(pattern, patHandlers);

      if (this.connected && this.sub) {
        this.sub.psubscribe(pattern).catch(error => {
          this.logger.warn('[RedisPubSub] Psubscribe failed', {
            pattern,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    patHandlers.add(handler);
  }

  punsubscribe(pattern: string, handler: MessageHandler): void {
    const patHandlers = this.patternHandlers.get(pattern);
    if (!patHandlers) return;

    patHandlers.delete(handler);

    if (patHandlers.size === 0) {
      this.patternHandlers.delete(pattern);

      if (this.connected && this.sub) {
        this.sub.punsubscribe(pattern).catch(error => {
          this.logger.warn('[RedisPubSub] Punsubscribe failed', {
            pattern,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.handlers.clear();
    this.patternHandlers.clear();

    const errors: Error[] = [];

    if (this.sub) {
      try {
        await this.sub.quit();
      } catch (error) {
        errors.push(error as Error);
      }
      this.sub = null;
    }

    if (this.pub) {
      try {
        await this.pub.quit();
      } catch (error) {
        errors.push(error as Error);
      }
      this.pub = null;
    }

    if (errors.length > 0) {
      this.logger.warn('[RedisPubSub] Disconnect errors', {
        errors: errors.map(e => e.message),
      });
    }
  }

  private dispatchPatternMessage(pattern: string, raw: string): void {
    const patHandlers = this.patternHandlers.get(pattern);
    if (!patHandlers || patHandlers.size === 0) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn('[RedisPubSub] Malformed pmessage', { pattern, raw });
      return;
    }

    for (const handler of patHandlers) {
      try {
        handler(parsed);
      } catch (error) {
        this.logger.error('[RedisPubSub] Pattern handler error', {
          pattern,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private dispatchMessage(channel: string, raw: string): void {
    const channelHandlers = this.handlers.get(channel);
    if (!channelHandlers || channelHandlers.size === 0) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn('[RedisPubSub] Malformed message', { channel, raw });
      return;
    }

    for (const handler of channelHandlers) {
      try {
        handler(parsed);
      } catch (error) {
        this.logger.error('[RedisPubSub] Handler error', {
          channel,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
