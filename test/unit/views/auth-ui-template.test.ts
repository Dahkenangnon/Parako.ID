import { readFileSync } from 'node:fs';
import path from 'node:path';

import nunjucks from 'nunjucks';
import { describe, expect, it } from 'vitest';

import { configureNunjucks } from '../../../src/utils/views.js';

const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(process.cwd(), 'src/views')),
  { autoescape: true, throwOnUndefined: true }
);

configureNunjucks(environment);

describe('authentication UI macros', () => {
  it('renders the shared branded heading without inline presentation', () => {
    const html = environment.renderString(
      '{% from "partials/auth-ui.njk" import auth_page_header %}' +
        '{{ auth_page_header(branding, app, title, "mb-3", "mb-6") }}',
      {
        app: { title: 'Parako.ID' },
        branding: {
          logo: '/images/logo-light.png',
          logoDark: '/images/logo-dark.png',
        },
        title: '<Recovery>',
      }
    );

    expect(html).toContain('src="/images/logo-light.png"');
    expect(html).toContain('src="/images/logo-dark.png"');
    expect(html).toContain('alt="Parako.ID Logo"');
    expect(html).toContain('&lt;Recovery&gt;');
    expect(html).toContain('flex justify-center mb-3');
    expect(html).toContain('mb-6 flex justify-center');
    expect(html).not.toMatch(/\sstyle=/);
  });

  it('renders escaped error and success notices through one presentation contract', () => {
    const html = environment.renderString(
      '{% from "partials/auth-ui.njk" import auth_alert %}' +
        '{{ auth_alert(error, "error") }}' +
        '{{ auth_alert(success, "success") }}',
      {
        error: '<Invalid code>',
        success: 'Code sent',
      }
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('&lt;Invalid code&gt;');
    expect(html).toContain('bg-red-50');
    expect(html).toContain('Code sent');
    expect(html).toContain('bg-green-50');
  });

  it.each([
    'account-recovery.njk',
    'recovery-method-select.njk',
    'recovery-backup-codes.njk',
    'recovery-secondary-email.njk',
    'recovery-verify-code.njk',
    'recovery-security-questions.njk',
    'recovery-sms.njk',
  ])('uses the shared heading in %s', template => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/views/auth', template),
      'utf8'
    );

    expect(source).toContain(
      '{% from "partials/auth-ui.njk" import auth_page_header, auth_alert %}'
    );
    expect(source.match(/auth_page_header\(/g)).toHaveLength(1);
    expect(source.match(/auth_alert\(error/g)).toHaveLength(1);
    expect(source).not.toContain('font-size: clamp(');
  });
});
