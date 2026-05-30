import pino, {
  Logger as PinoInstance,
  DestinationStream,
  LoggerOptions,
} from 'pino';
import { join } from 'node:path';
import { injectable, inject, unmanaged } from 'inversify';
import type { IFileSystemUtils } from '../../di/interfaces/file-system-utils.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import { TYPES } from '../../di/types.js';
import { getEnvironmentDefaults } from './constants.js';

const SENSITIVE_KEYS = new Set([
  'secret',
  'password',
  'token',
  'key',
  'salt',
  'credential',
  'authorization',
  'apikey',
  'api_key',
  'private',
  'cookie',
]);

const REDACTED = '[REDACTED]';

const FLUSH_TIMEOUT_MS = 2000;

export interface LoggerConfig {
  readonly appName: string;
  readonly version: string;
  readonly environment: string;
  readonly level: string;
  readonly prettyPrint: boolean;
  readonly redact?: {
    readonly paths: string[];
    readonly remove: boolean;
  };
  readonly base?: Readonly<Record<string, string>>;
}

interface FlushableDestination extends DestinationStream {
  flush?(callback: (err?: Error) => void): void;
  end?(): void;
}

type LogContext = Record<string, unknown>;

// Utility Functions

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  for (const sensitive of SENSITIVE_KEYS) {
    if (lower.includes(sensitive)) return true;
  }
  return false;
}

function maskObject(obj: Record<string, unknown>): void {
  for (const key in obj) {
    if (isSensitiveKey(key)) {
      obj[key] = REDACTED;
    } else if (obj[key] !== null && typeof obj[key] === 'object') {
      maskObject(obj[key] as Record<string, unknown>);
    }
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const serializers = {
  err: pino.stdSerializers.err,

  user(user: unknown): LogContext | null {
    if (!user || typeof user !== 'object') return null;
    const u = user as LogContext;
    return {
      id: u.id ?? u._id,
      username: u.username,
      email: u.email,
      password: REDACTED,
    };
  },

  session(session: unknown): LogContext | null {
    if (!session || typeof session !== 'object') return null;
    const s = session as LogContext;
    return {
      id: s.id ?? s._id,
      user_id: s.userId ?? s.user_id,
      status: s.status,
      secret: REDACTED,
    };
  },

  client(client: unknown): LogContext | null {
    if (!client || typeof client !== 'object') return null;
    const c = client as LogContext;
    return {
      id: c.id ?? c._id,
      name: c.name,
      client_secret: REDACTED,
    };
  },

  config(config: unknown): LogContext | null {
    if (!config || typeof config !== 'object') return null;
    const masked = deepClone(config) as Record<string, unknown>;
    maskObject(masked);
    return { _masked: true, ...masked };
  },
};

// Logger Class

@injectable()
export class AppLogger implements ILogger {
  private readonly logger: PinoInstance;
  private readonly config: LoggerConfig;
  private readonly destination?: FlushableDestination;

  constructor(
    @inject(TYPES.FileSystemUtils)
    private readonly fileSystemUtils: IFileSystemUtils,
    @unmanaged()
    environment: string = process.env.DEPLOYMENT_ENVIRONMENT ??
      process.env.NODE_ENV ??
      'development',
    @unmanaged() configOverrides?: Partial<LoggerConfig>
  ) {
    this.config = this.buildConfig(environment, configOverrides);
    const { logger, destination } = this.buildLogger();
    this.logger = logger;
    this.destination = destination;
  }

  private buildConfig(
    environment: string,
    overrides?: Partial<LoggerConfig>
  ): LoggerConfig {
    const defaults = getEnvironmentDefaults(environment);

    return {
      appName: overrides?.appName ?? defaults.application.name,
      version: overrides?.version ?? defaults.application.version,
      environment,
      level: overrides?.level ?? defaults.security.logging.level,
      prettyPrint:
        overrides?.prettyPrint ?? defaults.security.logging.pretty_print,
      redact: overrides?.redact ?? {
        paths: defaults.security.logging.redaction.paths,
        remove: true,
      },
      base: overrides?.base ?? {
        service: 'oidc-server',
        component: 'parako-id',
        deployment: environment,
        region: process.env.AWS_REGION ?? process.env.REGION ?? 'unknown',
        instance_id:
          process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? 'unknown',
      },
    };
  }

  // Logger Factory

  private buildLogger(): {
    logger: PinoInstance;
    destination?: FlushableDestination;
  } {
    const options = this.buildLoggerOptions();

    // Development with pretty printing
    if (this.config.environment === 'development' && this.config.prettyPrint) {
      const prettyOptions = this.tryGetPrettyTransport();
      if (prettyOptions) {
        options.transport = prettyOptions;
      }
      return { logger: pino(options) };
    }

    // Production with file logging
    if (this.config.environment === 'production') {
      const destination = this.tryCreateFileDestination();
      if (destination) {
        return { logger: pino(options, destination), destination };
      }
    }

    return { logger: pino(options) };
  }

  private buildLoggerOptions(): LoggerOptions {
    return {
      name: this.config.appName,
      level: this.config.level,
      base: {
        env: this.config.environment,
        version: this.config.version,
        ...this.config.base,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: label => ({ level: label }),
      },
      serializers,
      redact: this.config.redact,
    };
  }

  private tryGetPrettyTransport(): LoggerOptions['transport'] | null {
    try {
      require.resolve('pino-pretty');
      return {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      };
    } catch {
      return null;
    }
  }

  private tryCreateFileDestination(): FlushableDestination | null {
    const defaults = getEnvironmentDefaults(this.config.environment);
    const { enabled, directory } = defaults.security.logging.file_logging;

    if (!enabled) return null;

    const logFile = join(directory, 'app.log');
    this.fileSystemUtils.ensureDir(directory);

    // Worker-thread transport keeps file I/O off the main event loop. The
    // catch covers runtimes where worker_threads or pino/file cannot be
    // resolved; the async destination is acceptable as a degraded fallback.
    try {
      return pino.transport({
        target: 'pino/file',
        options: { destination: logFile, mkdir: true, append: true },
      }) as FlushableDestination;
    } catch {
      return pino.destination({
        dest: logFile,
        sync: false,
        mkdir: true,
      }) as FlushableDestination;
    }
  }

  // Public API

  getLogger(): PinoInstance {
    return this.logger;
  }

  child(bindings: LogContext): PinoInstance {
    return this.logger.child(bindings);
  }

  info(message: string, context?: LogContext): void {
    this.logger.info({ message, ...context });
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn({ message, ...context });
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug({ message, ...context });
  }

  trace(message: string, context?: LogContext): void {
    this.logger.trace({ message, ...context });
  }

  fatal(message: string, context?: LogContext): void {
    this.logger.fatal({ message, ...context });
  }

  error(error: Error, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  error(errorOrMessage: Error | string, context?: LogContext): void {
    if (errorOrMessage instanceof Error) {
      this.logger.error({ err: errorOrMessage, ...context });
    } else {
      this.logger.error({ message: errorOrMessage, ...context });
    }
  }

  async flush(): Promise<void> {
    if (!this.destination?.flush) return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Logger flush timeout'));
      }, FLUSH_TIMEOUT_MS);

      this.destination!.flush!(err => {
        clearTimeout(timeout);
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async shutdown(): Promise<void> {
    try {
      await this.flush();
      this.destination?.end?.();
    } catch (error) {
      // console.error here (not the structured logger): this IS the
      // logger, and it is shutting down. Falling back to stderr is the
      // only way to surface a failure during teardown.
      console.error('Logger shutdown error:', error);
    }
  }
}
