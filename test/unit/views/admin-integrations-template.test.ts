import { describe, expect, it } from 'vitest';

import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

function renderTemplate(template: string, locals: Record<string, unknown>) {
  return adminTemplateEnvironment.render(template, {
    ...adminTemplateLocals(),
    ...locals,
  });
}

function labelTargets(html: string): string[] {
  return [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map(match => match[1]);
}

describe('admin integrations templates', () => {
  it.each([
    [
      'platform settings',
      'admin/settings/integrations.njk',
      { config: {}, section: 'integrations', title: 'Integrations Settings' },
      'test-email',
    ],
    [
      'tenant configuration',
      'admin/configuration/integrations.njk',
      {
        config: {},
        platformIntegrations: {},
        section: 'integrations',
        title: 'Integrations Configuration',
      },
      'test-email-address',
    ],
  ])('labels the %s test-email control', (_name, template, locals, inputId) => {
    const html = renderTemplate(template, locals);

    expect(labelTargets(html)).toContain(inputId);
    expect(html).toMatch(new RegExp(`<input[^>]*id="${inputId}"`));
  });
});
