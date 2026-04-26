import { Express, Request, Response, NextFunction } from 'express';
import { SessionData } from '../../../utils/session.js';

/**
 * Interface for core session storage operations
 * Handles basic session CRUD and lifecycle management
 */
export interface ISessionStore {
  /**
   * Initialize the session manager and attach middleware to Express app
   * @param app - Express application instance
   */
  initialize(app: Express): void;

  /**
   * Get the session middleware for manual integration
   * @returns Express middleware function
   */
  getMiddleware(): (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Create middleware to track session activity
   * @returns Express middleware function
   */
  activityTracker(): (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Set a value in the session
   * @param req - Express request object
   * @param key - Session property key
   * @param value - Value to store
   */
  set<T>(req: Request, key: string, value: T): void;

  /**
   * Get a value from the session
   * @param req - Express request object
   * @param key - Session property key
   * @param defaultValue - A default value to return if not found
   * @returns The stored value or undefined if not found
   */
  get<T>(req: Request, key: string, defaultValue?: T): T | undefined;

  /**
   * Get all session data
   * @param req - Express request object
   * @returns Object containing all session data
   */
  getAll(req: Request): SessionData;

  /**
   * Remove a value from the session
   * @param req - Express request object
   * @param key - Session property key
   */
  remove(req: Request, key: string): void;

  /**
   * Clear all session data except for keys specified in preserveKeys
   * @param req - Express request object
   * @param preserveKeys - Array of keys to preserve
   */
  clear(req: Request, preserveKeys?: string[]): void;

  /**
   * Regenerate the session ID while preserving session data
   * @param req - Express request object
   * @returns Promise resolving when regeneration completes
   */
  regenerate(req: Request): Promise<void>;

  /**
   * Destroy the current session
   * @param req - Express request object
   * @returns Promise resolving when session is destroyed
   */
  destroy(req: Request): Promise<void>;

  /**
   * Check if session exists
   * @param req - Express request object
   * @returns true if session exists, false otherwise
   */
  exists(req: Request): boolean;

  /**
   * Get session's remaining time-to-live in seconds
   * @param req - Express request object
   * @returns Remaining TTL in seconds, or 0 if expired/unavailable
   */
  getTTL(req: Request): number;
}
