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

const ISSUER = new URL(`${IDP_ORIGIN}/oidc/v1`);
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

export async function issueClientCredentialsToken({
  clientId,
  clientSecret,
  resource,
  scope,
}: ClientCredentialsFixture): Promise<string> {
  const configuration = await discovery(
    ISSUER,
    clientId,
    { client_secret: clientSecret },
    ClientSecretBasic(clientSecret),
    {
      execute: [allowInsecureRequests],
      [customFetch]: nodeFetch as CustomFetch,
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

/**
 * Provision a normal user through the public Management API. Browser suites
 * use this instead of reaching into a storage adapter, so account scenarios
 * exercise the same supported setup path across deployment cells.
 */
export async function createManagedUser(
  prefix = 'browser-user'
): Promise<ManagedUserFixture> {
  const token = await issueManagementToken('parako:users:write');
  const suffix = randomUUID();
  // Keep generated fixtures within the public 50-character username contract.
  // Emails retain the full scenario prefix so captured notifications remain
  // easy to attribute when several browser journeys share one environment.
  const username = `${prefix.slice(0, 17)}-${suffix.replaceAll('-', '')}`;
  const password = 'E2E-Strong!7';
  const response = await apiRequest('/users', {
    method: 'POST',
    token,
    body: JSON.stringify({
      email: `${prefix}-${suffix}@example.test`,
      password,
      username,
      given_name: 'Browser',
      family_name: 'User',
      name: 'Browser User',
    }),
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
}
