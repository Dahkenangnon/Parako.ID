import { describe, expect, it } from 'vitest';
import {
  ClientTransformer,
  type StaticClient,
} from '../../../src/utils/client-transformer.js';
import type { OidcClientData } from '../../../src/oidc/adapter/client.interface.js';

describe('ClientTransformer', () => {
  it('normalizes a minimal static client with safe defaults and metadata', () => {
    const transformed = ClientTransformer.transformStaticClient({
      client_id: 'static-client',
      client_name: 'Static Client',
      application_type: 'web',
    });

    expect(transformed).toMatchObject({
      client_id: 'static-client',
      client_name: 'Static Client',
      application_type: 'web',
      source: 'static',
      isStatic: true,
      isEditable: false,
      active: true,
      require_pkce: false,
      tags: [],
      contacts: [],
      isInternalClient: false,
      created_at: null,
      updated_at: null,
      metadata: {
        client_id: 'static-client',
        client_name: 'Static Client',
        application_type: 'web',
      },
    });
  });

  it('isolates transformed static client collections from the source record', () => {
    const source: StaticClient = {
      client_id: 'static-client',
      client_name: 'Static Client',
      application_type: 'web',
      redirect_uris: ['https://rp.example/callback'],
      post_logout_redirect_uris: ['https://rp.example/logged-out'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      allowedResources: ['https://api.example'],
      contacts: ['admin@example.com'],
      tags: ['production'],
      active: false,
    };

    const transformed = ClientTransformer.transformStaticClient(source);

    transformed.redirect_uris?.push('https://attacker.example/callback');
    transformed.post_logout_redirect_uris?.push(
      'https://attacker.example/logged-out'
    );
    transformed.metadata.redirect_uris?.push(
      'https://metadata-attacker.example/callback'
    );
    transformed.grant_types?.push('implicit');
    transformed.response_types?.push('token');
    transformed.allowedResources?.push('https://attacker.example/api');
    transformed.contacts.push('attacker@example.com');
    transformed.tags.push('compromised');

    expect(source).toEqual({
      client_id: 'static-client',
      client_name: 'Static Client',
      application_type: 'web',
      redirect_uris: ['https://rp.example/callback'],
      post_logout_redirect_uris: ['https://rp.example/logged-out'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      allowedResources: ['https://api.example'],
      contacts: ['admin@example.com'],
      tags: ['production'],
      active: false,
    });
  });

  it('preserves space-delimited static resource scopes as a string', () => {
    const transformed = ClientTransformer.transformStaticClient({
      client_id: 'resource-client',
      client_name: 'Resource Client',
      application_type: 'web',
      resourcesScopes: 'api:read api:write',
    });

    expect(transformed.resourcesScopes).toBe('api:read api:write');
  });

  it('isolates transformed adapter client collections from the source record', () => {
    const source: OidcClientData = {
      client_id: 'adapter-client',
      client_name: 'Adapter Client',
      application_type: 'web',
      redirect_uris: ['https://rp.example/callback'],
      post_logout_redirect_uris: ['https://rp.example/logged-out'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      allowedResources: ['https://api.example'],
      contacts: ['admin@example.com'],
      tags: ['production'],
    };

    const transformed = ClientTransformer.transformAdapterClient(source);

    transformed.redirect_uris?.push('https://attacker.example/callback');
    transformed.post_logout_redirect_uris?.push(
      'https://attacker.example/logged-out'
    );
    transformed.metadata.redirect_uris?.push(
      'https://metadata-attacker.example/callback'
    );
    transformed.response_types?.push('token');
    transformed.grant_types?.push('implicit');
    transformed.allowedResources?.push('https://attacker.example/api');
    transformed.contacts.push('attacker@example.com');
    transformed.tags.push('compromised');

    expect(source).toEqual({
      client_id: 'adapter-client',
      client_name: 'Adapter Client',
      application_type: 'web',
      redirect_uris: ['https://rp.example/callback'],
      post_logout_redirect_uris: ['https://rp.example/logged-out'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      allowedResources: ['https://api.example'],
      contacts: ['admin@example.com'],
      tags: ['production'],
    });
  });

  it('normalizes adapter flags and exposes registered display metadata', () => {
    const transformed = ClientTransformer.transformAdapterClient({
      client_id: 'adapter-client',
      client_name: 'Adapter Client',
      application_type: 'native',
      client_uri: 'https://rp.example',
      logo_uri: 'https://rp.example/logo.png',
      policy_uri: 'https://rp.example/policy',
      tos_uri: 'https://rp.example/terms',
      active: false,
      require_pkce: true,
      isInternalClient: true,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T01:00:00.000Z',
    });

    expect(transformed).toMatchObject({
      source: 'adapter',
      isStatic: false,
      isEditable: true,
      active: false,
      require_pkce: true,
      isInternalClient: true,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T01:00:00.000Z',
      metadata: {
        client_id: 'adapter-client',
        client_name: 'Adapter Client',
        application_type: 'native',
        client_uri: 'https://rp.example',
        logo_uri: 'https://rp.example/logo.png',
        policy_uri: 'https://rp.example/policy',
        tos_uri: 'https://rp.example/terms',
      },
    });
  });

  it.each([
    ['static', true, false],
    ['adapter', false, true],
  ] as const)(
    'dispatches %s clients through the matching transformer',
    (source, isStatic, isEditable) => {
      const transformed = ClientTransformer.transformClient(
        {
          client_id: `${source}-client`,
          client_name: `${source} client`,
          application_type: 'web',
        },
        source
      );

      expect(transformed).toMatchObject({ source, isStatic, isEditable });
    }
  );

  it('fails closed for an unknown client source at runtime', () => {
    expect(() =>
      ClientTransformer.transformClient(
        {
          client_id: 'unknown-client',
          client_name: 'Unknown Client',
          application_type: 'web',
        },
        'database' as never
      )
    ).toThrow('Unknown client source: database');
  });

  it('transforms client arrays in their original order', () => {
    const transformed = ClientTransformer.transformClients(
      [
        {
          client_id: 'first',
          client_name: 'First',
          application_type: 'web',
        },
        {
          client_id: 'second',
          client_name: 'Second',
          application_type: 'native',
        },
      ],
      'static'
    );

    expect(
      transformed.map(client => [client.client_id, client.source])
    ).toEqual([
      ['first', 'static'],
      ['second', 'static'],
    ]);
  });

  it('summarizes client structure for logs without exposing secrets', () => {
    const client = ClientTransformer.transformAdapterClient({
      client_id: 'adapter-client',
      client_name: 'Adapter Client',
      application_type: 'web',
      client_secret: 'super-secret-value',
    });
    const withoutMetadata = { ...client, metadata: undefined } as never;

    const summaries = ClientTransformer.getClientsDebugInfo([
      client,
      withoutMetadata,
    ]);

    expect(summaries[0]).toMatchObject({
      client_id: 'adapter-client',
      client_name: 'Adapter Client',
      application_type: 'web',
      source: 'adapter',
      isEditable: true,
      hasMetadata: true,
    });
    expect(summaries[0].metadataKeys).toContain('client_id');
    expect(summaries[1]).toMatchObject({
      hasMetadata: false,
      metadataKeys: [],
    });
    expect(summaries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client_secret: 'super-secret-value' }),
      ])
    );
  });

  it('rejects whitespace-only required client fields', () => {
    const client = ClientTransformer.transformStaticClient({
      client_id: '   ',
      client_name: '\t',
      application_type: '\n',
    });

    expect(ClientTransformer.validateClient(client)).toEqual({
      isValid: false,
      errors: [
        'client_id is required',
        'client_name is required',
        'application_type is required',
      ],
    });
  });

  it('reports every missing structural client field', () => {
    expect(ClientTransformer.validateClient({} as never)).toEqual({
      isValid: false,
      errors: [
        'client_id is required',
        'client_name is required',
        'application_type is required',
        'metadata is required',
        'source is required',
      ],
    });
  });

  it('accepts a normalized client with every structural field present', () => {
    const client = ClientTransformer.transformStaticClient({
      client_id: 'valid-client',
      client_name: 'Valid Client',
      application_type: 'web',
    });

    expect(ClientTransformer.validateClient(client)).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it('counts client types without colliding with object prototype keys', () => {
    const client = ClientTransformer.transformStaticClient({
      client_id: 'untrusted-type-client',
      client_name: 'Untrusted Type Client',
      application_type: '__proto__',
    });

    const statistics = ClientTransformer.getClientStatistics([client]);

    expect(Object.getPrototypeOf(statistics.byType)).toBe(Object.prototype);
    expect(Object.hasOwn(statistics.byType, '__proto__')).toBe(true);
    expect(statistics.byType['__proto__']).toBe(1);
  });

  it('aggregates source, activity, and repeated application type counts', () => {
    const staticClient = ClientTransformer.transformStaticClient({
      client_id: 'static-client',
      client_name: 'Static Client',
      application_type: 'web',
    });
    const adapterClient = ClientTransformer.transformAdapterClient({
      client_id: 'adapter-client',
      client_name: 'Adapter Client',
      application_type: 'web',
      active: false,
    });

    expect(
      ClientTransformer.getClientStatistics([staticClient, adapterClient])
    ).toEqual({
      total: 2,
      static: 1,
      adapter: 1,
      active: 1,
      inactive: 1,
      byType: { web: 2 },
    });
  });
});
