import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parse } from 'jsonc-parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const clientEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'client.js'
);

function runClient(temporaryRoot: string, ...args: string[]) {
  return spawnSync(process.execPath, [clientEntrypoint, ...args], {
    cwd: temporaryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_ENV: 'test',
    },
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runInteractiveClient(
  temporaryRoot: string,
  steps: Array<{ prompt: string; answer: string }>
): Promise<{
  completedPrompts: number;
  status: number | null;
  stderr: string;
  stdout: string;
}> {
  const command = [process.execPath, clientEntrypoint, 'add']
    .map(shellQuote)
    .join(' ');
  const child = spawn('script', ['-qfec', command, '/dev/null'], {
    cwd: temporaryRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  return await new Promise((resolveResult, reject) => {
    let completedPrompts = 0;
    let outputSearchOffset = 0;
    let stderr = '';
    let stdout = '';
    // Prompt matching drives progress; this ceiling only detects a deadlocked child process.
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error('Interactive client command timed out after 10 seconds')
      );
    }, 10_000);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const step = steps[completedPrompts];
      const promptIndex = step
        ? stdout.indexOf(step.prompt, outputSearchOffset)
        : -1;
      if (step && promptIndex >= 0) {
        outputSearchOffset = promptIndex + step.prompt.length;
        completedPrompts += 1;
        child.stdin.write(step.answer);
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', status => {
      clearTimeout(timeout);
      resolveResult({ completedPrompts, status, stderr, stdout });
    });
  });
}

