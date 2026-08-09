import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  addClient: vi.fn(),
  assertInteractiveTty: vi.fn(),
  displayClient: vi.fn(),
  findClientById: vi.fn(),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    subtitle: vi.fn(),
    success: vi.fn(),
    title: vi.fn(),
    warning: vi.fn(),
  },
  prompt: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: { prompt: dependencies.prompt },
}));
vi.mock('../../../scripts/manage/client/local-client-manager.js', () => ({
  addClient: dependencies.addClient,
  findClientById: dependencies.findClientById,
}));
vi.mock('../../../scripts/manage/client/display.js', () => ({
  displayClient: dependencies.displayClient,
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  assertInteractiveTty: dependencies.assertInteractiveTty,
  log: dependencies.log,
}));

import { addClientInteractive } from '../../../scripts/manage/client/add.js';
import type { OidcClient } from '../../../scripts/manage/client/local-types.js';

type Question = {
  name: string;
  validate?: (input: never) => boolean | string | Promise<boolean | string>;
};

function question(questions: Question[], name: string): Question {
  const value = questions.find(candidate => candidate.name === name);
  if (!value) throw new Error(`Missing question: ${name}`);
  return value;
}

function createdClient(overrides: Partial<OidcClient> = {}): OidcClient {
  return {
    client_id: 'generated-client',
    application_type: 'web',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: [],
    post_logout_redirect_uris: [],
    scope: 'openid profile email',
    active: true,
    ...overrides,
  };
}

