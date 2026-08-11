import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  createManagedUser,
  IDP_ORIGIN,
  type ManagedUserFixture,
} from './support/management-api.js';

function observeBrowserFailures(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedAssets: string[] = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on('response', response => {
    if (
      response.status() >= 400 &&
      ['stylesheet', 'script', 'image', 'font'].includes(
        response.request().resourceType()
      )
    ) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  return { pageErrors, consoleErrors, failedRequests, failedAssets };
}

async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    }
  );
  return { cdp, authenticatorId };
}

async function login(page: Page, user: ManagedUserFixture) {
  await page.goto(`${IDP_ORIGIN}/auth/login`);
  await page.locator('#login').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('#login-form button[type="submit"]').click();
}

async function logout(page: Page) {
  await page.goto(`${IDP_ORIGIN}/auth/logout`);
  await page.locator('form[action="/auth/logout"]').getByRole('button').click();
  await page.locator('a[href="/auth/login"]').first().click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/login`);
}

async function registerPasskey(page: Page, name: string) {
  await page.goto(`${IDP_ORIGIN}/accounts/setup-webauthn`);
  await expect(page.locator('#webauthn-register-btn')).toBeEnabled();
  await page.locator('#webauthn-register-btn').click();
  await expect(page.locator('#friendly-name-section')).toBeVisible();
  await page.locator('#friendly_name').fill(name);
  await page.locator('#webauthn-save-btn').click();
  await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/passkeys`);
}

type AssertionMutation = 'origin' | 'challenge' | 'signature';

async function submitTamperedAssertion(
  page: Page,
  mutation: AssertionMutation
) {
  return page.evaluate(async selectedMutation => {
    const stateElement = document.getElementById('___WEBAUTHN_AUTH_STATE___');
    if (!stateElement?.textContent) throw new Error('WebAuthn state missing');
    const state = JSON.parse(stateElement.textContent) as {
      config: {
        csrfToken: string;
        optionsUrl: string;
        verifyUrl: string;
      };
    };
    const headers = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': state.config.csrfToken,
    };
    const optionsResponse = await fetch(state.config.optionsUrl, {
      method: 'POST',
      headers,
      credentials: 'include',
    });
    if (!optionsResponse.ok) {
      throw new Error(`WebAuthn options failed: ${optionsResponse.status}`);
    }
    const { options } = (await optionsResponse.json()) as {
      options: PublicKeyCredentialRequestOptionsJSON;
    };
    const decode = (value: string) => {
      const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
      return Uint8Array.from(bytes, character => character.charCodeAt(0));
    };
    const encode = (value: ArrayBuffer | Uint8Array) => {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join(
        ''
      );
      return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    };
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: decode(options.challenge),
        timeout: options.timeout,
        rpId: options.rpId,
        allowCredentials: options.allowCredentials?.map(item => ({
          id: decode(item.id),
          type: 'public-key' as const,
          transports: item.transports as AuthenticatorTransport[] | undefined,
        })),
        userVerification: options.userVerification as
          UserVerificationRequirement | undefined,
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error('Virtual authenticator returned no data');
    const assertion = credential.response as AuthenticatorAssertionResponse;
    const credentialJson = {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: encode(assertion.clientDataJSON),
        authenticatorData: encode(assertion.authenticatorData),
        signature: encode(assertion.signature),
        userHandle: assertion.userHandle ? encode(assertion.userHandle) : null,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };

    if (selectedMutation === 'signature') {
      const signature = decode(credentialJson.response.signature);
      signature[0] = signature[0]! ^ 0xff;
      credentialJson.response.signature = encode(signature);
    } else {
      const clientData = JSON.parse(
        new TextDecoder().decode(assertion.clientDataJSON)
      ) as { challenge: string; origin: string };
      if (selectedMutation === 'origin') {
        clientData.origin = 'https://attacker.example.test';
      } else {
        clientData.challenge = encode(
          new TextEncoder().encode('different-challenge')
        );
      }
      credentialJson.response.clientDataJSON = encode(
        new TextEncoder().encode(JSON.stringify(clientData))
      );
    }

    const verificationResponse = await fetch(state.config.verifyUrl, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ credential: credentialJson }),
    });
    return {
      body: (await verificationResponse.json()) as unknown,
      status: verificationResponse.status,
    };
  }, mutation);
}

