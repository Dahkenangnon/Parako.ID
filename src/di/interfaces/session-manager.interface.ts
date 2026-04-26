/**
 * Session Manager Interface
 *
 * This interface follows the Interface Segregation Principle by extending
 * focused, single-responsibility interfaces. Components can depend on
 * the specific interface they need rather than the entire ISessionManager.
 *
 * Segregated interfaces:
 * - ISessionStore: Core session CRUD and lifecycle
 * - IAuthState: Authentication state management
 * - IMultiAccountSession: Multi-account support
 * - ICsrfProtection: CSRF token operations
 * - ISessionSecurity: Session binding and timeouts
 * - IFlashMessages: Flash message handling
 */

import type { ISessionStore } from './session/session-store.interface.js';
import type { IAuthState } from './session/auth-state.interface.js';
import type { IMultiAccountSession } from './session/multi-account-session.interface.js';
import type { ICsrfProtection } from './session/csrf-protection.interface.js';
import type { ISessionSecurity } from './session/session-security.interface.js';
import type { IFlashMessages } from './session/flash-messages.interface.js';

// Re-export types from segregated interfaces for backward compatibility
export type {
  AddAuthenticatedUserResult,
  SwitchUserResult,
} from './session/multi-account-session.interface.js';

/**
 * Interface for session manager service
 * Defines the contract for session management operations
 *
 * This is a composite interface that combines all session-related
 * functionality. For new code, prefer using the specific interfaces
 * (ISessionStore, IAuthState, etc.) when full functionality is not needed.
 */
export interface ISessionManager
  extends
    ISessionStore,
    IAuthState,
    IMultiAccountSession,
    ICsrfProtection,
    ISessionSecurity,
    IFlashMessages {}
