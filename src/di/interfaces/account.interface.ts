import type {
  AccountClaims,
  ClaimsParameter,
  KoaContextWithOIDC,
} from 'oidc-provider';
import type { Account as OIDCAccount } from 'oidc-provider';

/**
 * Interface for OIDC Account - handles user account information in the OIDC Provider
 */
export interface IAccount extends OIDCAccount {
  /**
   * The unique identifier (username) for the account
   */
  accountId: string;
  [key: string]: unknown;

  /**
   * Retrieves claims for the user account based on the specified parameters.
   * This method is used by the OIDC Provider to get user information for ID tokens
   * or userinfo endpoints. It filters claims based on scope, use parameter, and rejected claims.
   *
   * @param {string} use - Specifies where the claims will be used: "id_token" or "userinfo"
   * @param {string} scope - The OAuth2/OIDC scope requested by the client
   * @param {Object} claims - The claims requested by the client for either "id_token" or "userinfo"
   * @param {string[]} rejected - Array of claim names that were rejected by the end-user
   * @returns {Promise<AccountClaims>} Object containing the user's claims including sub (subject)
   * @throws {Error} If user lookup fails
   */
  claims(
    use: string,
    scope: string,
    claims: ClaimsParameter,
    rejected: string[]
  ): Promise<AccountClaims>;

  /**
   * Static method to find and create an Account instance for a given user ID.
   * Used by the OIDC Provider to look up accounts during authentication flows.
   * This method is called when the provider needs to find an account by its ID.
   *
   * @param {Object} ctx - The request context
   * @param {string} id - The username to look up
   * @param {Object} token - The token object (if any)
   * @returns {Promise<Account|undefined>} Account instance if found, undefined otherwise
   */
  findAccount(
    ctx: KoaContextWithOIDC,
    id: string,
    token?: any
  ): Promise<IAccount | undefined>;
}
