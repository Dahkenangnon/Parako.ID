import path from 'node:path';

import nunjucks from 'nunjucks';
import { describe, expect, it } from 'vitest';

import { configureNunjucks } from '../../../src/utils/views.js';

const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(process.cwd(), 'src/views')),
  { autoescape: true }
);

configureNunjucks(environment);

const sharedLocals = {
  app: {
    title: 'Parako.ID',
    description: 'Identity server',
    locales: { default: 'en', available: ['en'] },
  },
  branding: {
    companyName: 'Parako.ID',
    logo: '/images/logo-light.png',
    logoDark: '/images/logo-dark.png',
    favicon: '/favicon.png',
    colors: { light: {}, dark: {} },
    fonts: {},
  },
  currentYear: 2026,
  flash: {},
  request: { url: '/', originalUrl: '/' },
  t: (key: string) => key,
  urls: { website: '/' },
};

describe('built-in error templates', () => {
  it.each([
    ['error/401.njk', '401'],
    ['error/403.njk', '403'],
    ['error/404.njk', '404'],
    ['error/500.njk', '500'],
  ])('renders %s with the shared application locals', (template, status) => {
    const html = environment.render(template, sharedLocals);

    expect(html).toContain(`>${status}<`);
    expect(html).toContain('/css/');
    expect(html).not.toContain('javascript:');
    expect(html).not.toMatch(/\son\w+=/);
  });

  it.each([
    ['error/403.njk', 'back'],
    ['error/500.njk', 'reload'],
  ])('uses the external recovery action on %s', (template, action) => {
    const html = environment.render(template, sharedLocals);

    expect(html).toContain(`data-error-action="${action}"`);
    expect(html).toMatch(/\/js\/error-page(?:-[A-Z0-9]+)?\.js/);
  });
});
