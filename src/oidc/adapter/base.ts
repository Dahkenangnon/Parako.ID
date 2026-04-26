import type {
  OIDCPayload,
  DocumentMappingOptions,
  MappedDocument,
} from '../interfaces/interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IBaseOIDCAdapter } from '../../di/interfaces/base-oidc-adapter.interface.js';

/**
 * Set of model names that can be granted access to third-party applications.
 * These models are used in OAuth 2.0 and OpenID Connect flows for token management.
 */
export const grantable = new Set<string>([
  'AccessToken', // OAuth 2.0 access tokens
  'AuthorizationCode', // OAuth 2.0 authorization codes
  'RefreshToken', // OAuth 2.0 refresh tokens
  'DeviceCode', // OAuth 2.0 device authorization codes
  'BackchannelAuthenticationRequest', // CIBA authentication requests
]);

/**
 * Set of model names that can be consumed (marked as used).
 * These models support consumption tracking for one-time use tokens.
 */
export const consumable = new Set<string>([
  'AuthorizationCode',
  'RefreshToken',
  'DeviceCode',
  'BackchannelAuthenticationRequest',
  'PushedAuthorizationRequest',
]);

/**
 * Abstract Base OIDC Adapter
 *
 * This abstract class defines the interface that all OIDC adapters must implement.
 * It provides common functionality and enforces the required methods for
 * oidc-provider compatibility.
 *
 * Concrete implementations should extend this class for specific storage backends
 * like MongoDB, Redis, PostgreSQL, etc.
 *
 * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#adapter}
 */
export default abstract class BaseOIDCAdapter implements IBaseOIDCAdapter {
  /**
   * Name of the OIDC model/collection
   */
  protected readonly name: string;
  protected readonly logger: ILogger;
  /**
   * Creates an instance of BaseOIDCAdapter for an oidc-provider model.
   *
   * @constructor
   * @param {string} name - Name of the oidc-provider model. One of:
   *   - "Grant" - OAuth 2.0 grant
   *   - "Session" - User session
   *   - "AccessToken" - OAuth 2.0 access token
   *   - "AuthorizationCode" - OAuth 2.0 authorization code
   *   - "RefreshToken" - OAuth 2.0 refresh token
   *   - "ClientCredentials" - OAuth 2.0 client credentials
   *   - "Client" - OAuth 2.0 client
   *   - "InitialAccessToken" - Dynamic client registration token
   *   - "RegistrationAccessToken" - Dynamic client registration token
   *   - "DeviceCode" - OAuth 2.0 device authorization code
   *   - "Interaction" - User interaction session
   *   - "ReplayDetection" - Replay attack prevention
   *   - "BackchannelAuthenticationRequest" - CIBA authentication request
   *   - "PushedAuthorizationRequest" - PAR request
   */
  constructor(name: string, logger: ILogger) {
    this.name = name;
    this.logger = logger;
  }

  /**
   * Update or Create an instance of an oidc-provider model.
   *
   * @param {string} id - Identifier that oidc-provider will use to reference this model instance
   * @param {OIDCPayload} payload - Object with all properties intended for storage
   * @param {number} [expiresIn] - Number of seconds intended for this model to be stored
   * @returns {Promise<void>} Promise fulfilled when the operation succeeded
   * @throws {Error} When the operation fails
   */
  abstract upsert(
    id: string,
    payload: OIDCPayload,
    expiresIn?: number
  ): Promise<void>;

  /**
   * Return previously stored instance of an oidc-provider model.
   *
   * @param {string} id - Identifier of oidc-provider model
   * @returns {Promise<OIDCPayload|undefined>} Promise fulfilled with the stored payload or undefined
   * @throws {Error} When the operation fails
   */
  abstract find(id: string): Promise<OIDCPayload | undefined>;

  /**
   * Return previously stored instance of DeviceCode by the end-user entered user code.
   * Required for the device flow feature.
   *
   * @param {string} userCode - The user_code value associated with a DeviceCode instance
   * @returns {Promise<OIDCPayload|undefined>} Promise fulfilled with the stored device code or undefined
   * @throws {Error} When the operation fails
   */
  abstract findByUserCode(userCode: string): Promise<OIDCPayload | undefined>;

  /**
   * Return previously stored instance of Session by its uid reference property.
   *
   * @param {string} uid - The uid value associated with a Session instance
   * @returns {Promise<OIDCPayload|undefined>} Promise fulfilled with the stored session or undefined
   * @throws {Error} When the operation fails
   */
  abstract findByUid(uid: string): Promise<OIDCPayload | undefined>;

  /**
   * Mark a stored oidc-provider model as consumed.
   *
   * @param {string} id - Identifier of oidc-provider model
   * @returns {Promise<void>} Promise fulfilled when the operation succeeded
   * @throws {Error} When the operation fails
   */
  abstract consume(id: string): Promise<void>;

  /**
   * Destroy/Drop/Remove a stored oidc-provider model.
   *
   * @param {string} id - Identifier of oidc-provider model
   * @returns {Promise<void>} Promise fulfilled when the operation succeeded
   * @throws {Error} When the operation fails
   */
  abstract destroy(id: string): Promise<void>;

