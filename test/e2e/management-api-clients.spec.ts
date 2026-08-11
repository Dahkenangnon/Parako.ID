import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { apiRequest, issueManagementToken } from './support/management-api.js';
const RESOURCE = 'urn:parako:api:v1';
const CLIENT_SCOPES = [
  'parako:clients:read',
  'parako:clients:write',
  'parako:clients:delete',
].join(' ');

async function json(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

test.describe('Management API client lifecycle', () => {
  test('enforces authentication and client scopes', async () => {
    const unauthenticated = await apiRequest('/clients');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('content-type')).toContain(
      'application/problem+json'
    );

    const statsToken = await issueManagementToken('parako:stats:read');
    const forbidden = await apiRequest('/clients', { token: statsToken });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('content-type')).toContain(
      'application/problem+json'
    );
    expect(await json(forbidden)).toMatchObject({
      status: 403,
      required_scopes: ['parako:clients:read'],
    });
  });

  test('covers all client operations and never re-exposes stored secrets', async () => {
    const token = await issueManagementToken(CLIENT_SCOPES);
    const invalid = await apiRequest('/clients', {
      method: 'POST',
      token,
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get('content-type')).toContain(
      'application/problem+json'
    );

    const clientName = `Management API E2E ${randomUUID()}`;
    const create = await apiRequest('/clients', {
      method: 'POST',
      token,
      body: JSON.stringify({
        client_name: clientName,
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['client_credentials'],
        response_types: [],
        allowedResources: [RESOURCE],
        resourcesScopes: 'parako:stats:read',
      }),
    });
    expect(create.status).toBe(201);
    const created = (await json(create)).data;
    expect(created).toMatchObject({
      client_name: clientName,
      active: true,
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(created.client_id).toEqual(expect.any(String));
    expect(created.client_secret).toEqual(expect.any(String));

    const clientId = encodeURIComponent(created.client_id);
    const list = await apiRequest('/clients?include_count=true', { token });
    expect(list.status).toBe(200);
    const listed = await json(list);
    expect(listed.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client_id: created.client_id,
          client_name: clientName,
        }),
      ])
    );
    expect(
      listed.data.find(
        (candidate: Record<string, unknown>) =>
          candidate.client_id === created.client_id
      )
    ).not.toHaveProperty('client_secret');

    const get = await apiRequest(`/clients/${clientId}`, { token });
    expect(get.status).toBe(200);
    const fetched = (await json(get)).data;
    expect(fetched).toMatchObject({
      client_id: created.client_id,
      client_name: clientName,
    });
    expect(fetched).not.toHaveProperty('client_secret');

    const replacementName = `${clientName} replaced`;
    const replace = await apiRequest(`/clients/${clientId}`, {
      method: 'PUT',
      token,
      body: JSON.stringify({
        client_name: replacementName,
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['client_credentials'],
        response_types: [],
        allowedResources: [RESOURCE],
        resourcesScopes: 'parako:stats:read',
      }),
    });
    expect(replace.status).toBe(200);
    expect((await json(replace)).data).toMatchObject({
      client_id: created.client_id,
      client_name: replacementName,
    });

    const patchedName = `${clientName} patched`;
    const patch = await apiRequest(`/clients/${clientId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ client_name: patchedName }),
    });
    expect(patch.status).toBe(200);
    expect((await json(patch)).data).toMatchObject({
      client_id: created.client_id,
      client_name: patchedName,
    });

    const deactivate = await apiRequest(`/clients/${clientId}/deactivate`, {
      method: 'POST',
      token,
    });
    expect(deactivate.status).toBe(200);
    expect((await json(deactivate)).data).toMatchObject({ active: false });

    const activate = await apiRequest(`/clients/${clientId}/activate`, {
      method: 'POST',
      token,
    });
    expect(activate.status).toBe(200);
    expect((await json(activate)).data).toMatchObject({ active: true });

    const rotate = await apiRequest(`/clients/${clientId}/secret`, {
      method: 'POST',
      token,
    });
    expect(rotate.status).toBe(200);
    const rotated = (await json(rotate)).data;
    expect(rotated.client_secret).toEqual(expect.any(String));
    expect(rotated.client_secret).not.toBe(created.client_secret);

    const stats = await apiRequest(`/clients/${clientId}/stats`, { token });
    expect(stats.status).toBe(200);
    expect((await json(stats)).data).toEqual(expect.any(Object));

    const remove = await apiRequest(`/clients/${clientId}`, {
      method: 'DELETE',
      token,
    });
    expect(remove.status).toBe(204);
    expect(await remove.text()).toBe('');

    const missing = await apiRequest(`/clients/${clientId}`, { token });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain(
      'application/problem+json'
    );
  });
});
