/**
 * Lazy service-worker registration.
 *
 * The registration is deferred to the window load event so the worker does
 * not compete with first paint. An explicit `window.PARAKO_DISABLE_SW = true`
 * disables registration entirely for debugging or for environments where the
 * worker's caching would interfere.
 */

interface ParakoWindow extends Window {
  PARAKO_DISABLE_SW?: boolean;
}

const parakoWindow = window as ParakoWindow;

const register = (): void => {
  if (parakoWindow.PARAKO_DISABLE_SW === true) return;
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/service-worker.js').catch(() => {
    // Registration failures are silent; the application continues to work
    // without offline caching when the worker cannot install.
  });
};

if (document.readyState === 'complete') {
  register();
} else {
  window.addEventListener('load', register, { once: true });
}
