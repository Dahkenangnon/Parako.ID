/**
 * DeviceInfoCollector - Lightweight device fingerprinting for form injection
 *
 * Collects only the essential device identifier (visitorId) using FingerprintJS
 * and injects it into forms for server-side device tracking.
 *
 * Payload is minimal (~80 bytes): { visitorId, visitorIdSource }
 */
(function () {
  'use strict';

  interface DeviceInfo {
    visitorId: string;
    visitorIdSource: 'fingerprintjs' | 'fallback';
  }

  interface Config {
    csrfToken: string;
    fingerprintJSApiKey?: string;
    debug: boolean;
  }

  const FALLBACK_ID_KEY = 'parako_device_fallback_id';

  class DeviceInfoCollector {
    private config: Config;
    private deviceInfo: DeviceInfo | null = null;
    private formObserver: MutationObserver | null = null;

    constructor(config: Config) {
      this.config = config;
      this.log('DeviceInfoCollector initialized');
    }

    async initialize(): Promise<void> {
      try {
        this.log('Starting device info collection');

        this.deviceInfo = await this.collectDeviceInfo();

        this.log('Device info collected', {
          visitorId: this.deviceInfo.visitorId,
          source: this.deviceInfo.visitorIdSource,
        });

        this.injectIntoForms();

        // Watch for dynamically added forms
        this.startFormObserver();
      } catch (error) {
        console.error('[DeviceInfoCollector] Initialization failed:', error);
      }
    }

    private async collectDeviceInfo(): Promise<DeviceInfo> {
      try {
        const fpData = await this.loadFingerprintJS();
        return {
          visitorId: fpData.visitorId,
          visitorIdSource: 'fingerprintjs',
        };
      } catch (error) {
        this.log('FingerprintJS failed, using fallback', { error }, 'warn');
        return {
          visitorId: this.getFallbackId(),
          visitorIdSource: 'fallback',
        };
      }
    }

    private async loadFingerprintJS(): Promise<{ visitorId: string }> {
      return new Promise((resolve, reject) => {
        if ((window as any).FingerprintJS) {
          this.initFingerprintJS(
            (window as any).FingerprintJS,
            resolve,
            reject
          );
          return;
        }

        const script = document.createElement('script');
        script.src =
          'https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@3.4.2/dist/fp.min.js';
        script.integrity =
          'sha384-RGoAjUH4gJ40bAD0YPezgdsNOCbBWQlNwdWfA981c/7NgIyqm+TeAelFv346J7UO';
        script.crossOrigin = 'anonymous';
        script.async = true;

        script.onload = () => {
          if ((window as any).FingerprintJS) {
            this.initFingerprintJS(
              (window as any).FingerprintJS,
              resolve,
              reject
            );
          } else {
            reject(new Error('FingerprintJS failed to load'));
          }
        };

        script.onerror = () =>
          reject(new Error('Failed to load FingerprintJS'));
        document.head.appendChild(script);
      });
    }

    private async initFingerprintJS(
      FingerprintJS: any,
      resolve: (data: { visitorId: string }) => void,
      reject: (error: Error) => void
    ): Promise<void> {
      try {
        const loadOptions: Record<string, unknown> = {};

        if (this.config.fingerprintJSApiKey) {
          loadOptions.apiKey = this.config.fingerprintJSApiKey;
          this.log('Using FingerprintJS Pro');
        }

        const fp = await FingerprintJS.load(
          Object.keys(loadOptions).length > 0 ? loadOptions : undefined
        );
        const result = await fp.get();

        resolve({ visitorId: result.visitorId });
      } catch (error) {
        reject(error as Error);
      }
    }

    /**
     * Get or generate a fallback device ID stored in localStorage
     */
    private getFallbackId(): string {
      try {
        const stored = localStorage.getItem(FALLBACK_ID_KEY);
        if (stored) {
          this.log('Retrieved fallback ID from localStorage');
          return stored;
        }
      } catch {
        // localStorage unavailable
      }

      const components = [
        navigator.platform,
        navigator.language,
        screen.width,
        screen.height,
        screen.colorDepth,
        navigator.hardwareConcurrency || 0,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ].join('|');

      let hash = 0;
      for (let i = 0; i < components.length; i++) {
        hash = (hash << 5) - hash + components.charCodeAt(i);
        hash = hash & hash;
      }

      const randomSuffix = Math.random().toString(36).substring(2, 10);
      const fallbackId = `fb_${Math.abs(hash).toString(36)}_${randomSuffix}`;

      try {
        localStorage.setItem(FALLBACK_ID_KEY, fallbackId);
        this.log('Stored new fallback ID');
      } catch {
        // localStorage unavailable
      }

      return fallbackId;
    }

    private injectIntoForms(): void {
      if (!this.deviceInfo) return;

      // Only inject into POST forms - device info is extracted from req.body on server
      const forms = document.querySelectorAll(
        'form[method="POST"], form[method="post"]'
      );
      this.log(`Injecting into ${forms.length} POST forms`);

      forms.forEach(form => this.injectIntoForm(form as HTMLFormElement));
    }

    private injectIntoForm(form: HTMLFormElement): void {
      if (!this.deviceInfo || !this.config.csrfToken) return;

      const method = form.getAttribute('method')?.toUpperCase() || 'GET';
      if (method !== 'POST') {
        return;
      }

      // Static field name — CSRF protection is handled by the _csrf token,
      // no need to embed it in the device info field name.
      const fieldName = '_deviceInfo';
      const existingField = form.querySelector(`input[name="${fieldName}"]`);
      const value = JSON.stringify(this.deviceInfo);

      if (existingField) {
        (existingField as HTMLInputElement).value = value;
        return;
      }

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = fieldName;
      input.value = value;
      form.insertBefore(input, form.firstChild);

      this.log('Injected into form', { formId: form.id || 'unnamed' });
    }

    private startFormObserver(): void {
      if (this.formObserver) return;

      this.formObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              if (el.tagName === 'FORM') {
                // Only inject into POST forms
                const formMethod =
                  (el as HTMLFormElement)
                    .getAttribute('method')
                    ?.toUpperCase() || 'GET';
                if (formMethod === 'POST') {
                  this.injectIntoForm(el as HTMLFormElement);
                }
              } else {
                // Only target POST forms in nested elements
                const nestedForms = el.querySelectorAll(
                  'form[method="POST"], form[method="post"]'
                );
                nestedForms.forEach(f =>
                  this.injectIntoForm(f as HTMLFormElement)
                );
              }
            }
          }
        }
      });

      this.formObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      this.log('Form observer started');
    }

    destroy(): void {
      if (this.formObserver) {
        this.formObserver.disconnect();
        this.formObserver = null;
      }
      this.deviceInfo = null;
      this.log('Destroyed');
    }

    private log(
      message: string,
      data?: any,
      level: 'log' | 'warn' | 'error' = 'log'
    ): void {
      if (!this.config.debug && level === 'log') return;
      const prefix = '[DeviceInfoCollector]';
      if (data) {
        console[level](prefix, message, data);
      } else {
        console[level](prefix, message);
      }
    }
  }

  // Auto-initialize on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    const stateEl = document.getElementById('___USER_DEVICE_INFO_STATE___');
    if (!stateEl) {
      console.warn('[DeviceInfoCollector] Config element not found');
      return;
    }

    let config: Config;
    try {
      config = JSON.parse(stateEl.textContent || '{}');
    } catch {
      console.error('[DeviceInfoCollector] Failed to parse config');
      return;
    }

    if (!config.csrfToken) {
      console.warn('[DeviceInfoCollector] No CSRF token in config');
      return;
    }

    const collector = new DeviceInfoCollector(config);
    collector.initialize();

    if (config.debug) {
      (window as any).deviceInfoCollector = collector;
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => collector.destroy());
    window.addEventListener('pagehide', () => collector.destroy());
  });
})();
