import type { IBaseSocialLogin } from './base-social-login.interface.js';

/**
 * Interface for LinkedIn social login service
 * Extends base interface for provider-specific type safety in DI
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- a distinct nominal interface per provider lets the DI container bind LinkedIn-specific implementations separately, even though the contract is identical to the base.
export interface ILinkedInSocialLogin extends IBaseSocialLogin {}
