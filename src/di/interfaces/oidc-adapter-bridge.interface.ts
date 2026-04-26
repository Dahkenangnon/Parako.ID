import type BaseOIDCAdapter from '../../oidc/adapter/base.js';
import { MongodbOidcAdminService } from '../../oidc/adapter/mongodb/admin-service.js';
import { RedisOidcAdminService } from '../../oidc/adapter/redis/admin-service.js';
import { PrismaOidcAdminService } from '../../oidc/adapter/prisma/admin-service.js';

/** Factory function type — all three backends now expose the same signature. */
export type AdapterFactory = (modelName: string) => BaseOIDCAdapter;

export interface IOIDCAdapterBridge {
  initialize(): Promise<void>;
  get adapter(): AdapterFactory;
  get session():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService;
  get grant():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService;
  get client():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService;
  get accessToken():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService;
  get refreshToken():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService;
  get interaction():
    | MongodbOidcAdminService
    | RedisOidcAdminService
    | PrismaOidcAdminService;
  get adapterType(): 'mongodb' | 'redis' | 'sqlite' | 'postgresql';
  get isInitialized(): boolean;
  effectiveOidcAdapter(): 'mongodb' | 'redis' | 'sqlite' | 'postgresql';
  getConnectionInfo(): { type: string; status: string; config: unknown };
}
