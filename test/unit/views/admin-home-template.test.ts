import { describe, expect, it } from 'vitest';

import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

function renderDashboard() {
  const base = adminTemplateLocals();
  return adminTemplateEnvironment.render('admin/home.njk', {
    ...base,
    appInfo: {
      environment: 'test',
      mfaEnabled: false,
      title: 'Parako.ID',
    },
    isPlatformTenant: false,
    recentActivity: [],
    routes: {
      ...base.routes,
      adminFull: {
        activities: '/admin/activities',
        configuration: '/admin/configuration',
        dashboard: '/admin',
        data_transfer: '/admin/data-transfer',
        jwks: '/admin/jwks',
        logout: '/admin/logout',
        oidc_client_create: '/admin/oidc-clients/new',
        oidc_clients: '/admin/oidc-clients',
        sessions: '/admin/sessions',
        settings: '/admin/settings',
        tenants: '/admin/tenants',
        user_grants: '/admin/user-grants',
        user_new: '/admin/users/new',
        users: '/admin/users',
      },
    },
    stats: {
      activities: {
        available: true,
        thisMonth: 0,
        thisWeek: 0,
        today: 4,
        total: 8,
      },
      grants: { active: 2, available: true, revoked: 0, total: 2 },
      oidc: {
        activeClients: 3,
        available: true,
        clients: 3,
        totalClients: 3,
      },
      sessions: { active: 1, available: true, expired: 0, total: 1 },
      users: {
        active: 0,
        activeRate: 0,
        admins: 0,
        available: false,
        newThisMonth: 0,
        newThisWeek: 0,
        newToday: 0,
        total: 0,
        verificationRate: 0,
        verified: 0,
      },
    },
    title: 'Admin Dashboard',
  });
}

describe('admin dashboard template', () => {
  it('distinguishes an unavailable subsystem from a real zero count', () => {
    const html = renderDashboard();

    expect(html).toContain('aria-label="User statistics unavailable"');
    expect(html).toContain('data-dashboard-stat="users"');
    expect(html).toContain('data-dashboard-stat="oidc"');
    expect(html).toContain('>3</div>');
  });
});
