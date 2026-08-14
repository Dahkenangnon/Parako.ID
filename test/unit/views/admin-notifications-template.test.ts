import { describe, expect, it } from 'vitest';

import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

describe('tenant notifications configuration template', () => {
  it('offers only SMS providers supported by the configuration schema and service', () => {
    const html = adminTemplateEnvironment.render(
      'admin/configuration/notifications.njk',
      {
        ...adminTemplateLocals(),
        config: {},
        platformNotifications: {},
        section: 'notifications',
        title: 'Notifications Configuration',
      }
    );
    const providerSelect = html.match(
      /<select[^>]*id="sms_provider"[^>]*>[\s\S]*?<\/select>/
    )?.[0];

    expect(providerSelect).toBeDefined();
    expect(providerSelect).toContain('<option value="twilio"');
    expect(providerSelect).not.toContain('<option value="vonage"');
    expect(providerSelect).not.toContain('<option value="messagebird"');
  });
});
