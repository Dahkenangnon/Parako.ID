import {
  createLoopbackTenantFetch,
  type E2eFetch,
} from './loopback-tenant-fetch.js';

export const MANAGEMENT_API_RESOURCE = 'urn:parako:api:v1';

interface MachineClientOptions {
  clientId: string;
  clientSecret: string;
  scopes: string;
  oidcScopes?: string;
  resources?: string[];
  ttl?: Record<string, number>;
}

interface ManagementTokenOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  resource?: string;
  scope: string;
  fetchImplementation?: E2eFetch;
}

export function machineClient({
  clientId,
  clientSecret,
  scopes,
  oidcScopes = '',
  resources = [MANAGEMENT_API_RESOURCE],
  ttl,
}: MachineClientOptions) {
  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: `${clientId} client`,
    application_type: 'web',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['client_credentials'],
    response_types: [],
    scope: oidcScopes,
    allowedResources: resources,
    resourcesScopes: scopes,
    ...(ttl ? { ttl } : {}),
  };
}

export async function issueManagementToken({
  issuer,
  clientId,
  clientSecret,
  resource = MANAGEMENT_API_RESOURCE,
  scope,
  fetchImplementation,
}: ManagementTokenOptions): Promise<string> {
  const tokenEndpoint = `${issuer.replace(/\/$/, '')}/token`;
  const request =
    fetchImplementation ??
    createLoopbackTenantFetch(new URL(tokenEndpoint).origin);
  const response = await request(tokenEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(
        `${clientId}:${clientSecret}`
      ).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource,
      scope,
    }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      error?: unknown;
      error_description?: unknown;
    };
    const oauthError =
      typeof errorBody.error === 'string' ? errorBody.error : undefined;
    const oauthDescription =
      typeof errorBody.error_description === 'string'
        ? errorBody.error_description
        : undefined;
    const safeDetail = oauthError
      ? ` (${oauthError}${oauthDescription ? `: ${oauthDescription}` : ''})`
      : '';
    throw new Error(
      `Management API token request failed with status ${response.status}${safeDetail}`
    );
  }

  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('Management API token response did not include a token');
  }

  return body.access_token;
}

export async function apiRequest(
  apiOrigin: string,
  path: string,
  options: RequestInit & {
    token?: string;
    fetchImplementation?: E2eFetch;
  } = {}
): Promise<Response> {
  const { token, fetchImplementation, headers, ...request } = options;
  const requestHeaders = new Headers(headers);
  if (request.body && !requestHeaders.has('content-type')) {
    requestHeaders.set('content-type', 'application/json');
  }
  if (token) {
    requestHeaders.set('authorization', `Bearer ${token}`);
  }

  const fetchRequest =
    fetchImplementation ?? createLoopbackTenantFetch(apiOrigin);

  return fetchRequest(
    `${apiOrigin.replace(/\/$/, '')}/api/v1${path.startsWith('/') ? path : `/${path}`}`,
    {
      ...request,
      headers: Object.fromEntries(requestHeaders.entries()),
    }
  );
}
