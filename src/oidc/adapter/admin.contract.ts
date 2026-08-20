import type {
  ClientFilters,
  ClientStatistics,
  ClientValidationResult,
  OidcClientData,
  RegenerateSecretResult,
} from './client.interface.js';

export type OidcAdminFilter = Record<string, unknown>;
export type OidcAdminPayload = Record<string, unknown>;

export interface OidcAdminDocument {
  _id: string;
  payload: OidcAdminPayload;
  expiresAt?: Date | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  [key: string]: unknown;
}

export interface OidcDeleteResult {
  deletedCount: number;
}

export interface OidcSessionStatistics {
  total: number;
  active: number;
  expired: number;
}

export interface OidcGrantStatistics {
  total: number;
  recent: number;
  expired: number;
  byClient: Array<{ _id: string; count: number }>;
  byUser: Array<{ _id: string; count: number }>;
}

export interface IOidcRecordAdmin {
  find(id: string): Promise<OidcAdminPayload | undefined>;
  destroy(id: string): Promise<void>;
}

export interface IOidcSessionAdmin {
  findByAccountId(accountId: string): Promise<OidcAdminDocument[]>;
  revokeSession(sessionId: string): Promise<boolean>;
  revokeAllSessionsExcept(
    accountId: string,
    excludeSessionId: string
  ): Promise<number>;
  getSessionStatistics(): Promise<OidcSessionStatistics>;
  countSessions(filters?: OidcAdminFilter): Promise<number>;
  findSessionsWithPagination(
    filters?: OidcAdminFilter,
    sortBy?: string,
    sortOrder?: number,
    skip?: number,
    limit?: number
  ): Promise<OidcAdminDocument[]>;
  findSessionById(sessionId: string): Promise<OidcAdminDocument | null>;
  getDistinctValues(
    field: string,
    filters?: OidcAdminFilter
  ): Promise<unknown[]>;
  exportAllSessions(): Promise<OidcAdminDocument[]>;
  deleteSessionsByAccountId(accountId: string): Promise<OidcDeleteResult>;
  deleteSessionsByIds(sessionIds: string[]): Promise<OidcDeleteResult>;
}

export interface IOidcGrantAdmin extends IOidcRecordAdmin {
  findGrantsByAccountId(accountId: string): Promise<OidcAdminDocument[]>;
  findGrantsByClientId(clientId: string): Promise<OidcAdminDocument[]>;
  countGrants(filters?: OidcAdminFilter): Promise<number>;
  findGrantsWithPagination(
    filters?: OidcAdminFilter,
    sortBy?: string,
    sortOrder?: number,
    skip?: number,
    limit?: number
  ): Promise<OidcAdminDocument[]>;
  findGrantById(id: string): Promise<OidcAdminDocument | null>;
  getGrantStatistics(): Promise<OidcGrantStatistics>;
  getDistinctValues(
    field: string,
    filters?: OidcAdminFilter
  ): Promise<unknown[]>;
  exportAllGrants(): Promise<OidcAdminDocument[]>;
  deleteGrantsByAccountId(accountId: string): Promise<OidcDeleteResult>;
}

export interface IOidcClientAdmin extends IOidcRecordAdmin {
  createClient(data: Partial<OidcClientData>): Promise<OidcClientData>;
  findClientById(clientId: string): Promise<OidcClientData | null>;
  findAllClients(filters?: ClientFilters): Promise<OidcClientData[]>;
  updateClient(
    clientId: string,
    updates: Partial<OidcClientData>
  ): Promise<OidcClientData | null>;
  deleteClient(clientId: string): Promise<boolean>;
  searchClients(query: string): Promise<OidcClientData[]>;
  activateClient(clientId: string): Promise<OidcClientData | null>;
  deactivateClient(clientId: string): Promise<OidcClientData | null>;
  regenerateClientSecret(
    clientId: string
  ): Promise<RegenerateSecretResult | null>;
  getClientStatistics(): Promise<ClientStatistics>;
  countClients(): Promise<number>;
  validateClientDataSync(data: Partial<OidcClientData>): ClientValidationResult;
  generateClientId(): string;
  generateClientSecret(): string;
}

export interface IOidcAccountDataAdmin {
  deleteByAccountId(accountId: string): Promise<void | OidcDeleteResult>;
}

export interface IOidcAdminService
  extends
    IOidcSessionAdmin,
    IOidcGrantAdmin,
    IOidcClientAdmin,
    IOidcAccountDataAdmin {}
