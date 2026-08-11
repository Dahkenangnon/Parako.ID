import { expect, test, type Page } from '@playwright/test';

import { startParakoInstance } from './support/parako-instance.mjs';

const IDP_PORT = 19407;

type PreferenceResponse = {
  status: number;
  contentType: string;
  body: unknown;
};

async function postPreference(
  page: Page,
  path: string,
  body: Record<string, unknown>,
  includeCsrf = true
): Promise<PreferenceResponse> {
  return await page.evaluate(
    async ({ path, body, includeCsrf }) => {
      const stateElement =
        document.querySelector<HTMLScriptElement>('#___MAIN_STATE___');
      const state = JSON.parse(stateElement?.textContent ?? '{}') as {
        csrfToken?: string;
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (includeCsrf && state.csrfToken) {
        headers['X-CSRF-Token'] = state.csrfToken;
      }
      const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();
      let parsed: unknown = text;
      if (contentType.includes('application/json')) {
        parsed = JSON.parse(text);
      }
      return { status: response.status, contentType, body: parsed };
    },
    { path, body, includeCsrf }
  );
}

test('persists valid anonymous preferences and rejects unsafe mutations', async ({
  page,
}) => {
  const instance = await startParakoInstance({ port: IDP_PORT });

  try {
    await page.goto(`${instance.origin}/auth/login`);

    await expect(
      postPreference(page, '/auth/update-theme', { theme: 'dark' })
    ).resolves.toMatchObject({
      status: 200,
      body: { success: true, theme: 'dark' },
    });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');

    await expect(
      postPreference(page, '/auth/update-locale', { locale: 'fr' })
    ).resolves.toMatchObject({
      status: 200,
      body: { success: true, locale: 'fr' },
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    await expect(
      postPreference(page, '/auth/update-sidebar', { expanded: false })
    ).resolves.toMatchObject({
      status: 200,
      body: { success: true, expanded: false },
    });

    await expect(
      postPreference(page, '/auth/update-timezone', {
        timezone: 'Africa/Porto-Novo',
      })
    ).resolves.toMatchObject({
      status: 401,
      body: { success: false, error: 'Authentication required' },
    });

    for (const [path, body, error] of [
      ['/auth/update-theme', { theme: 'sepia' }, 'Invalid theme value'],
      ['/auth/update-locale', { locale: 'xx' }, 'Invalid locale value'],
      [
        '/auth/update-sidebar',
        { expanded: 'false' },
        'Invalid sidebar state value',
      ],
      [
        '/auth/update-timezone',
        { timezone: 'Invalid/Timezone' },
        'Invalid timezone identifier',
      ],
    ] as const) {
      await expect(postPreference(page, path, body)).resolves.toMatchObject({
        status: 400,
        body: { success: false, error },
      });
    }

    const csrfFailure = await postPreference(
      page,
      '/auth/update-theme',
      { theme: 'light' },
      false
    );
    expect(csrfFailure.status).toBe(403);
    expect(csrfFailure.contentType).toContain('text/html');
    expect(String(csrfFailure.body)).toContain('auth-card');
    expect(String(csrfFailure.body)).toMatch(/<h1[^>]*>403<\/h1>/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  } finally {
    await instance.stop();
  }
});
