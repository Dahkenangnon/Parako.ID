import { request } from 'node:http';

/**
 * Probe a disposable HTTP server through loopback while preserving its public
 * Host header. Node does not resolve arbitrary `*.localhost` names on every
 * platform, but multi-tenant routing still needs the original tenant host.
 */
export function probeLoopbackReadiness(url) {
  const target = new URL(url);
  if (target.protocol !== 'http:') {
    return Promise.reject(
      new Error(`Unsupported readiness protocol: ${target.protocol}`)
    );
  }

  return new Promise((resolve, reject) => {
    const probe = request(
      {
        hostname: '127.0.0.1',
        port: target.port || '80',
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { host: target.host },
      },
      response => {
        response.resume();
        response.once('end', () => {
          resolve(
            response.statusCode !== undefined &&
              response.statusCode >= 200 &&
              response.statusCode < 300
          );
        });
      }
    );
    probe.once('error', reject);
    probe.end();
  });
}
