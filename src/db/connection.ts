import mongoose from 'mongoose';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IDatabaseConnectionManager } from '../di/interfaces/database-connection-manager.interface.js';
import { TYPES } from '../di/types.js';
import { tenantPlugin } from './plugins/tenant.plugin.js';
import type { BootstrapConfig } from '../config/types.js';

@injectable()
export default class DatabaseConnectionManager implements IDatabaseConnectionManager {
  private isInitialized = false;
  private isInitializing = false;
  private initializationError: Error | null = null;
  private config: BootstrapConfig;

  constructor(@inject(TYPES.Logger) private logger: ILogger) {
    // Config will be set via initializeWithBootstrapConfig
    this.config = {} as BootstrapConfig;
  }

  /**
   * Initialize with bootstrap configuration
   */
  public initializeWithBootstrapConfig(bootstrapConfig: BootstrapConfig): void {
    this.config = bootstrapConfig;
  }

  /**
   * Basic connection options
   */
  private static getConnectionOptions(): mongoose.ConnectOptions {
    return {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      // Per-worker pool. Total = maxPoolSize × PM2 instances.
      maxPoolSize: 10,
      minPoolSize: 2,
      retryWrites: true,
      retryReads: true,
      bufferCommands: true,
    };
  }

  /**
   * Establishes connection to MongoDB.
   * No-op for non-mongodb adapters (sqlite, postgresql use Prisma instead).
   */
  async connect(): Promise<void> {
    if (this.config.storage?.adapter !== 'mongodb') {
      this.isInitialized = true; // mark as "connected" so isConnected() returns true
      return;
    }

    if (this.isInitialized) {
      return;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.initializationError) {
        throw this.initializationError;
      }
      return;
    }

    this.isInitializing = true;
    this.initializationError = null;

    try {
      this.logger.info('Connecting to database...');
      await this.attemptConnection();
      this.isInitialized = true;
      this.logger.info('Database connected successfully');
    } catch (error) {
      this.initializationError = error as Error;
      this.logger.error(error as Error, {
        context: 'database_connection_failed',
      });
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Attempts database connection with retry
   */
  private async attemptConnection(): Promise<void> {
    const dbUri = this.config.storage.mongodb?.uri;
    if (!dbUri) {
      throw new Error(
        'MongoDB URI not configured (STORAGE_MONGODB_URI is required when STORAGE_ADAPTER=mongodb)'
      );
    }

    const maxRetries = 3;
    let currentTry = 0;

    while (currentTry < maxRetries) {
      try {
        const connection = await mongoose.connect(
          dbUri,
          DatabaseConnectionManager.getConnectionOptions()
        );

        connection.connection.on('error', error => {
          this.logger.error(error as Error, {
            context: 'database_connection_error',
          });
        });

        connection.connection.on('disconnected', () => {
          this.logger.warn('Database connection lost');
        });

        // Register global tenant plugin — auto-injects + auto-filters tenant_id
        // on all schemas except those with tenantScoped = false (only Tenant model).
        // NOTE: Models compiled before this point (e.g., Settings via DI resolution)
        // must apply the plugin explicitly in their factory.  The idempotency guard
        // in tenantPlugin prevents double-application.
        mongoose.plugin(tenantPlugin);

        return;
      } catch (error: any) {
        currentTry++;
        this.logger.warn(
          `Database connection attempt ${currentTry}/${maxRetries} failed: ${error.message}`
        );

        if (currentTry < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * currentTry));
        }
      }
    }

    throw new Error(
      `Failed to connect to database after ${maxRetries} attempts`
    );
  }

  /**
   * Checks if database is connected.
   * For non-mongodb adapters, returns true once connect() has been called
   * (Prisma manages its own connection pool).
   */
  isConnected(): boolean {
    if (this.config.storage?.adapter !== 'mongodb') {
      return this.isInitialized;
    }
    return this.isInitialized && mongoose.connection.readyState === 1;
  }

  /**
   * Closes database connection
   */
  async disconnect(): Promise<void> {
    try {
      await mongoose.connection.close();
      this.logger.info('Database connection closed');
      this.isInitialized = false;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'database_disconnect_error',
      });
    }
  }

  /**
   * Gets the database instance
   */
  getDB(): any {
    if (mongoose.connection.db) {
      return mongoose.connection.db;
    }
    throw new Error('Database not connected');
  }
}