test.describe('WebAuthn-enabled public profile', () => {
  test('registers, renames, authenticates with, and deletes a passkey', async ({
    context,
    page,
  }) => {
    const user = await createManagedUser('webauthn');
    const failures = observeBrowserFailures(page);
    const { cdp, authenticatorId } = await addVirtualAuthenticator(
      context,
      page
    );

    try {
      await login(page, user);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

      await registerPasskey(page, 'Browser passkey');

      const passkey = page.locator('.passkey-item');
      await expect(passkey).toHaveCount(1);
      await expect(passkey.locator('.passkey-name')).toHaveText(
        'Browser passkey'
      );

      await passkey.locator('.passkey-rename-btn').click();
      await page.locator('#new-passkey-name').fill('Renamed browser passkey');
      await page.locator('#rename-confirm-btn').click();
      await expect(passkey.locator('.passkey-name')).toHaveText(
        'Renamed browser passkey'
      );
      await page.reload();
      await expect(page.locator('.passkey-name')).toHaveText(
        'Renamed browser passkey'
      );

      await logout(page);
      await login(page, user);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-webauthn`);
      await page.locator('#webauthn-auth-btn').click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);

      await page.goto(`${IDP_ORIGIN}/accounts/passkeys`);
      await expect(page.locator('.passkey-last-used')).not.toHaveText(
        /never used/i
      );
      page.once('dialog', dialog => dialog.accept());
      await page.locator('.passkey-delete-btn').click();
      await expect(page.locator('#passkeys-empty')).toBeVisible();

      await logout(page);
      await login(page, user);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
      expect(failures).toEqual({
        pageErrors: [],
        consoleErrors: [],
        failedRequests: [],
        failedAssets: [],
      });
    } finally {
      // Playwright may close the page and CDP session first when a test times
      // out. Best-effort teardown must not replace the primary failure.
      if (!page.isClosed()) {
        await cdp
          .send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
          .catch(() => undefined);
        await cdp.send('WebAuthn.disable').catch(() => undefined);
      }
    }
  });

  test('rejects wrong-origin, wrong-challenge, and corrupted-signature assertions', async ({
    context,
    page,
  }) => {
    const user = await createManagedUser('webauthn-adversarial');
    const failures = observeBrowserFailures(page);
    const { cdp, authenticatorId } = await addVirtualAuthenticator(
      context,
      page
    );

    try {
      await login(page, user);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
      await registerPasskey(page, 'Adversarial browser passkey');
      await logout(page);
      await login(page, user);
      await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-webauthn`);

      for (const mutation of ['origin', 'challenge', 'signature'] as const) {
        const result = await submitTamperedAssertion(page, mutation);
        expect(result).toEqual({
          status: 400,
          body: { ok: false, error: 'WebAuthn verification failed' },
        });
        await expect(page).toHaveURL(`${IDP_ORIGIN}/auth/mfa-webauthn`);
      }

      await page.locator('#webauthn-auth-btn').click();
      await expect(page).toHaveURL(`${IDP_ORIGIN}/accounts/`);
      expect(failures).toEqual({
        pageErrors: [],
        consoleErrors: Array.from(
          { length: 3 },
          () =>
            'Failed to load resource: the server responded with a status of 400 (Bad Request)'
        ),
        failedRequests: [],
        failedAssets: [],
      });
    } finally {
      if (!page.isClosed()) {
        await cdp
          .send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
          .catch(() => undefined);
        await cdp.send('WebAuthn.disable').catch(() => undefined);
      }
    }
  });
});
