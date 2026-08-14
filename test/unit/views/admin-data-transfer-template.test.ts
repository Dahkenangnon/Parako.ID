import path from 'node:path';

import nunjucks from 'nunjucks';
import { describe, expect, it } from 'vitest';

import { configureNunjucks } from '../../../src/utils/views.js';

const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(process.cwd(), 'src/views')),
  { autoescape: true }
);

configureNunjucks(environment);
environment.addGlobal('getAvailableLocales', () => [
  { code: 'en', name: 'English' },
]);

function renderEntityPage(entityId = 'users') {
  return environment.render('admin/data-transfer/entity.njk', {
    activePage: 'data-transfer',
    app: {
      description: 'Identity server',
      fingerprintJS: {},
      locales: { available: ['en'], default: 'en' },
      title: 'Parako.ID',
      url: 'https://parako.test',
    },
    branding: {
      colors: { dark: {}, light: {} },
      companyName: 'Parako.ID',
      favicon: '/favicon.png',
      fonts: {},
    },
    csrfToken: 'csrf-token',
    currentUser: {
      accountType: 'Administrator',
      initials: 'AU',
      sidebarName: 'Admin User',
    },
    entity: {
      description: 'Transfer records',
      displayName: entityId === 'activities' ? 'Activities' : 'Users',
      entityId,
      format: 'csv',
      hasExport: true,
      hasImport: entityId !== 'activities',
      hasSecretFields: entityId !== 'activities',
      hasSensitiveFields: entityId === 'users',
    },
    importColumns: [{ field: 'email', header: 'Email', required: true }],
    routes: {
      authFull: {
        update_locale: '/auth/locale',
        update_theme: '/auth/theme',
        update_timezone: '/auth/timezone',
      },
    },
    sidebar_expanded: true,
    t: (_key: string, fallback?: string) => fallback || 'Translated text',
    userLocale: 'en',
    userTheme: 'light',
  });
}

describe('admin data-transfer entity template', () => {
  it('connects the import and export tabs to keyboard-focusable panels', () => {
    const html = renderEntityPage();

    expect(html).toMatch(
      /id="import-tab"[^>]*aria-controls="import-panel"[^>]*tabindex="0"/
    );
    expect(html).toMatch(
      /id="export-tab"[^>]*aria-controls="export-panel"[^>]*tabindex="-1"/
    );
    expect(html).toMatch(
      /id="import-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="import-tab"/
    );
    expect(html).toMatch(
      /id="export-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="export-tab"/
    );
  });

  it('provides names and live status semantics for import controls', () => {
    const html = renderEntityPage();

    expect(html).toMatch(/<label[^>]*for="import-file-input"[^>]*>/);
    expect(html).toMatch(
      /id="progress-area"[^>]*role="status"[^>]*aria-live="polite"/
    );
    expect(html).toMatch(
      /id="progress-bar"[^>]*role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="0"/
    );
    expect(html).toMatch(
      /id="result-area"[^>]*role="status"[^>]*aria-live="polite"/
    );
  });

  it('associates activity date labels with their inputs', () => {
    const html = renderEntityPage('activities');

    expect(html).toMatch(
      /<label[^>]*for="activity-date-from"[^>]*>From Date<\/label>/
    );
    expect(html).toMatch(
      /<input[^>]*id="activity-date-from"[^>]*name="dateFrom"/
    );
    expect(html).toMatch(
      /<label[^>]*for="activity-date-to"[^>]*>To Date<\/label>/
    );
    expect(html).toMatch(/<input[^>]*id="activity-date-to"[^>]*name="dateTo"/);
    expect(html).not.toContain('name="includeSensitive"');
    expect(html).not.toContain('name="includeSecrets"');
  });

  it('renders only supported export field-group options', () => {
    const users = renderEntityPage('users');
    const clients = renderEntityPage('oidc-clients');

    expect(users).toContain('name="includeSensitive"');
    expect(users).toContain('name="includeSecrets"');
    expect(clients).not.toContain('name="includeSensitive"');
    expect(clients).toContain('name="includeSecrets"');
  });

  it('renders the secret-export warning without corrupted characters', () => {
    const html = renderEntityPage('users');

    expect(html).toContain('(password hashes, client secrets - audit logged)');
    expect(html).not.toContain('\uFFFD');
  });
});
