/**
 * Locally-bundled FingerprintJS — exposes `window.FingerprintJS` so the
 * `DeviceInfoCollector` in `user.ts` can call `FingerprintJS.load()` and
 * `instance.get()` without fetching the library from a third-party CDN.
 *
 * Loading from `cdn.jsdelivr.net` is blocked by the default CSP
 * (`script-src 'self'`); vendoring the package matches the same
 * pattern used for Alpine.js and Lucide, keeps the page within CSP,
 * and removes a third-party request from the auth render path.
 */

import FingerprintJS from '@fingerprintjs/fingerprintjs';

window.FingerprintJS = FingerprintJS;
