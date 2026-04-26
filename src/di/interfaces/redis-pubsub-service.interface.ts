/**
 * Interface for Redis Pub/Sub event bus service
 * Provides cross-process event broadcasting for PM2 cluster mode
 */
export interface IRedisPubSubService {
  /**
   * Connect to Redis for pub/sub operations
   * Degrades gracefully if Redis is unavailable (isConnected() returns false)
   */
  connect(redisUrl: string): Promise<void>;

  /**
   * Publish a message to a channel (fire-and-forget)
   * No-op when disconnected
   */
  publish(channel: string, message: Record<string, unknown>): Promise<void>;

  /**
   * Register a handler for messages on a channel
   * First handler per channel triggers Redis SUBSCRIBE
   */
  subscribe(
    channel: string,
    handler: (msg: Record<string, unknown>) => void
  ): void;

  /**
   * Remove a handler from a channel
   * Last handler removed triggers Redis UNSUBSCRIBE
   */
  unsubscribe(
    channel: string,
    handler: (msg: Record<string, unknown>) => void
  ): void;

  /**
   * Publish to a tenant-scoped channel using unified key format.
   * Channel: {prefix}:{tenantId}:{segments...}
   * Reads tenant ID from ALS context.
   */
  publishForTenant(
    prefix: string,
    segments: string[],
    message: Record<string, unknown>
  ): Promise<void>;

  /**
   * Subscribe to a tenant-scoped channel using unified key format.
   * Channel: {prefix}:{tenantId}:{segments...}
   * Reads tenant ID from ALS context.
   */
  subscribeForTenant(
    prefix: string,
    segments: string[],
    handler: (msg: Record<string, unknown>) => void
  ): void;

  /**
   * Unsubscribe from a tenant-scoped channel using unified key format.
   * Channel: {prefix}:{tenantId}:{segments...}
   * Reads tenant ID from ALS context.
   */
  unsubscribeForTenant(
    prefix: string,
    segments: string[],
    handler: (msg: Record<string, unknown>) => void
  ): void;

  /**
   * Subscribe to channels matching a Redis glob pattern (PSUBSCRIBE).
   * Use for cross-tenant subscriptions, e.g. `{prefix}:*:config:invalidated`.
   * First handler per pattern triggers Redis PSUBSCRIBE.
   */
  psubscribe(
    pattern: string,
    handler: (msg: Record<string, unknown>) => void
  ): void;

  /**
   * Remove a handler from a pattern subscription.
   * Last handler removed triggers Redis PUNSUBSCRIBE.
   */
  punsubscribe(
    pattern: string,
    handler: (msg: Record<string, unknown>) => void
  ): void;

  /**
   * Check if the pub/sub service is connected to Redis
   */
  isConnected(): boolean;

  /**
   * Disconnect both pub and sub clients and clear all handlers
   */
  disconnect(): Promise<void>;
}
