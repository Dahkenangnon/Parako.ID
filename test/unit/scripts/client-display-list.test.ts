import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  addClientInteractive: vi.fn(),
  createBox: vi.fn(() => 'EMPTY BOX'),
  createTable: vi.fn((_headers?: unknown, _rows?: string[][]) => 'TABLE'),
  listClientsConfig: vi.fn(),
  log: {
    title: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../../../scripts/manage/client/local-client-manager.js', () => ({
  loadClientRegistryConfig: dependencies.listClientsConfig,
}));
vi.mock('../../../scripts/manage/client/add.js', () => ({
  addClientInteractive: dependencies.addClientInteractive,
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  createBox: dependencies.createBox,
  createTable: dependencies.createTable,
  log: dependencies.log,
}));

import { setupCommands } from '../../../scripts/manage/client/commands.js';
import { displayClient } from '../../../scripts/manage/client/display.js';
import { listClients } from '../../../scripts/manage/client/list.js';
import { CLIENT_TYPES } from '../../../scripts/manage/client/types.js';
import {
  COMMAND_SHORTCUTS,
  SUB_CLIS,
} from '../../../scripts/manage/shared/types.js';
import type { OidcClient } from '../../../scripts/manage/client/local-types.js';

function client(overrides: Partial<OidcClient> = {}): OidcClient {
  return {
    client_id: 'client-id',
    application_type: 'web',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: [],
    post_logout_redirect_uris: [],
    scope: 'openid',
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  dependencies.listClientsConfig.mockReset().mockReturnValue({ clients: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('OIDC client display and listing', () => {
  it('renders all configured client details and an explicitly requested secret', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    displayClient(
      client({
        client_id: 'web-client',
        client_name: 'Web Client',
        client_secret: 'secret',
        preset: 'web',
        require_pkce: true,
        redirect_uris: ['https://rp.example.com/callback'],
        post_logout_redirect_uris: ['https://rp.example.com/'],
        description: 'Demo application',
        tags: ['demo', 'web'],
        created_at: Date.parse('2026-01-01T00:00:00Z'),
        updated_at: Date.parse('2026-01-02T00:00:00Z'),
      }),
      true
    );

    const output = consoleLog.mock.calls.flat().join('\n');
    expect(output).toContain('Web Client');
    expect(output).toContain('Regular Web Application');
    expect(output).toContain('https://rp.example.com/callback');
    expect(output).toContain('https://rp.example.com/');
    expect(output).toContain('Demo application');
    expect(output).toContain('demo, web');
    expect(output).toContain('secret');
    expect(dependencies.log.warning).toHaveBeenCalledOnce();
  });

  it('renders safe fallbacks for an inactive unknown client', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const unknown = {
      ...client({
        active: false,
        require_pkce: false,
        scope: '',
        created_at: undefined,
        updated_at: undefined,
      }),
      application_type: 'unknown',
    } as unknown as OidcClient;

    displayClient(unknown, false);

    const output = consoleLog.mock.calls.flat().join('\n');
    expect(output).toContain('Not set');
    expect(output).toContain('Inactive');
    expect(output).toContain('N/A');
    expect(dependencies.log.warning).not.toHaveBeenCalled();
  });

  it('renders default and custom RFC 8628 device settings', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const baseDevice = client({
      application_type: 'native',
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
    });

    displayClient(baseDevice);
    displayClient({
      ...baseDevice,
      device_authorization_endpoint: '/custom/device',
      device_code_lifetime: 900,
      user_code_lifetime: 800,
      verification_uri_complete: true,
    });

    const output = consoleLog.mock.calls.flat().join('\n');
    expect(output).toContain('/oidc/v1/device/auth');
    expect(output).toContain('/custom/device');
    expect(output).toContain('600s');
    expect(output).toContain('900s');
    expect(output).toContain('Enabled');
    expect(output).toContain('Disabled');
  });

  it('shows a guided empty state when no clients are registered', async () => {
    dependencies.listClientsConfig.mockReturnValue({ clients: [] });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await listClients();

    expect(dependencies.createBox).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('No OIDC Clients')]),
      50
    );
    expect(consoleLog).toHaveBeenCalledWith('EMPTY BOX');
  });

  it('lists active and inactive clients with bounded table values', async () => {
    dependencies.listClientsConfig.mockReturnValue({
      clients: [
        client({
          client_id: 'a-very-long-client-identifier',
          client_name: 'A very long client name',
          preset: 'spa',
          active: true,
        }),
        client({
          client_id: 'short',
          client_name: undefined,
          active: false,
        }),
        client({
          client_id: 'unknown-type',
          client_name: 'Short name',
          application_type: 'unknown' as 'web',
          active: true,
        }),
      ],
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    await listClients();

    expect(dependencies.log.title).toHaveBeenCalledWith(
      'Registered Clients (3 total)'
    );
    expect(dependencies.createTable).toHaveBeenCalledTimes(2);
    const clientRows = dependencies.createTable.mock.calls[0]![1]!;
    expect(clientRows[0]?.join(' ')).toContain('...');
    expect(clientRows[1]?.join(' ')).toContain('Unnamed');
    expect(clientRows[2]?.join(' ')).toContain('Short name');
    expect(consoleLog).toHaveBeenCalledWith('TABLE');
  });

  it('propagates registry read failures to the CLI boundary', async () => {
    dependencies.listClientsConfig.mockImplementation(() => {
      throw new Error('registry unavailable');
    });

    await expect(listClients()).rejects.toThrow('registry unavailable');
  });
});

describe('OIDC client command and template contracts', () => {
  it('defines secure defaults for each supported client class', () => {
    expect(Object.keys(CLIENT_TYPES)).toEqual([
      'web',
      'spa',
      'native',
      'device',
      'm2m',
      'api_management',
    ]);
    expect(CLIENT_TYPES.spa.defaults).toMatchObject({
      token_endpoint_auth_method: 'none',
      require_pkce: true,
    });
    expect(CLIENT_TYPES.device.defaults.grant_types).toContain(
      'urn:ietf:params:oauth:grant-type:device_code'
    );
    expect(CLIENT_TYPES.api_management.defaults.allowedResources).toEqual([
      'urn:parako:api:v1',
    ]);
  });

  it('registers only the supported list and add commands', async () => {
    const program = new Command();
    setupCommands(program);
    program.exitOverride();

    expect(program.commands.map(command => command.name())).toEqual([
      'list',
      'add',
    ]);
    expect(program.commands[0]?.aliases()).toEqual(['ls']);
    expect(program.commands[1]?.aliases()).toEqual(['create', 'new']);

    await program.parseAsync(['node', 'client', 'new']);
    expect(dependencies.addClientInteractive).toHaveBeenCalledOnce();

    await program.parseAsync(['node', 'client', 'list']);
    expect(dependencies.listClientsConfig).toHaveBeenCalledOnce();
  });

  it('advertises only client commands and shortcuts that are actually registered', () => {
    const program = new Command();
    setupCommands(program);
    const registeredCommands = program.commands.map(command => command.name());
    const advertisedShortcuts = Object.values(COMMAND_SHORTCUTS)
      .filter(shortcut => shortcut.module === 'client')
      .map(shortcut => shortcut.command);

    expect(Object.keys(SUB_CLIS.client.commands)).toEqual(registeredCommands);
    expect(
      advertisedShortcuts.every(command => registeredCommands.includes(command))
    ).toBe(true);
  });
});
