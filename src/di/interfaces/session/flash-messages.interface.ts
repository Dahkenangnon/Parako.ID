import { Request, Response, NextFunction } from 'express';
import { IFlashManager } from '../flash-manager.interface.js';

/**
 * Interface for flash message operations
 * Handles flash messages for request/response cycle
 */
export interface IFlashMessages {
  /**
   * Get a FlashManager instance for the request
   * @param req - Express request object
   * @returns FlashManager instance for chaining flash operations
   */
  flash(req: Request): IFlashManager;

  /**
   * Middleware to expose flash messages to views
   * @returns Express middleware function
   */
  flashMiddleware(): (req: Request, res: Response, next: NextFunction) => void;
}
