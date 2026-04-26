import type { IBaseSocialLogin } from './base-social-login.interface.js';

/**
 * Interface for Facebook social login service
 * Extends base interface for provider-specific type safety in DI
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IFacebookSocialLogin extends IBaseSocialLogin {}
