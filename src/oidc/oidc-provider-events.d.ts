import 'oidc-provider';
import type { InitialAccessToken } from 'oidc-provider';

declare module 'oidc-provider' {
  interface Provider {
    // The runtime derives persistence event names from the model kind, but
    // @types/oidc-provider 9.5 omits the InitialAccessToken overloads.
    on(
      event: 'initial_access_token.destroyed',
      listener: (token: InitialAccessToken) => void
    ): this;
    on(
      event: 'initial_access_token.saved',
      listener: (token: InitialAccessToken) => void
    ): this;
  }
}
