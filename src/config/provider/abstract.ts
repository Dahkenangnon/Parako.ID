import { IConfigProvider } from '../../di/interfaces/config-provider.interface.js';
import type { DeepPartial } from '../../utils/config-merge.js';

/** Only concrete providers are injectable. */
export abstract class AbstractConfigProvider<
  T = any,
> implements IConfigProvider {
  abstract loadConfiguration(): Promise<T>;

  /** Bypasses stale cache state and replaces it with a fresh source read. */
  abstract reloadConfiguration(): Promise<T>;

  abstract clearCache(): void;

  abstract isCached(): boolean;

  abstract getConfigValue<V = any>(path: string, defaultValue?: V): V;

  abstract getProviderName(): string;

  abstract isAvailable(): Promise<boolean>;

  /** Optional capability implemented by writable providers. */
  abstract updateConfig?(
    partial: DeepPartial<T>,
    expectedVersion?: number
  ): Promise<T>;
}
