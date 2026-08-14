import { randomUUID } from 'node:crypto';

import { expect } from '@playwright/test';
import {
  allowInsecureRequests,
  ClientSecretBasic,
  clientCredentialsGrant,
  customFetch,
  discovery,
  type CustomFetch,
} from 'openid-client';

import { createLoopbackTenantFetch } from './loopback-tenant-fetch.js';

export const IDP_ORIGIN =
  process.env.PARAKO_E2E_IDP_ORIGIN ?? 'http://127.0.0.1:19007';
export const API_ORIGIN = `${IDP_ORIGIN}/api/v1`;
export const MANAGEMENT_API_RESOURCE = 'urn:parako:api:v1';

const CLIENT_ID = 'parako-browser-e2e-m2m';
// gitleaks:allow -- deterministic credential for an isolated local E2E client.
const CLIENT_SECRET = 'parako-browser-e2e-m2m-secret';
const nodeFetch = createLoopbackTenantFetch(IDP_ORIGIN);

export type ClientCredentialsFixture = {
  clientId: string;
  clientSecret: string;
  resource: string;
  scope: string;
};

async function issueClientCredentialsTokenAtOrigin(
  origin: string,
  fixture: ClientCredentialsFixture,
  oidcFetch: CustomFetch
): Promise<string> {
  const { clientId, clientSecret, resource, scope } = fixture;
  const configuration = await discovery(
    new URL(`${origin}/oidc/v1`),
    clientId,
    { client_secret: clientSecret },
    ClientSecretBasic(clientSecret),
    {
      execute: [allowInsecureRequests],
      [customFetch]: oidcFetch,
    }
  );
  allowInsecureRequests(configuration);

  const tokens = await clientCredentialsGrant(configuration, {
    resource,
    scope,
  });
  expect(tokens.access_token).toBeTruthy();
  return tokens.access_token!;
}

export async function issueClientCredentialsToken({
  clientId,
  clientSecret,
  resource,
  scope,
}: ClientCredentialsFixture): Promise<string> {
  return issueClientCredentialsTokenAtOrigin(
    IDP_ORIGIN,
    { clientId, clientSecret, resource, scope },
    nodeFetch as CustomFetch
  );
}

export async function issueManagementToken(scope: string): Promise<string> {
  return issueClientCredentialsToken({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    resource: MANAGEMENT_API_RESOURCE,
    scope,
  });
}

export async function apiRequest(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<Response> {
  const { token, headers, ...request } = options;
  return nodeFetch(`${API_ORIGIN}${path}`, {
    ...request,
    headers: {
      ...(request.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
}

export async function readApiJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export type ManagedUserFixture = {
  id: string;
  email: string;
  username: string;
  password: string;
};

type ManagedUserOptions = {
  accountEnabled?: boolean;
  origin?: string;
  role?: string;
};

/**
 * Provision a user through the public Management API. Browser suites
 * use this instead of reaching into a storage adapter, so account scenarios
 * exercise the same supported setup path across deployment cells.
 */
export async function createManagedUser(
  prefix = 'browser-user',
  options: ManagedUserOptions = {}
): Promise<ManagedUserFixture> {
  const origin = options.origin ?? IDP_ORIGIN;
  const tenantFetch =
    origin === IDP_ORIGIN ? nodeFetch : createLoopbackTenantFetch(origin);
  const suffix = randomUUID();
  // Keep generated fixtures within the public 50-character username contract.
  // Emails retain the full scenario prefix so captured notifications remain
  // easy to attribute when several browser journeys share one environment.
  const username = `${prefix.slice(0, 17)}-${suffix.replaceAll('-', '')}`;
  const password = 'E2E-Strong!7';
  try {
    const token = await issueClientCredentialsTokenAtOrigin(
      origin,
      {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        resource: MANAGEMENT_API_RESOURCE,
        scope: 'parako:users:write',
      },
      tenantFetch as CustomFetch
    );
    const response = await tenantFetch(`${origin}/api/v1/users`, {
      method: 'POST',
      body: JSON.stringify({
        email: `${prefix}-${suffix}@example.test`,
        password,
        username,
        given_name: 'Browser',
        family_name: 'User',
        name: 'Browser User',
        ...(options.role ? { role: options.role } : {}),
        ...(options.accountEnabled === undefined
          ? {}
          : { account_enabled: options.accountEnabled }),
      }),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    expect(response.status).toBe(201);
    const envelope = await readApiJson<{
      data: { id?: string; _id?: string; email: string; username: string };
    }>(response);
    const id = envelope.data.id ?? envelope.data._id;
    expect(id).toEqual(expect.any(String));

    return {
      id: id!,
      email: envelope.data.email,
      username: envelope.data.username,
      password,
    };
  } finally {
    if (tenantFetch !== nodeFetch) await tenantFetch.close?.();
  }
}
