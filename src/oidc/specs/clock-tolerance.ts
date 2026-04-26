import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';

/**
 * Factory function to create clock tolerance configuration
 * @param configManager - Configuration manager instance
 * @returns Clock tolerance value in seconds
 */
export default function ClockTolerance(configManager: IConfigManager) {
  const config = configManager.getConfig();

  /**
   * Clock Tolerance
   *
   * @see {@link https://openid.net/specs/openid-connect-core-1_0.html#ClockSkew}
   *
   * Clock tolerance is the amount of time that can pass between the client and the server.
   * This allows for some leeway in time between the two, which is useful for situations where the client and server have slightly different clocks.
   *
   * @example
   *
   * const clockTolerance = 15;
   */
  return config.features.oidc.clock_tolerance;
}
