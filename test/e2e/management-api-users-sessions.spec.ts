import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  apiRequest,
  issueManagementToken,
  readApiJson,
} from './support/management-api.js';

type ApiEnvelope<T> = { data: T };
type ApiList<T> = {
  data: T[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
    total_count?: number;
  };
};
type UserRecord = {
  id?: string;
  _id?: string;
  email: string;
  username?: string;
  name?: string;
  nickname?: string;
  account_enabled?: boolean;
  password?: string;
  hashedPassword?: string;
};
type SessionRecord = {
  id?: string;
  jti?: string;
  accountId?: string;
  clientId?: string;
};

const USER_SCOPES = [
  'parako:users:read',
  'parako:users:write',
  'parako:users:delete',
  'parako:sessions:read',
  'parako:sessions:revoke',
].join(' ');

function userId(user: UserRecord): string {
  const id = user.id ?? user._id;
  expect(id).toEqual(expect.any(String));
  return id!;
}

async function createManagedUser(
  token: string,
  prefix: string
): Promise<{ user: UserRecord; password: string }> {
  const suffix = randomUUID();
  // Keep credentials deterministic: UUID fragments can randomly contain
  // alphabetic or numeric sequences rejected by the configured password policy.
  const password = 'E2E-Strong!7';
  const response = await apiRequest('/users', {
    method: 'POST',
    token,
    body: JSON.stringify({
      email: `${prefix}-${suffix}@example.test`,
      password,
      username: `${prefix}-${suffix}`,
      given_name: 'Management',
      family_name: 'Test',
      name: 'Management Test',
    }),
  });
  expect(response.status).toBe(201);
  const { data } = await readApiJson<ApiEnvelope<UserRecord>>(response);
  expect(data).not.toHaveProperty('password');
  expect(data).not.toHaveProperty('hashedPassword');
  return { user: data, password };
}

