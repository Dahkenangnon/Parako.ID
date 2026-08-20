import { describe, expectTypeOf, it } from 'vitest';
import type { IOIDCAdapterBridge } from '../../../../src/di/interfaces/oidc-adapter-bridge.interface.js';
import type {
  IOidcAdminService,
  IOidcSessionAdmin,
  IOidcGrantAdmin,
  IOidcClientAdmin,
  IOidcAccountDataAdmin,
} from '../../../../src/oidc/adapter/admin.contract.js';
import type { OIDCAdapterBridge } from '../../../../src/oidc/adapter/index.js';
import type { MongodbOidcAdminService } from '../../../../src/oidc/adapter/mongodb/admin-service.js';
import type { PrismaOidcAdminService } from '../../../../src/oidc/adapter/prisma/admin-service.js';
import type { RedisOidcAdminService } from '../../../../src/oidc/adapter/redis/admin-service.js';

describe('OIDC administration contracts', () => {
  it('enforces backend parity for every storage adapter', () => {
    expectTypeOf<MongodbOidcAdminService>().toExtend<IOidcAdminService>();
    expectTypeOf<PrismaOidcAdminService>().toExtend<IOidcAdminService>();
    expectTypeOf<RedisOidcAdminService>().toExtend<IOidcAdminService>();
  });

  it('keeps bridge properties role-specific and storage-neutral', () => {
    expectTypeOf<OIDCAdapterBridge>().toExtend<IOIDCAdapterBridge>();
    expectTypeOf<
      IOIDCAdapterBridge['session']
    >().toEqualTypeOf<IOidcSessionAdmin>();
    expectTypeOf<
      IOIDCAdapterBridge['grant']
    >().toEqualTypeOf<IOidcGrantAdmin>();
    expectTypeOf<
      IOIDCAdapterBridge['client']
    >().toEqualTypeOf<IOidcClientAdmin>();
    expectTypeOf<
      IOIDCAdapterBridge['accessToken']
    >().toEqualTypeOf<IOidcAccountDataAdmin>();
  });
});
