import { type Db, type Document } from 'mongodb';
import { Client } from 'oidc-provider';

export interface OIDCPayload {
  grantId?: string;
  userCode?: string;
  uid?: string;
  accountId?: string;
  clientId?: string;
  session?: { accountId?: string; [key: string]: unknown };
  loginTs?: number;
  exp?: number;
  iat?: number;
  authorizations?: Record<string, unknown>;
  consumed?: number;
  [key: string]: unknown;
}

export interface OIDCDocument extends Document {
  _id: string;
  logical_id?: string;
  tenant_id?: string;
  payload: OIDCPayload;
  expiresAt?: Date;
  data?: Record<string, unknown>;
}

export interface AdapterConnectionOptions {
  uri?: string;
  dbName?: string;
  connection?: Db;
}

export interface DocumentMappingOptions {
  includePayload?: boolean;
  excludeFields?: string[];
}

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

export interface ResourceServer {
  scope: string;
  audience?: string;
  accessTokenFormat?: 'opaque' | 'jwt';
}

export interface ExtendedClient extends Client {
  allowedResources?: string[];
  resourcesScopes?: string;
}

export interface ClearOIDCUserDataResult {
  success: boolean;
  accountId: string;
  sessions: number;
  grants: number;
  accessTokens: number;
  refreshTokens: number;
  interactions: number;
}

export interface SessionDocument {
  _id: string;
  payload: {
    accountId?: string;
    uid?: string;
    [key: string]: unknown;
  };
  expiresAt?: Date;
}
