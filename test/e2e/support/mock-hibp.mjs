import { watch } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const prefix = process.env.PARAKO_E2E_HIBP_PREFIX;
const suffix = process.env.PARAKO_E2E_HIBP_SUFFIX;
const count = Number.parseInt(process.env.PARAKO_E2E_HIBP_COUNT ?? '42', 10);
const drainEnabled = process.env.PARAKO_E2E_WORKER_DRAIN === 'true';
const drainPrefix = process.env.PARAKO_E2E_DRAIN_HIBP_PREFIX;
const drainSuffix = process.env.PARAKO_E2E_DRAIN_HIBP_SUFFIX;
const drainCount = Number.parseInt(
  process.env.PARAKO_E2E_DRAIN_HIBP_COUNT ?? '84',
  10
);
const drainStartedFile = process.env.PARAKO_E2E_WORKER_DRAIN_STARTED_FILE;
const drainReleaseFile = process.env.PARAKO_E2E_WORKER_DRAIN_RELEASE_FILE;

function assertRange(name, rangePrefix, rangeSuffix, rangeCount) {
  if (!rangePrefix || !/^[A-F0-9]{5}$/.test(rangePrefix)) {
    throw new Error(name + ' prefix must be a five-character SHA1 prefix');
  }
  if (!rangeSuffix || !/^[A-F0-9]{35}$/.test(rangeSuffix)) {
    throw new Error(name + ' suffix must be a 35-character SHA1 suffix');
  }
  if (!Number.isSafeInteger(rangeCount) || rangeCount < 1) {
    throw new Error(name + ' count must be a positive integer');
  }
}

assertRange('PARAKO_E2E_HIBP', prefix, suffix, count);
if (drainEnabled) {
  assertRange('PARAKO_E2E_DRAIN_HIBP', drainPrefix, drainSuffix, drainCount);
  if (drainPrefix === prefix) {
    throw new Error('Worker drain and login HIBP prefixes must differ');
  }
  if (
    !drainStartedFile ||
    !path.isAbsolute(drainStartedFile) ||
    !drainReleaseFile ||
    !path.isAbsolute(drainReleaseFile)
  ) {
    throw new Error('Worker drain gate files must be absolute paths');
  }
}

function waitForFile(filePath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const directory = path.dirname(filePath);
    const expectedName = path.basename(filePath);
    let settled = false;
    const watcher = watch(directory);
    const timeout = setTimeout(() => {
      finish(new Error('Timed out waiting for worker drain release'));
    }, timeoutMs);

    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      watcher.close();
      if (error) reject(error);
      else resolve();
    };
    const check = async () => {
      try {
        await fs.access(filePath);
        finish();
      } catch {
        // The watcher remains the synchronization primitive until release.
      }
    };

    watcher.on('change', (_event, filename) => {
      if (filename?.toString() === expectedName) void check();
    });
    watcher.on('error', finish);
    // Close the small race between registering the watcher and the file write.
    void check();
  });
}

async function gatedRangeResponse() {
  await fs.writeFile(drainStartedFile, 'started\n', 'utf8');
  await waitForFile(drainReleaseFile, 30_000);
  return new Response(`${drainSuffix}:${drainCount}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    status: 200,
  });
}

// Loaded only by the disposable compiled worker. This intercepts exact
// k-anonymous ranges while preventing browser tests from depending on HIBP.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : input instanceof URL ? input : input
  );
  if (
    url.origin === 'https://api.pwnedpasswords.com' &&
    url.pathname === `/range/${prefix}`
  ) {
    return Promise.resolve(
      new Response(`${suffix}:${count}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        status: 200,
      })
    );
  }
  if (
    drainEnabled &&
    url.origin === 'https://api.pwnedpasswords.com' &&
    url.pathname === `/range/${drainPrefix}`
  ) {
    return gatedRangeResponse();
  }
  return originalFetch(input, init);
};
