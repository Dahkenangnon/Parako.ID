import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const releaseScript = fileURLToPath(
  new URL('../../../scripts/release.sh', import.meta.url)
);
const releaseScriptSource = readFileSync(releaseScript, 'utf8');

function runReleaseScript(...arguments_: string[]) {
  return spawnSync('bash', [releaseScript, ...arguments_], {
    encoding: 'utf8',
  });
}

describe('release shell CLI', () => {
  it('prints help before requiring a release version', () => {
    const result = runReleaseScript('--help');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Parako.ID Build and Release Script');
    expect(result.stdout).toContain('Usage:');
    expect(result.stderr).toBe('');
  });

  it('rejects a missing release version with a usage error', () => {
    const result = runReleaseScript();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Version is required');
    expect(result.stdout).toContain('Usage:');
  });

  it('rejects unknown options with a usage error', () => {
    const result = runReleaseScript('--not-an-option');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown option: --not-an-option');
  });

  it('removes local translation caches from release artifacts', () => {
    expect(releaseScriptSource).toContain(
      'rm -rf "$release_dir/runtime/locales/.merged"'
    );
  });

  it('requires the dedicated relying-party example', () => {
    expect(releaseScriptSource).toContain(
      'parako-rp.example.json not found — refusing to substitute the unrelated server configuration sample'
    );
    expect(releaseScriptSource).not.toContain(
      'cp parako.sample.jsonc "$release_dir/contrib/parako-rp.sample.jsonc"'
    );
  });

  it('requires a production dependency license inventory', () => {
    expect(releaseScriptSource).toContain(
      'scripts/check-production-licenses.mjs'
    );
    expect(releaseScriptSource).toContain('pnpm licenses list --prod');
    expect(releaseScriptSource).toContain('THIRD_PARTY_LICENSES.txt');
  });
});
