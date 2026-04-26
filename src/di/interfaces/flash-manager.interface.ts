import {
  FlashType,
  FlashOptions,
  FlashContainer,
} from '../../utils/session.js';

/**
 * Interface for flash manager service
 * Defines the contract for flash message operations
 */
export interface IFlashManager {
  /**
   * Add a flash message of any type
   * @param type - Message type
   * @param message - Message content
   * @param title - Optional title
   * @param options - Additional options
   * @returns FlashManager instance for chaining
   */
  add(
    type: FlashType,
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager;

  /**
   * Add a success flash message
   * @param message - Message content
   * @param title - Optional title
   * @param options - Additional options
   * @returns FlashManager instance for chaining
   */
  success(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager;

  /**
   * Add an error flash message
   * @param message - Message content
   * @param title - Optional title
   * @param options - Additional options
   * @returns FlashManager instance for chaining
   */
  error(message: string, title?: string, options?: FlashOptions): IFlashManager;

  /**
   * Add an info flash message
   * @param message - Message content
   * @param title - Optional title
   * @param options - Additional options
   * @returns FlashManager instance for chaining
   */
  info(message: string, title?: string, options?: FlashOptions): IFlashManager;

  /**
   * Add a warning flash message
   * @param message - Message content
   * @param title - Optional title
   * @param options - Additional options
   * @returns FlashManager instance for chaining
   */
  warning(
    message: string,
    title?: string,
    options?: FlashOptions
  ): IFlashManager;

  /**
   * Get all flash messages and clear them
   * @returns Object containing all flash messages
   */
  all(): FlashContainer;

  /**
   * Get flash messages without clearing them
   * @returns Object containing all flash messages
   */
  peek(): FlashContainer;

  /**
   * Clear all flash messages
   * @returns FlashManager instance for chaining
   */
  clear(): IFlashManager;
}
