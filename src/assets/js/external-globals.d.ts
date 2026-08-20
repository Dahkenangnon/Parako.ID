interface LucideBrowserApi {
  createIcons(): void;
}

declare global {
  interface Window {
    Alpine?: typeof import('@alpinejs/csp').default;
    FingerprintJS?: typeof import('@fingerprintjs/fingerprintjs').default;
    lucide?: LucideBrowserApi;
  }
}

export {};