  /**
   * Destroy/Drop/Remove a stored oidc-provider model by its grantId property reference.
   *
   * @param {string} grantId - The grantId value associated with this model's instance
   * @returns {Promise<void>} Promise fulfilled when the operation succeeded
   * @throws {Error} When the operation fails
   */
  abstract revokeByGrantId(grantId: string): Promise<void>;

  // COMMON METHODS - Shared functionality

  /**
   * Get the model name for this adapter instance.
   *
   * @returns {string} The model name
   */
  getModelName(): string {
    return this.name;
  }

  /**
   * Check if this model supports grant-based operations.
   *
   * @returns {boolean} True if the model is grantable
   */
  isGrantable(): boolean {
    return grantable.has(this.name);
  }

  /**
   * Check if this model supports consumption tracking.
   *
   * @returns {boolean} True if the model is consumable
   */
  isConsumable(): boolean {
    return consumable.has(this.name);
  }

  /**
   * Log an error with context information.
   *
   * @param {Error} error - The error to log
   * @param {string} operation - The operation that failed
   * @param {string} [id] - Optional identifier for context
   * @protected
   */
  protected logError(error: Error, operation: string, id?: string): void {
    const context = id
      ? `Error in ${this.name}.${operation} for id ${id}`
      : `Error in ${this.name}.${operation}`;

    this.logger.error(error, { context });
  }

  /**
   * Validate that an ID is provided and not empty.
   *
   * @param {string} id - The ID to validate
   * @param {string} operation - The operation name for error context
   * @throws {Error} When ID is invalid
   * @protected
   */
  protected validateId(id: string, operation: string): void {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(`Invalid ID provided for ${this.name}.${operation}`);
    }
  }

  /**
   * Validate that a payload is provided and is an object.
   *
   * @param {OIDCPayload} payload - The payload to validate
   * @param {string} operation - The operation name for error context
   * @throws {Error} When payload is invalid
   * @protected
   */
  protected validatePayload(payload: OIDCPayload, operation: string): void {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Invalid payload provided for ${this.name}.${operation}`);
    }
  }

  // OPTIONAL METHODS - Can be overridden by subclasses

  /**
   * Count all items in the collection.
   * This method is for monitoring purposes only.
   *
   * @returns {Promise<number>} Promise fulfilled with the item count
   */
  async countAll(): Promise<number> {
    try {
      // Default implementation returns 0
      // Subclasses should override this with storage-specific counting
      return 0;
    } catch (error) {
      this.logError(error as Error, 'countAll');
      return 0;
    }
  }

  /**
   * Map a document to a UI-friendly format
   *
   * @param {any} doc - Document from storage
   * @param {DocumentMappingOptions} [options] - Mapping options
   * @returns {MappedDocument|null} Mapped document with user-friendly fields
   */
  mapDocumentToUI(
    doc: any | null,
    options: DocumentMappingOptions = {}
  ): MappedDocument | null {
    if (!doc) return null;

    try {
      const { includePayload = false, excludeFields = [] } = options;

      const result: MappedDocument = {
        id: doc.jti || doc._id || doc.id || 'unknown',
        customData: doc.data || {},
      };

      if (doc.exp) {
        result.expiration = new Date(doc.exp * 1000);
      }
      if (doc.iat) {
        result.issuedAt = new Date(doc.iat * 1000);
      }
      if (doc.expiresAt) {
        result.expiresAt = doc.expiresAt;
      }

      if (includePayload) {
        result.payload = { ...doc };
      } else {
        const payload = doc.payload || doc;
        if (payload.accountId) result.accountId = payload.accountId;
        if (payload.uid) result.uid = payload.uid;
        if (payload.loginTs) result.loginTs = new Date(payload.loginTs * 1000);
        if (payload.authorizations)
          result.authorizations = payload.authorizations;
      }

      excludeFields.forEach(field => {
        delete result[field];
      });

      return result;
    } catch (error) {
      this.logError(error as Error, 'mapDocumentToUI');
      return {
        id: doc.jti || doc._id || doc.id || 'unknown',
        customData: {},
      };
    }
  }

  /**
   * Extends a model with custom data methods
   * This allows adding custom fields to standard OIDC models
   *
   * @param {string} id - The id of the document to extend
   * @param {Record<string, unknown>} customData - Custom data to be stored with the model
   * @returns {Promise<any>} Result of the update operation
   */
  async extendModel(
    id: string,
    customData: Record<string, unknown>
  ): Promise<any> {
    try {
      this.validateId(id, 'extendModel');

      if (!customData || typeof customData !== 'object') {
        throw new Error('Invalid custom data provided');
      }

      // Default implementation - subclasses should override
      throw new Error(`extendModel not implemented for ${this.name} adapter`);
    } catch (error) {
      this.logError(error as Error, 'extendModel', id);
      throw error;
    }
  }

  /**
   * Find documents by a custom data field
   *
   * @param {string} field - The custom data field to search by
   * @param {unknown} value - The value to search for
   * @returns {Promise<any[]>} Documents matching the query
   */
  async findByCustomField(field: string, _value: unknown): Promise<any[]> {
    try {
      if (!field || typeof field !== 'string') {
        throw new Error('Invalid field provided');
      }

      // Default implementation - subclasses should override
      throw new Error(
        `findByCustomField not implemented for ${this.name} adapter`
      );
    } catch (error) {
      this.logError(error as Error, 'findByCustomField');
      return [];
    }
  }
}
