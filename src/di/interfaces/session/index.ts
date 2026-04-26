/**
 * Session management interfaces following Interface Segregation Principle
 *
 * These interfaces break down the large ISessionManager into focused,
 * single-responsibility interfaces. The main ISessionManager extends
 * all of these for backward compatibility.
 */

export type { ISessionStore } from './session-store.interface.js';
export type { IAuthState } from './auth-state.interface.js';
export type {
  IMultiAccountSession,
  AddAuthenticatedUserResult,
  SwitchUserResult,
} from './multi-account-session.interface.js';
export type { ICsrfProtection } from './csrf-protection.interface.js';
export type { ISessionSecurity } from './session-security.interface.js';
export type { IFlashMessages } from './flash-messages.interface.js';
