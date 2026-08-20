import type BaseOIDCAdapter from '../../oidc/adapter/base.js';
import type {
  IOidcAccountDataAdmin,
  IOidcClientAdmin,
  IOidcGrantAdmin,
  IOidcSessionAdmin,
} from '../../oidc/adapter/admin.contract.js';

export type AdapterFactory = (modelName: string) => BaseOIDCAdapter;

export interface IOIDCAdapterBridge {
  initialize(): Promise<void>;
  get adapter(): AdapterFactory;
  adapterForTenant(tenantId: string): AdapterFactory;
  get session(): IOidcSessionAdmin;
  get grant(): IOidcGrantAdmin;
  get client(): IOidcClientAdmin;
  get accessToken(): IOidcAccountDataAdmin;
  get refreshToken(): IOidcAccountDataAdmin;
  get interaction(): IOidcAccountDataAdmin;
  get adapterType(): 'mongodb' | 'redis' | 'sqlite' | 'postgresql';
  get isInitialized(): boolean;
  effectiveOidcAdapter(): 'mongodb' | 'redis' | 'sqlite' | 'postgresql';
  getConnectionInfo(): { type: string; status: string; config: unknown };
}
