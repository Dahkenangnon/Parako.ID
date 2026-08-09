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
  readonly fileLogging: {
    readonly enabled: boolean;
    readonly directory: string;
  };
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
  const ancestors: object[] = [];
  return JSON.parse(
    JSON.stringify(value, function (this: object, _key, nestedValue: unknown) {
      if (typeof nestedValue === 'bigint') return nestedValue.toString();
      if (nestedValue && typeof nestedValue === 'object') {
        while (ancestors.length > 0 && ancestors.at(-1) !== this) {
          ancestors.pop();
        }
        if (ancestors.includes(nestedValue)) return '[Circular]';
        ancestors.push(nestedValue);
      }
      return nestedValue;
    })
  );
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
    return { ...masked, _masked: true };
  },
};

// Module-level Pino instance for call sites that cannot reach the DI logger
// (pure utility modules, Nunjucks filter callbacks, bare route closures).
// Writes to stdout/stderr — captured by PM2/systemd in production. Shares
// serializers and default redaction paths with AppLogger so sensitive fields
// stay masked regardless of which access path emits the line.
const moduleLoggerEnvironment =
  process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
const moduleLoggerDefaults = getEnvironmentDefaults(moduleLoggerEnvironment);

export const rootLogger: PinoInstance = pino({
  name: moduleLoggerDefaults.application.name,
  level: moduleLoggerDefaults.security.logging.level,
  base: {
    service: 'oidc-server',
    component: 'parako-id',
    env: moduleLoggerEnvironment,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: label => ({ level: label }),
  },
  serializers,
  redact: {
    paths: moduleLoggerDefaults.security.logging.redaction.paths,
    remove: true,
  },
});

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
      fileLogging:
        overrides?.fileLogging ?? defaults.security.logging.file_logging,
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
      options.transport = this.getPrettyTransport();
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

  private getPrettyTransport(): LoggerOptions['transport'] {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  private tryCreateFileDestination(): FlushableDestination | null {
    const { enabled, directory } = this.config.fileLogging;

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
    this.logger.info({ ...context, message });
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn({ ...context, message });
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug({ ...context, message });
  }

  trace(message: string, context?: LogContext): void {
    this.logger.trace({ ...context, message });
  }

  fatal(message: string, context?: LogContext): void {
    this.logger.fatal({ ...context, message });
  }

  error(error: Error, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  error(errorOrMessage: Error | string, context?: LogContext): void {
    if (errorOrMessage instanceof Error) {
      this.logger.error({ ...context, err: errorOrMessage });
    } else {
      this.logger.error({ ...context, message: errorOrMessage });
    }
  }

  async flush(): Promise<void> {
    const flush = this.destination?.flush
      ? this.destination.flush.bind(this.destination)
      : this.logger.flush.bind(this.logger);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Logger flush timeout'));
      }, FLUSH_TIMEOUT_MS);

      flush(err => {
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
    } catch (error) {
      // console.error here (not the structured logger): this IS the
      // logger, and it is shutting down. Falling back to stderr is the
      // only way to surface a failure during teardown.
      console.error('Logger shutdown error:', error);
    }

    try {
      this.destination?.end?.();
    } catch (error) {
      console.error('Logger shutdown error:', error);
    }
  }
}