test.describe('Management API users', () => {
  test('covers every user operation and redacts credentials', async () => {
    const token = await issueManagementToken(USER_SCOPES);
    const invalid = await apiRequest('/users', {
      method: 'POST',
      token,
      body: JSON.stringify({ email: 'not-an-email', password: 'short' }),
    });
    expect(invalid.status).toBe(422);

    const { user } = await createManagedUser(token, 'managed-user');
    const id = encodeURIComponent(userId(user));

    const list = await apiRequest('/users?include_count=true', { token });
    expect(list.status).toBe(200);
    const listed = await readApiJson<ApiList<UserRecord>>(list);
    expect(listed.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: user.email })])
    );

    const get = await apiRequest(`/users/${id}`, { token });
    expect(get.status).toBe(200);
    const fetched = await readApiJson<ApiEnvelope<UserRecord>>(get);
    expect(fetched.data).toMatchObject({ email: user.email });
    expect(fetched.data).not.toHaveProperty('password');

    const replace = await apiRequest(`/users/${id}`, {
      method: 'PUT',
      token,
      body: JSON.stringify({
        given_name: 'Replaced',
        family_name: 'Management User',
        nickname: 'replace',
        account_enabled: true,
      }),
    });
    expect(replace.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<UserRecord>>(replace)).data
    ).toMatchObject({
      name: 'Replaced Management User',
      nickname: 'replace',
    });

    const patch = await apiRequest(`/users/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ nickname: 'patched' }),
    });
    expect(patch.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<UserRecord>>(patch)).data
    ).toMatchObject({
      nickname: 'patched',
    });

    const lock = await apiRequest(`/users/${id}/lock`, {
      method: 'POST',
      token,
    });
    expect(lock.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<UserRecord>>(lock)).data
    ).toMatchObject({
      account_enabled: false,
    });

    const unlock = await apiRequest(`/users/${id}/lock`, {
      method: 'DELETE',
      token,
    });
    expect(unlock.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<UserRecord>>(unlock)).data
    ).toMatchObject({
      account_enabled: true,
    });

    const newPassword = 'Reset-E2E-Strong!8';
    const resetPassword = await apiRequest(`/users/${id}/password-reset`, {
      method: 'POST',
      token,
      body: JSON.stringify({ new_password: newPassword }),
    });
    expect(resetPassword.status).toBe(200);
    expect(
      await readApiJson<ApiEnvelope<{ message: string }>>(resetPassword)
    ).toEqual({
      data: { message: 'Password has been reset' },
    });

    const resetMfa = await apiRequest(`/users/${id}/mfa/reset`, {
      method: 'POST',
      token,
    });
    expect(resetMfa.status).toBe(200);
    expect(
      await readApiJson<ApiEnvelope<{ message: string }>>(resetMfa)
    ).toEqual({
      data: { message: 'MFA has been reset' },
    });

    const activities = await apiRequest(`/users/${id}/activities`, { token });
    expect(activities.status).toBe(200);
    expect((await readApiJson<ApiList<unknown>>(activities)).data).toEqual(
      expect.any(Array)
    );

    const sessions = await apiRequest(`/users/${id}/sessions`, { token });
    expect(sessions.status).toBe(200);
    expect((await readApiJson<ApiEnvelope<unknown[]>>(sessions)).data).toEqual(
      expect.any(Array)
    );

    const destroy = await apiRequest(`/users/${id}`, {
      method: 'DELETE',
      token,
    });
    expect(destroy.status).toBe(204);

    const missing = await apiRequest('/users/missing-user-e2e', { token });
    expect(missing.status).toBe(404);
  });
});

test.describe('Management API sessions', () => {
  test('lists, retrieves, revokes, and bulk-revokes real OIDC sessions', async ({
    browser,
    page,
  }) => {
    const token = await issueManagementToken(USER_SCOPES);
    const { user, password } = await createManagedUser(token, 'session-user');
    const id = userId(user);

    await page.goto('http://127.0.0.1:19010/login?prompt=consent');
    await page.locator('#login').fill(user.email);
    await page.locator('#password').fill(password);
    await page
      .locator('#login-form')
      .getByRole('button', { name: /sign in/i })
      .click();
    const consent = page.locator('#consent-submit-btn');
    await expect(consent).toBeVisible();
    await consent.click();
    await expect(page.getByTestId('rp-authenticated')).toBeVisible();

    // A second browser context creates another independent OP session for the
    // same account, allowing pagination and bulk revocation to be exercised
    // against real persisted OIDC state.
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto('http://127.0.0.1:19010/login?prompt=consent');
    await secondPage.locator('#login').fill(user.email);
    await secondPage.locator('#password').fill(password);
    await secondPage
      .locator('#login-form')
      .getByRole('button', { name: /sign in/i })
      .click();
    const secondConsent = secondPage.locator('#consent-submit-btn');
    await expect(secondConsent).toBeVisible();
    await secondConsent.click();
    await expect(secondPage.getByTestId('rp-authenticated')).toBeVisible();

    const userSessions = await apiRequest(
      `/users/${encodeURIComponent(id)}/sessions`,
      { token }
    );
    expect(userSessions.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<SessionRecord[]>>(userSessions)).data
        .length
    ).toBeGreaterThan(0);

    const list = await apiRequest(
      `/sessions?username=${encodeURIComponent(user.username!)}&limit=1&include_count=true`,
      { token }
    );
    expect(list.status).toBe(200);
    const listed = await readApiJson<ApiList<SessionRecord>>(list);
    expect(listed.data).toHaveLength(1);
    expect(listed.pagination).toMatchObject({
      has_more: true,
      next_cursor: expect.any(String),
      total_count: expect.any(Number),
    });
    expect(listed.pagination.total_count).toBeGreaterThanOrEqual(2);
    const session = listed.data[0]!;
    const jti = session.jti ?? session.id;
    expect(jti).toEqual(expect.any(String));

    const nextPage = await apiRequest(
      `/sessions?username=${encodeURIComponent(user.username!)}&limit=1&after=${encodeURIComponent(listed.pagination.next_cursor!)}`,
      { token }
    );
    expect(nextPage.status).toBe(200);
    const nextListed = await readApiJson<ApiList<SessionRecord>>(nextPage);
    expect(nextListed.data).toHaveLength(1);
    expect(nextListed.data[0]?.jti ?? nextListed.data[0]?.id).not.toBe(jti);

    const get = await apiRequest(`/sessions/${encodeURIComponent(jti!)}`, {
      token,
    });
    expect(get.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<SessionRecord>>(get)).data
    ).toMatchObject({
      accountId: user.username,
    });

    const revoke = await apiRequest(`/sessions/${encodeURIComponent(jti!)}`, {
      method: 'DELETE',
      token,
    });
    expect(revoke.status).toBe(204);

    const revoked = await apiRequest(`/sessions/${encodeURIComponent(jti!)}`, {
      token,
    });
    expect(revoked.status).toBe(404);

    const unscopedBulk = await apiRequest('/sessions', {
      method: 'DELETE',
      token,
    });
    expect(unscopedBulk.status).toBe(422);

    const bulk = await apiRequest(
      `/sessions?username=${encodeURIComponent(user.username!)}`,
      { method: 'DELETE', token }
    );
    expect(bulk.status).toBe(200);
    expect(
      (await readApiJson<ApiEnvelope<{ revoked_count: number }>>(bulk)).data
        .revoked_count
    ).toBeGreaterThan(0);

    const empty = await apiRequest(
      `/sessions?username=${encodeURIComponent(user.username!)}`,
      { token }
    );
    expect(empty.status).toBe(200);
    expect((await readApiJson<ApiList<SessionRecord>>(empty)).data).toEqual([]);

    await secondContext.close();
  });
});
