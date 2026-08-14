import { describe, expect, it } from 'vitest';

import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

describe('admin application settings template', () => {
  it('submits the immutable configuration revision rendered with the form', () => {
    const html = adminTemplateEnvironment.render(
      'admin/settings/application.njk',
      {
        ...adminTemplateLocals(),
        config: {},
        configVersion: 7,
        title: 'Application Settings',
      }
    );

    expect(html).toContain('name="_configVersion"');
    expect(html).toContain('value="7"');
  });
});
