import { type Logger } from 'pino';

/**
 * Interface for application logger service
 */
export interface ILogger {
  /**
   * Get the underlying Pino logger instance
   */
  getLogger(): Logger;

  /**
   * Create a child logger with additional bindings
   */
  child(bindings: Record<string, unknown>): Logger;

  /**
   * Flush pending logs to destination
   */
  flush(): Promise<void>;

  /**
   * Graceful shutdown
   */
  shutdown(): Promise<void>;

  error(error: Error, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  trace(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
}