describe('compiled client-management CLI', () => {
  let temporaryRoot: string;

  beforeEach(() => {
    if (!existsSync(clientEntrypoint)) {
      throw new Error(
        'The compiled client-management CLI is missing. Run pnpm build before this integration suite.'
      );
    }
    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-client-cli-'));
  });

  afterEach(() => {
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('lists an empty local registry with a successful status', () => {
    const result = runClient(temporaryRoot, 'list');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('No OIDC Clients Found');
    expect(result.stdout).toContain('pnpm client add');
  });

  it('lists populated registry state without exposing client secrets', () => {
    const runtimeDirectory = join(temporaryRoot, 'runtime');
    mkdirSync(runtimeDirectory);
    writeFileSync(
      join(runtimeDirectory, 'parako-rp.jsonc'),
      JSON.stringify({
        version: '1.0.0',
        clients: [
          {
            client_id: 'active-rp',
            client_name: 'Active RP',
            client_secret: 'private-client-secret',
            application_type: 'web',
            token_endpoint_auth_method: 'client_secret_basic',
            grant_types: ['authorization_code'],
            response_types: ['code'],
            redirect_uris: ['https://rp.example.test/callback'],
            post_logout_redirect_uris: [],
            scope: 'openid',
            active: true,
          },
          {
            client_id: 'inactive-rp',
            client_name: 'Inactive RP',
            application_type: 'native',
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code'],
            response_types: ['code'],
            redirect_uris: ['app:/callback'],
            post_logout_redirect_uris: [],
            scope: 'openid',
            active: false,
          },
        ],
      }),
      { mode: 0o600 }
    );

    const result = runClient(temporaryRoot, 'list');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Registered Clients (2 total)');
    expect(result.stdout).toContain('active-rp');
    expect(result.stdout).toContain('inactive-rp');
    expect(result.stdout).toMatch(/│Active\s+│1\s+│/u);
    expect(result.stdout).toMatch(/│Inactive\s+│1\s+│/u);
    expect(result.stdout).not.toContain('private-client-secret');
  });

  it('fails without replacing a malformed registry', () => {
    const runtimeDirectory = join(temporaryRoot, 'runtime');
    const registryPath = join(runtimeDirectory, 'parako-rp.jsonc');
    const malformedRegistry = '{"clients":[{"client_secret":"private-marker"}';
    mkdirSync(runtimeDirectory);
    writeFileSync(registryPath, malformedRegistry, { mode: 0o600 });

    const result = runClient(temporaryRoot, 'list');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'CLI error: Failed to load client configuration: Invalid JSONC configuration'
    );
    expect(result.stderr).not.toContain('private-marker');
    expect(result.stdout).not.toContain('No OIDC Clients Found');
    expect(readFileSync(registryPath, 'utf8')).toBe(malformedRegistry);
  });

  it('fails fast when interactive creation has no terminal', () => {
    const result = runClient(temporaryRoot, 'add');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'CLI error: Failed to add client: Refusing to start interactive prompt'
    );
    expect(result.stdout).not.toContain('Client created successfully');
    expect(existsSync(join(temporaryRoot, 'runtime'))).toBe(false);
  });

  it('creates a confidential web client through the interactive terminal', async () => {
    const steps = [
      { prompt: 'What type of client are you creating?', answer: '\r' },
      {
        prompt: 'Client ID (leave empty to auto-generate):',
        answer: 'web-rp\r',
      },
      { prompt: 'Client name:', answer: 'Demo RP\r' },
      { prompt: 'Description (optional):', answer: '\r' },
      { prompt: 'Add redirect URIs?', answer: 'n\r' },
      {
        prompt:
          'Additional scopes (space-separated, will be added to defaults):',
        answer: '\r',
      },
      { prompt: 'Client URI (optional):', answer: '\r' },
      { prompt: 'Logo URI (optional):', answer: '\r' },
      { prompt: 'Tags (comma-separated, optional):', answer: '\r' },
      { prompt: 'Create this client?', answer: '\r' },
    ];

    const result = await runInteractiveClient(temporaryRoot, steps);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.completedPrompts).toBe(steps.length);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Client created successfully');
    const registryPath = join(temporaryRoot, 'runtime', 'parako-rp.jsonc');
    const registry = parse(readFileSync(registryPath, 'utf8'));
    expect(registry.clients).toHaveLength(1);
    expect(registry.clients[0]).toMatchObject({
      client_id: 'web-rp',
      client_name: 'Demo RP',
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: [],
      scope: 'openid profile email',
      active: true,
    });
    expect(registry.clients[0].client_secret).toMatch(/^[A-Za-z0-9._~-]{64}$/u);
    expect(statSync(registryPath).mode & 0o777).toBe(0o600);
  });

  it('rejects a conflicting client ID before creating the replacement', async () => {
    const runtimeDirectory = join(temporaryRoot, 'runtime');
    const registryPath = join(runtimeDirectory, 'parako-rp.jsonc');
    mkdirSync(runtimeDirectory);
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: '1.0.0',
        clients: [
          {
            client_id: 'existing-rp',
            client_name: 'Existing RP',
            token_endpoint_auth_method: 'none',
            application_type: 'native',
            grant_types: ['authorization_code'],
            response_types: ['code'],
            redirect_uris: ['app:/callback'],
            post_logout_redirect_uris: [],
            scope: 'openid',
            active: true,
          },
        ],
      }),
      { mode: 0o600 }
    );
    const clientIdPrompt = 'Client ID (leave empty to auto-generate):';
    const steps = [
      { prompt: 'What type of client are you creating?', answer: '\r' },
      { prompt: clientIdPrompt, answer: 'existing-rp\r' },
      { prompt: clientIdPrompt, answer: 'replacement-rp\r' },
      { prompt: 'Client name:', answer: 'Replacement RP\r' },
      { prompt: 'Description (optional):', answer: '\r' },
      { prompt: 'Add redirect URIs?', answer: 'n\r' },
      {
        prompt:
          'Additional scopes (space-separated, will be added to defaults):',
        answer: '\r',
      },
      { prompt: 'Client URI (optional):', answer: '\r' },
      { prompt: 'Logo URI (optional):', answer: '\r' },
      { prompt: 'Tags (comma-separated, optional):', answer: '\r' },
      { prompt: 'Create this client?', answer: '\r' },
    ];

    const result = await runInteractiveClient(temporaryRoot, steps);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.completedPrompts).toBe(steps.length);
    expect(result.stdout).toContain(
      "Client with ID 'existing-rp' already exists"
    );
    const registry = parse(readFileSync(registryPath, 'utf8'));
    expect(registry.clients).toHaveLength(2);
    expect(
      registry.clients.map((client: { client_id: string }) => client.client_id)
    ).toEqual(['existing-rp', 'replacement-rp']);
  });

  it('rejects unsafe interactive URLs before persisting corrected input', async () => {
    const redirectPrompt = 'Redirect URI 1 (press Enter to finish):';
    const clientUriPrompt = 'Client URI (optional):';
    const logoUriPrompt = 'Logo URI (optional):';
    const steps = [
      { prompt: 'What type of client are you creating?', answer: '\r' },
      {
        prompt: 'Client ID (leave empty to auto-generate):',
        answer: 'validated-rp\r',
      },
      { prompt: 'Client name:', answer: 'Validated RP\r' },
      { prompt: 'Description (optional):', answer: '\r' },
      { prompt: 'Add redirect URIs?', answer: '\r' },
      { prompt: redirectPrompt, answer: 'javascript:alert(1)\r' },
      {
        prompt: redirectPrompt,
        answer: 'https://rp.example.test/callback\r',
      },
      { prompt: 'Redirect URI 2 (press Enter to finish):', answer: '\r' },
      { prompt: 'Add post-logout redirect URIs?', answer: 'n\r' },
      {
        prompt:
          'Additional scopes (space-separated, will be added to defaults):',
        answer: '\r',
      },
      { prompt: clientUriPrompt, answer: 'javascript:alert(1)\r' },
      { prompt: clientUriPrompt, answer: '\r' },
      { prompt: logoUriPrompt, answer: 'data:image/svg+xml,unsafe\r' },
      { prompt: logoUriPrompt, answer: '\r' },
      { prompt: 'Tags (comma-separated, optional):', answer: '\r' },
      { prompt: 'Create this client?', answer: '\r' },
    ];

    const result = await runInteractiveClient(temporaryRoot, steps);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.completedPrompts).toBe(steps.length);
    expect(result.stdout).toContain('Please enter a valid URL');
    const registryPath = join(temporaryRoot, 'runtime', 'parako-rp.jsonc');
    const registry = parse(readFileSync(registryPath, 'utf8'));
    expect(registry.clients).toHaveLength(1);
    expect(registry.clients[0]).toMatchObject({
      client_id: 'validated-rp',
      redirect_uris: ['https://rp.example.test/callback'],
    });
    expect(registry.clients[0].client_uri).toBeUndefined();
    expect(registry.clients[0].logo_uri).toBeUndefined();
    expect(readFileSync(registryPath, 'utf8')).not.toMatch(
      /javascript:|data:image/iu
    );
  });

  it('cancels interactive creation without writing a registry', async () => {
    const steps = [
      { prompt: 'What type of client are you creating?', answer: '\r' },
      {
        prompt: 'Client ID (leave empty to auto-generate):',
        answer: 'cancelled-rp\r',
      },
      { prompt: 'Client name:', answer: 'Cancelled RP\r' },
      { prompt: 'Description (optional):', answer: '\r' },
      { prompt: 'Add redirect URIs?', answer: 'n\r' },
      {
        prompt:
          'Additional scopes (space-separated, will be added to defaults):',
        answer: '\r',
      },
      { prompt: 'Client URI (optional):', answer: '\r' },
      { prompt: 'Logo URI (optional):', answer: '\r' },
      { prompt: 'Tags (comma-separated, optional):', answer: '\r' },
      { prompt: 'Create this client?', answer: 'n\r' },
    ];

    const result = await runInteractiveClient(temporaryRoot, steps);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.completedPrompts).toBe(steps.length);
    expect(result.stdout).toContain('Operation cancelled.');
    expect(result.stdout).not.toContain('Client created successfully');
    expect(existsSync(join(temporaryRoot, 'runtime'))).toBe(false);
  });
});
