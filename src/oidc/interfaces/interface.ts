import { type Db } from 'mongodb';
import { Client } from 'oidc-provider';

/**
 * Interface defining the payload structure for OIDC models
 */
export interface OIDCPayload {
  grantId?: string;
  userCode?: string;
  uid?: string;
  accountId?: string;
  loginTs?: number;
  exp?: number;
  iat?: number;
  authorizations?: Record<string, unknown>;
  consumed?: number;
  [key: string]: unknown;
}

/**
 * Interface for OIDC document stored in MongoDB
 */
export interface OIDCDocument extends Document {
  _id: string;
  payload: OIDCPayload;
  expiresAt?: Date;
  data?: Record<string, unknown>;
}

/**
 * Interface for adapter connection options
 */
export interface AdapterConnectionOptions {
  uri?: string;
  dbName?: string;
  connection?: Db;
}

/**
 * Interface for document mapping options
 */
export interface DocumentMappingOptions {
  includePayload?: boolean;
  excludeFields?: string[];
}

/**
 * Interface for mapped UI document
 */
export interface MappedDocument {
  id: string;
  expiresAt?: Date;
  customData: Record<string, unknown>;
  payload?: OIDCPayload;
  accountId?: string;
  uid?: string;
  loginTs?: Date;
  expiration?: Date;
  issuedAt?: Date;
  authorizations?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Interface for client properties during registration
 */
export interface ClientProperties {
  client_id?: string;
  client_name?: string;
  application_type?: string;
  logo_uri?: string;
  scope?: string;
  response_type?: string;
  grant_types?: string[];
  client_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
  isInternalClient?: boolean;
  [key: string]: unknown;
}

/**
 * Interface for the resource server configuration
 */
export interface ResourceServer {
  scope: string;
  audience?: string;
  accessTokenFormat?: 'opaque' | 'jwt';
}

/**
 * Extended Client interface with custom properties
 */
export interface ExtendedClient extends Client {
  allowedResources?: string[];
  resourcesScopes?: string;
}

/**
 * Interface for the result of clearing OIDC user data
 */
export interface ClearOIDCUserDataResult {
  success: boolean;
  accountId: string;
  sessions: number;
  grants: number;
  accessTokens: number;
  refreshTokens: number;
  interactions: number;
}

/**
 * Interface for session document structure
 */
export interface SessionDocument {
  _id: string;
  payload: {
    accountId?: string;
    uid?: string;
    [key: string]: unknown;
  };
  expiresAt?: Date;
}