describe('interactive OIDC client creation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    dependencies.addClient.mockReturnValue(createdClient());
    dependencies.findClientById.mockReturnValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('creates a confidential web client with validated login and logout redirects', async () => {
    dependencies.findClientById.mockImplementation((id: string) =>
      id === 'duplicate' ? createdClient({ client_id: id }) : null
    );
    dependencies.addClient.mockReturnValue(
      createdClient({ client_id: 'web-rp', client_secret: 'secret' })
    );

    dependencies.prompt
      .mockResolvedValueOnce({ clientType: 'web' })
      .mockImplementationOnce(async (questions: Question[]) => {
        const id = question(questions, 'client_id').validate!;
        const name = question(questions, 'client_name').validate!;
        expect(await id('' as never)).toBe(true);
        expect(await id('duplicate' as never)).toContain('already exists');
        expect(await id('web-rp' as never)).toBe(true);
        expect(name('   ' as never)).toBe('Client name is required');
        expect(name('Demo RP' as never)).toBe(true);
        return {
          client_id: 'web-rp',
          client_name: '  Demo RP  ',
          description: '  Demonstration client  ',
        };
      })
      .mockResolvedValueOnce({ needsRedirectUris: true })
      .mockImplementationOnce(async (questions: Question[]) => {
        const validate = question(questions, 'uri').validate!;
        expect(validate('' as never)).toBe(true);
        expect(validate('not a URL' as never)).toBe('Please enter a valid URL');
        expect(validate('javascript:alert(1)' as never)).toBe(
          'Please enter a valid URL'
        );
        expect(
          validate('https://user:secret@rp.example.com/callback' as never)
        ).toBe('Please enter a valid URL');
        expect(validate('https://*.example.com/callback' as never)).toBe(
          'Please enter a valid URL'
        );
        expect(
          validate('https://rp.example.com/callback#fragment' as never)
        ).toBe('Please enter a valid URL');
        expect(validate('  https://rp.example.com/callback  ' as never)).toBe(
          true
        );
        return { uri: '  https://rp.example.com/callback  ' };
      })
      .mockResolvedValueOnce({ uri: '' })
      .mockResolvedValueOnce({ needsLogoutUris: true })
      .mockImplementationOnce(async (questions: Question[]) => {
        const validate = question(questions, 'uri').validate!;
        expect(validate('' as never)).toBe(true);
        expect(validate('bad' as never)).toBe('Please enter a valid URL');
        expect(validate('  https://rp.example.com/  ' as never)).toBe(true);
        return { uri: '  https://rp.example.com/  ' };
      })
      .mockResolvedValueOnce({ uri: '' })
      .mockImplementationOnce(async (questions: Question[]) => {
        const clientUri = question(questions, 'client_uri').validate!;
        const logoUri = question(questions, 'logo_uri').validate!;
        expect(clientUri('' as never)).toBe(true);
        expect(clientUri('bad' as never)).toBe('Please enter a valid URL');
        expect(clientUri('javascript:alert(1)' as never)).toBe(
          'Please enter a valid URL'
        );
        expect(clientUri('https://user:secret@rp.example.com' as never)).toBe(
          'Please enter a valid URL'
        );
        expect(clientUri('https://rp.example.com' as never)).toBe(true);
        expect(logoUri('' as never)).toBe(true);
        expect(logoUri('bad' as never)).toBe('Please enter a valid URL');
        expect(logoUri('data:image/svg+xml,unsafe' as never)).toBe(
          'Please enter a valid URL'
        );
        expect(logoUri('https://rp.example.com/logo.svg' as never)).toBe(true);
        return {
          additionalScopes: 'email\tcustom\nemail',
          client_uri: '  https://rp.example.com  ',
          logo_uri: '  https://rp.example.com/logo.svg  ',
          tags: ' demo, web, ',
        };
      })
      .mockResolvedValueOnce({ confirmed: true });

    await addClientInteractive();

    expect(dependencies.addClient).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'web-rp',
        client_name: 'Demo RP',
        description: 'Demonstration client',
        redirect_uris: ['https://rp.example.com/callback'],
        post_logout_redirect_uris: ['https://rp.example.com/'],
        scope: 'openid profile email custom',
        client_uri: 'https://rp.example.com',
        logo_uri: 'https://rp.example.com/logo.svg',
        tags: ['demo', 'web'],
      })
    );
    expect(dependencies.displayClient).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'web-rp' }),
      true
    );
    expect(dependencies.log.warning).toHaveBeenCalledOnce();
  });

  it('validates RFC 8628 settings and cancels a device client safely', async () => {
    dependencies.prompt
      .mockResolvedValueOnce({ clientType: 'device' })
      .mockResolvedValueOnce({
        client_id: '',
        client_name: 'Television',
        description: '',
      })
      .mockResolvedValueOnce({
        additionalScopes: '',
        client_uri: '',
        logo_uri: '',
        tags: '',
      })
      .mockImplementationOnce(async (questions: Question[]) => {
        for (const name of ['device_code_lifetime', 'user_code_lifetime']) {
          const validate = question(questions, name).validate!;
          expect(validate(59 as never)).toContain('at least 60');
          expect(validate(3601 as never)).toContain('not exceed 3600');
          expect(validate(600 as never)).toBe(true);
        }
        return {
          device_authorization_endpoint: '/custom/device',
          device_code_lifetime: 900,
          user_code_lifetime: 800,
          verification_uri_complete: false,
        };
      })
      .mockResolvedValueOnce({ confirmed: false });

    await addClientInteractive();

    expect(dependencies.log.info).toHaveBeenCalledWith(
      expect.stringContaining('RFC 8628')
    );
    expect(dependencies.log.info).toHaveBeenCalledWith('Operation cancelled.');
    expect(dependencies.addClient).not.toHaveBeenCalled();
  });

  it('creates a machine client without browser redirects or a generated secret warning', async () => {
    dependencies.addClient.mockReturnValue(
      createdClient({
        client_id: 'service',
        grant_types: ['client_credentials'],
        scope: '',
      })
    );
    dependencies.prompt
      .mockResolvedValueOnce({ clientType: 'm2m' })
      .mockResolvedValueOnce({
        client_id: 'service',
        client_name: 'Service',
        description: undefined,
      })
      .mockResolvedValueOnce({
        additionalScopes: '',
        client_uri: '',
        logo_uri: '',
        tags: '',
      })
      .mockResolvedValueOnce({ confirmed: true });

    await addClientInteractive();

    expect(dependencies.prompt).toHaveBeenCalledTimes(4);
    expect(dependencies.addClient).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: 'm2m',
        redirect_uris: [],
        scope: '',
        client_uri: undefined,
        logo_uri: undefined,
        tags: undefined,
      })
    );
    expect(dependencies.displayClient).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'service' }),
      true
    );
    expect(dependencies.log.warning).not.toHaveBeenCalled();
  });

  it('allows a browser client to skip redirect URI collection', async () => {
    dependencies.prompt
      .mockResolvedValueOnce({ clientType: 'spa' })
      .mockResolvedValueOnce({
        client_id: 'spa',
        client_name: 'SPA',
        description: undefined,
      })
      .mockResolvedValueOnce({ needsRedirectUris: false })
      .mockResolvedValueOnce({
        additionalScopes: 'custom',
        client_uri: '',
        logo_uri: '',
        tags: '',
      })
      .mockResolvedValueOnce({ confirmed: true });

    await addClientInteractive();

    expect(dependencies.addClient).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: 'spa',
        scope: 'openid profile email custom',
      })
    );
  });

  it.each([
    {
      name: 'an empty redirect list',
      redirectAnswers: [{ uri: '' }],
    },
    {
      name: 'post-logout URI collection',
      redirectAnswers: [
        { uri: 'https://native.example.com/callback' },
        { uri: '' },
        { needsLogoutUris: false },
      ],
    },
  ])('supports $name', async ({ redirectAnswers }) => {
    dependencies.prompt
      .mockResolvedValueOnce({ clientType: 'native' })
      .mockResolvedValueOnce({
        client_id: 'native',
        client_name: 'Native',
        description: undefined,
      })
      .mockResolvedValueOnce({ needsRedirectUris: true });
    for (const answer of redirectAnswers) {
      dependencies.prompt.mockResolvedValueOnce(answer);
    }
    dependencies.prompt
      .mockResolvedValueOnce({
        additionalScopes: '',
        client_uri: '',
        logo_uri: '',
        tags: '',
      })
      .mockResolvedValueOnce({ confirmed: true });

    await addClientInteractive();

    expect(dependencies.addClient).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'native' })
    );
  });

  it.each([new Error('TTY required'), 'TTY required'])(
    'reports non-interactive invocation failures instead of hanging',
    async failure => {
      dependencies.assertInteractiveTty.mockImplementation(() => {
        throw failure;
      });

      await expect(addClientInteractive()).resolves.toBeUndefined();

      expect(dependencies.prompt).not.toHaveBeenCalled();
      expect(dependencies.log.error).toHaveBeenCalledWith(
        'Failed to add client: TTY required'
      );
    }
  );
});
