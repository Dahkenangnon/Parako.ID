import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';
import { TYPES } from '../types.js';

import { FileKeyStore } from '../../oidc/key-store/file-key-store.js';
import { DBKeyStore } from '../../oidc/key-store/db-key-store.js';
import type { IKeyStore } from '../interfaces/key-store.interface.js';
import type { IConfigManager } from '../interfaces/config-manager.interface.js';

import { Account } from '../../oidc/specs/account.js';
import { OIDCUtils } from '../../oidc/utils.js';
import { OIDCClientMerger } from '../../oidc/client-merger.js';
import OIDCConfig from '../../oidc/config.js';
import { OIDCAdapterBridge } from '../../oidc/adapter/index.js';
import { ProviderService } from '../../oidc/provider.js';
import { OIDCListenerService } from '../../oidc/listener.js';
import { TenantProviderRegistry } from '../../multi-tenancy/tenant-provider-registry.js';
import type { ITenantProviderRegistry } from '../interfaces/tenant-provider-registry.interface.js';

import { OIDCAbortHandler } from '../../oidc/flows/handlers/abort.js';
import { OIDCConsentHandler } from '../../oidc/flows/handlers/consent.js';
import { OIDCErrorHandler } from '../../oidc/flows/handlers/error.js';
import { OIDCInteractionHandler } from '../../oidc/flows/handlers/interaction.js';
import { OIDCLoginHandler } from '../../oidc/flows/handlers/login.js';
import { OIDCMfaHandler } from '../../oidc/flows/handlers/mfa.js';
import { OIDCNewDeviceVerifyHandler } from '../../oidc/flows/handlers/new-device-verify.js';
import { OIDCSelectAccountHandler } from '../../oidc/flows/handlers/select-account.js';
import { OIDCSocialCallbackHandler } from '../../oidc/flows/handlers/social-callback.js';
import { OIDCSocialLoginHandler } from '../../oidc/flows/handlers/social-login.js';
import { OIDCWebAuthnMfaHandler } from '../../oidc/flows/handlers/webauthn-mfa.js';

import { IOIDCAdapterBridge } from '../interfaces/oidc-adapter-bridge.interface.js';
import { IProviderService } from '../interfaces/provider-service.interface.js';
import { IOIDCListenerService } from '../interfaces/oidc-listener-service.interface.js';
import { IAccount } from '../interfaces/account.interface.js';
import { IOIDCUtils } from '../interfaces/oidc-utils.interface.js';
import { IOIDCConfig } from '../interfaces/oidc-config.interface.js';
import { IOIDCClientMerger } from '../interfaces/oidc-client-merger.interface.js';
import { IOIDCAbortHandler } from '../interfaces/oidc-abort-handler.interface.js';
import { IOIDCConsentHandler } from '../interfaces/oidc-consent-handler.interface.js';
import { IOIDCErrorHandler } from '../interfaces/oidc-error-handler.interface.js';
import { IOIDCInteractionHandler } from '../interfaces/oidc-interaction-handler.interface.js';
import { IOIDCLoginHandler } from '../interfaces/oidc-login-handler.interface.js';
import { IOIDCMfaHandler } from '../interfaces/oidc-mfa-handler.interface.js';
import { IOIDCNewDeviceVerifyHandler } from '../interfaces/oidc-new-device-verify-handler.interface.js';
import { IOIDCSelectAccountHandler } from '../interfaces/oidc-select-account-handler.interface.js';
import { IOIDCSocialCallbackHandler } from '../interfaces/oidc-social-callback-handler.interface.js';
import { IOIDCSocialLoginHandler } from '../interfaces/oidc-social-login-handler.interface.js';
import { IOIDCWebAuthnMfaHandler } from '../interfaces/oidc-webauthn-mfa-handler.interface.js';
import { IOidcRoutesManager } from '../interfaces/oidc-routes-manager.interface.js';
import { OidcRoutesManager } from '../../oidc/flows/route.js';
import { IOidcManager } from '../interfaces/oidc-manager.interface.js';
import { OidcManager } from '../../oidc/index.js';

