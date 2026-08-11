import path from 'node:path';

import nunjucks from 'nunjucks';
import { describe, expect, it } from 'vitest';

import { configureNunjucks } from '../../../src/utils/views.js';

const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(process.cwd(), 'src/views')),
  { autoescape: true }
);

configureNunjucks(environment);

function renderContactPage(
  emailRequired: boolean,
  phoneRequired: boolean,
  emailEnabled = true,
  phoneEnabled = true
) {
  return environment.render('auth/social-contact-info.njk', {
    app: {
      description: 'Identity server',
      env: 'production',
      locales: { default: 'en', available: ['en'] },
      title: 'Parako.ID',
      url: 'https://parako.test',
    },
    branding: {
      colors: { dark: {}, light: {} },
      companyName: 'Parako.ID',
      favicon: '/favicon.png',
      fonts: {},
      logo: '/images/logo-light.png',
      logoDark: '/images/logo-dark.png',
    },
    contactChannels: {
      email: { enabled: emailEnabled, required: emailRequired },
      phone: { enabled: phoneEnabled, required: phoneRequired },
    },
    csrfToken: 'csrf-token',
    flash: {},
    provider: 'github',
    providerData: { given_name: 'Social User' },
    routes: { authFull: { register: '/auth/register' } },
    t: (_key: string, fallback?: string) => fallback || 'Translated text',
    urls: { website: '/' },
  });
}

describe('social contact completion template', () => {
  it('exposes configured required contacts to browsers and assistive technology', () => {
    const html = renderContactPage(false, true);
    const emailInput = html.match(/<input[^>]*id="email"[^>]*>/)?.[0];
    const phoneInput = html.match(/<input[^>]*id="phone_number"[^>]*>/)?.[0];
    const emailLabel = html.match(
      /<label[^>]*for="email"[^>]*>[\s\S]*?<\/label>/
    )?.[0];
    const phoneLabel = html.match(
      /<label[^>]*for="phone_number"[^>]*>[\s\S]*?<\/label>/
    )?.[0];

    expect(emailLabel).toContain('(optional)');
    expect(emailInput).not.toContain('required');
    expect(phoneLabel).toContain('text-red-500');
    expect(phoneInput).toContain('required');
  });

  it('does not expose a contact channel that registration has disabled', () => {
    const html = renderContactPage(false, true, false, true);

    expect(html).not.toContain('id="email"');
    expect(html).toContain('id="phone_number"');
  });
});
