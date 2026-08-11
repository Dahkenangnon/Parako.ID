import { isIP } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';
import type { CustomFetchOptions } from 'openid-client';

export interface E2eFetch {
  (url: string, init?: RequestInit | CustomFetchOptions): Promise<Response>;
  close?(): Promise<void>;
}

const LOCALHOST_SUFFIX = '.localhost';

function parseDisposableLocalhost(hostname: string): {
  isDisposable: boolean;
  tenantId?: string;
} {
  if (!hostname.endsWith(LOCALHOST_SUFFIX)) {
    return { isDisposable: false };
  }

  const labels = hostname.split('.');
  if (labels.length === 2) {
    return { isDisposable: true };
  }
  if (labels.length !== 3) {
    return { isDisposable: false };
  }

  const tenantId = labels[0];
  const isSystemTenant = tenantId === '_platforms' || tenantId === '_ops';
  const isTenantSlug = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(tenantId);
  return isSystemTenant || isTenantSlug
    ? { isDisposable: true, tenantId }
    : { isDisposable: false };
}

/**
 * Route Node-side requests for disposable tenant hostnames to loopback while
 * preserving tenant selection through Parako's supported tenant header.
 */
export function createLoopbackTenantFetch(
  loopbackOrigin: string,
  delegate?: E2eFetch
): E2eFetch {
  const loopback = new URL(loopbackOrigin);
  if (
    loopback.hostname === 'localhost' ||
    loopback.hostname.endsWith(LOCALHOST_SUFFIX)
  ) {
    loopback.hostname = '127.0.0.1';
  }

  const addressFamily = isIP(loopback.hostname);
  if (addressFamily === 0) {
    throw new TypeError('loopbackOrigin must contain an IP hostname');
  }

  const dispatcher =
    delegate === undefined
      ? new Agent({
          connect: {
            lookup(_hostname, options, callback) {
              const address = loopback.hostname;
              if (options.all) {
                callback(null, [{ address, family: addressFamily }]);
              } else {
                callback(null, address, addressFamily);
              }
            },
          },
        })
      : undefined;
  const routedDelegate: E2eFetch =
    delegate ??
    ((url, init) => {
      const undiciInit = {
        ...init,
        dispatcher,
      } as Parameters<typeof undiciFetch>[1];
      return undiciFetch(url, undiciInit) as unknown as Promise<Response>;
    });
  const directDelegate: E2eFetch =
    delegate ?? ((url, init) => fetch(url, init as RequestInit));

  const routeToLoopback = (
    original: URL,
    init: RequestInit | CustomFetchOptions | undefined,
    tenantId?: string
  ) => {
    const headers = new Headers(init?.headers);
    headers.delete('host');
    headers.delete('x-forwarded-host');
    headers.delete('x-forwarded-proto');
    if (tenantId) headers.set('x-tenant-id', tenantId);
    if (original.protocol !== loopback.protocol) {
      throw new TypeError('tenant URL protocol must match loopbackOrigin');
    }
    const routedInit = {
      ...init,
      headers: Object.fromEntries(headers),
    } as RequestInit | CustomFetchOptions;
    return routedDelegate(original.href, routedInit);
  };

  const tenantFetch: E2eFetch = async (url, init) => {
    const original = new URL(url);
    const hostname = original.hostname.toLowerCase();
    const disposable = parseDisposableLocalhost(hostname);
    if (!disposable.isDisposable) {
      return directDelegate(url, init);
    }
    return routeToLoopback(original, init, disposable.tenantId);
  };
  tenantFetch.close = async () => {
    await dispatcher?.close();
    await delegate?.close?.();
  };
  return tenantFetch;
}