export const oidcModule: ContainerModule = new ContainerModule(
  (options: ContainerModuleLoadOptions) => {
    // Key Store - Singleton (dynamic based on config)
    options
      .bind<IKeyStore>(TYPES.KeyStore)
      .toDynamicValue(context => {
        const configManager = context.get<IConfigManager>(TYPES.ConfigManager);
        const config = configManager.getConfig();
        const storeType = config.security?.key_store?.type ?? 'database';

        if (storeType === 'file') {
          return new FileKeyStore(
            context.get(TYPES.FileSystemUtils),
            context.get(TYPES.Logger),
            configManager
          );
        }

        return new DBKeyStore(
          context.get(TYPES.Logger),
          configManager,
          context.get(TYPES.JwksKeyModel)
        );
      })
      .inSingletonScope();

    // OIDC Core services - Singleton (shared configuration)
    options
      .bind<IOIDCAdapterBridge>(TYPES.OIDCAdapterBridge)
      .to(OIDCAdapterBridge)
      .inSingletonScope();

    options
      .bind<IProviderService>(TYPES.ProviderService)
      .to(ProviderService)
      .inSingletonScope();

    // Tenant Provider Registry — uses @optional() in ProviderService so
    // it's safe to always bind. The registry constructor guards the
    // setInterval timer behind a multi_tenancy.enabled check.
    options
      .bind<ITenantProviderRegistry>(TYPES.TenantProviderRegistry)
      .to(TenantProviderRegistry)
      .inSingletonScope();

    options
      .bind<IOIDCListenerService>(TYPES.OIDCListenerService)
      .to(OIDCListenerService)
      .inSingletonScope();

    // OIDC dependencies - Transient (per-request)
    options.bind<IAccount>(TYPES.Account).to(Account).inTransientScope();

    options.bind<IOIDCUtils>(TYPES.OIDCUtils).to(OIDCUtils).inTransientScope();

    options
      .bind<IOIDCConfig>(TYPES.OIDCConfig)
      .to(OIDCConfig)
      .inTransientScope();

    options
      .bind<IOIDCClientMerger>(TYPES.OIDCClientMerger)
      .to(OIDCClientMerger)
      .inTransientScope();

    // OIDC Flow Handlers - Transient (per-request)
    options
      .bind<IOIDCAbortHandler>(TYPES.OIDCAbortHandler)
      .to(OIDCAbortHandler)
      .inTransientScope();

    options
      .bind<IOIDCConsentHandler>(TYPES.OIDCConsentHandler)
      .to(OIDCConsentHandler)
      .inTransientScope();

    options
      .bind<IOIDCErrorHandler>(TYPES.OIDCErrorHandler)
      .to(OIDCErrorHandler)
      .inTransientScope();

    options
      .bind<IOIDCInteractionHandler>(TYPES.OIDCInteractionHandler)
      .to(OIDCInteractionHandler)
      .inTransientScope();

    options
      .bind<IOIDCLoginHandler>(TYPES.OIDCLoginHandler)
      .to(OIDCLoginHandler)
      .inTransientScope();

    options
      .bind<IOIDCMfaHandler>(TYPES.OIDCMfaHandler)
      .to(OIDCMfaHandler)
      .inTransientScope();

    options
      .bind<IOIDCNewDeviceVerifyHandler>(TYPES.OIDCNewDeviceVerifyHandler)
      .to(OIDCNewDeviceVerifyHandler)
      .inTransientScope();

    options
      .bind<IOIDCSelectAccountHandler>(TYPES.OIDCSelectAccountHandler)
      .to(OIDCSelectAccountHandler)
      .inTransientScope();

    options
      .bind<IOIDCSocialCallbackHandler>(TYPES.OIDCSocialCallbackHandler)
      .to(OIDCSocialCallbackHandler)
      .inTransientScope();

    options
      .bind<IOIDCSocialLoginHandler>(TYPES.OIDCSocialLoginHandler)
      .to(OIDCSocialLoginHandler)
      .inTransientScope();

    options
      .bind<IOIDCWebAuthnMfaHandler>(TYPES.OIDCWebAuthnMfaHandler)
      .to(OIDCWebAuthnMfaHandler)
      .inTransientScope();

    options
      .bind<IOidcRoutesManager>(TYPES.OidcRoutesManager)
      .to(OidcRoutesManager)
      .inSingletonScope();

    options
      .bind<IOidcManager>(TYPES.OidcManager)
      .to(OidcManager)
      .inSingletonScope();
  }
);
