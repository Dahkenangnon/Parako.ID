import path from 'node:path';

import nunjucks from 'nunjucks';

import { configureNunjucks } from '../../../../src/utils/views.js';

export const adminTemplateEnvironment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(process.cwd(), 'src/views')),
  { autoescape: true }
);

configureNunjucks(adminTemplateEnvironment);
adminTemplateEnvironment.addGlobal('getAvailableLocales', () => [
  { code: 'en', name: 'English' },
]);

export function adminTemplateLocals() {
  return {
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
  };
}
