/**
 * Lazy service-worker registration.
 *
 * The registration is deferred to the window load event so the worker does
 * not compete with first paint. An explicit `window.PARAKO_DISABLE_SW = true`
 * disables registration entirely for debugging or for environments where the
 * worker's caching would interfere.
 */

interface ParakoWindow {
  PARAKO_DISABLE_SW?: boolean;
  addEventListener(
    type: 'load',
    listener: () => void,
    options: { once: true }
  ): void;
}

interface ServiceWorkerNavigator {
  serviceWorker?: {
    register(url: string): Promise<unknown>;
  };
}

interface ServiceWorkerDocument {
  readyState: string;
}

/** Install service-worker registration for an explicit browser environment. */
export function installServiceWorkerRegistration(
  parakoWindow: ParakoWindow,
  browserDocument: ServiceWorkerDocument,
  browserNavigator: ServiceWorkerNavigator
): void {
  const register = (): void => {
    if (parakoWindow.PARAKO_DISABLE_SW === true) return;
    if (!browserNavigator.serviceWorker) return;

    browserNavigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Registration failures are silent; the application continues to work
      // without offline caching when the worker cannot install.
    });
  };

  if (browserDocument.readyState === 'complete') {
    register();
  } else {
    parakoWindow.addEventListener('load', register, { once: true });
  }
}

if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof navigator !== 'undefined'
) {
  installServiceWorkerRegistration(window, document, navigator);
}
