import path from 'node:path';

import nunjucks from 'nunjucks';
import { describe, expect, it } from 'vitest';

const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(process.cwd(), 'src/views')),
  { autoescape: true }
);

describe('authentication footer controls template', () => {
  it('renders the locale selector for the external locale manager', () => {
    const html = environment.render('partials/auth-footer-controls.njk', {
      app: { locales: { available: ['en', 'fr'] } },
      branding: { companyName: 'Parako.ID' },
      t: (_key: string, fallback?: string) => fallback || 'Language',
      userLocale: 'en',
    });

    expect(html).toContain('id="language-selector"');
    expect(html).not.toMatch(/\sonchange=/);
    expect(html).not.toContain('window.location');
    expect(html).toContain('<option value="en" selected>EN</option>');
    expect(html).toContain('<option value="fr" >FR</option>');
  });
});
