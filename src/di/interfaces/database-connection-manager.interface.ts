import { type Db } from 'mongodb';
import type { BootstrapConfig } from '../../config/schemas/bootstrap-schema.js';

/**
 * Interface for database connection manager service
 * Defines the contract for database connection operations
 */
export interface IDatabaseConnectionManager {
  /**
   * Establishes connection to MongoDB
   * @returns Promise that resolves when connection is complete
   */
  connect(): Promise<void>;

  /**
   * Checks if database is connected
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean;

  /**
   * Closes database connection
   * @returns Promise that resolves when disconnection is complete
   */
  disconnect(): Promise<void>;

  /**
   * Gets the database instance
   * @returns MongoDB database instance
   * @throws Error if database is not connected
   */
  getDB(): Db;

  /**
   * Initialize with bootstrap configuration
   * @param bootstrapConfig - Bootstrap configuration object
   * @returns void
   */
  initializeWithBootstrapConfig(bootstrapConfig: BootstrapConfig): void;
}
