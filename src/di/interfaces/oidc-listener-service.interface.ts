import type { Provider } from 'oidc-provider';

export interface IOIDCListenerService {
  setupListeners(provider: Provider): Promise<void>;
}
