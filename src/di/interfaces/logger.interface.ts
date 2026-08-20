import { type Logger } from 'pino';

export interface ILogger {
  getLogger(): Logger;

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
