import type { IActivityService } from '../../../di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import type { IOIDCAdapterBridge } from '../../../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IPasswordUtils } from '../../../di/interfaces/password-utils.interface.js';
import type { IUserService } from '../../../di/interfaces/user-service.interface.js';
import type { EntityTransferConfig } from '../types.js';

export interface EntityConfigDeps {
  userService: IUserService;
  activityService: IActivityService;
  oidcAdapterBridge: IOIDCAdapterBridge;
  passwordUtils: IPasswordUtils;
  logger: ILogger;
}

export type EntityConfigFactory = (
  deps: EntityConfigDeps
) => EntityTransferConfig;
