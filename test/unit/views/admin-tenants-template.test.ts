import { describe, expect, it } from 'vitest';

import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

const tenant = {
  slug: 'acme',
  display_name: 'Acme',
  status: 'active',
};

function platformLocals(
  platformRole: 'platform_admin' | 'platform_viewer',
  isAdmin = false
) {
  const base = adminTemplateLocals();
  return {
    ...base,
    activePage: 'tenants',
    currentUser: { ...base.currentUser, is_admin: isAdmin },
    isMultiTenancyEnabled: true,
    isPlatformTenant: true,
    platformRole,
    routes: {
      ...base.routes,
      adminFull: {
        activities: '/admin/activities',
        configuration: '/admin/configuration',
        dashboard: '/admin',
        data_transfer: '/admin/data-transfer',
        jwks: '/admin/jwks',
        logout: '/admin/logout',
        oidc_clients: '/admin/oidc-clients',
        sessions: '/admin/sessions',
        settings: '/admin/settings',
        tenants: '/admin/tenants',
        user_grants: '/admin/grants',
        users: '/admin/users',
      },
    },
  };
}

function renderList(
  platformRole: 'platform_admin' | 'platform_viewer',
  renderedTenant = tenant
) {
  return adminTemplateEnvironment.render('admin/tenants/index.njk', {
    ...platformLocals(platformRole),
    filters: { status: '' },
    stats: { active: 1, archived: 0, suspended: 0, total: 1 },
    tenants: [renderedTenant],
    title: 'Tenant Management',
  });
}

function renderDetails(
  platformRole: 'platform_admin' | 'platform_viewer',
  renderedTenant = tenant
) {
  return adminTemplateEnvironment.render('admin/tenants/show.njk', {
    ...platformLocals(platformRole),
    tenant: renderedTenant,
    title: 'Tenant: Acme',
    users: { page: 1, results: [], totalPages: 1, totalResults: 0 },
  });
}

function renderCreate() {
  return adminTemplateEnvironment.render('admin/tenants/create.njk', {
    ...platformLocals('platform_admin'),
    title: 'New Tenant',
  });
}

describe('platform tenant templates', () => {
  it('keeps tenant mutation controls visible for platform administrators', () => {
    const list = renderList('platform_admin');
    const details = renderDetails('platform_admin');

    expect(list).toContain('href="/admin/tenants/new"');
    expect(list).toContain('href="/admin/tenants/acme/edit"');
    expect(details).toContain('href="/admin/tenants/acme/edit"');
    expect(details).toContain('action="/admin/tenants/acme/status"');
  });

  it('does not advertise tenant-admin routes to an explicit platform administrator', () => {
    const list = renderList('platform_admin');

    expect(list).toContain('href="/admin/tenants"');
    expect(list).not.toContain('href="/admin/users"');
    expect(list).not.toContain('href="/admin/settings"');
    expect(list).not.toContain('href="/admin/configuration"');
  });

  it('keeps full tenant and platform navigation for a built-in administrator', () => {
    const list = adminTemplateEnvironment.render('admin/tenants/index.njk', {
      ...platformLocals('platform_admin', true),
      filters: { status: '' },
      stats: { active: 1, archived: 0, suspended: 0, total: 1 },
      tenants: [tenant],
      title: 'Tenant Management',
    });

    expect(list).toContain('href="/admin/users"');
    expect(list).toContain('href="/admin/settings"');
    expect(list).toContain('href="/admin/configuration"');
    expect(list).toContain('href="/admin/tenants"');
  });

  it('renders a read-only tenant portal for platform viewers', () => {
    const list = renderList('platform_viewer');
    const details = renderDetails('platform_viewer');

    expect(list).toContain('href="/admin/tenants/acme"');
    expect(list).not.toContain('href="/admin/tenants/new"');
    expect(list).not.toContain('href="/admin/tenants/acme/edit"');
    expect(details).not.toContain('href="/admin/tenants/acme/edit"');
    expect(details).not.toContain('action="/admin/tenants/acme/status"');

    expect(list).toContain('href="/admin/tenants"');
    expect(list).not.toContain('href="/admin/users"');
    expect(list).not.toContain('href="/admin/settings"');
  });

  it('does not expose mutation controls for the platform master tenant', () => {
    const masterTenant = {
      ...tenant,
      slug: '_platforms',
      display_name: 'Platform Administration',
    };
    const list = renderList('platform_admin', masterTenant);
    const details = renderDetails('platform_admin', masterTenant);

    expect(list).toContain('href="/admin/tenants/_platforms"');
    expect(list).not.toContain('href="/admin/tenants/_platforms/edit"');
    expect(details).not.toContain('href="/admin/tenants/_platforms/edit"');
    expect(details).not.toContain('action="/admin/tenants/_platforms/status"');
  });

  it('emits a tenant slug pattern accepted by modern browsers', () => {
    const create = renderCreate();
    const pattern = create.match(
      /<input[^>]*id="slug"[^>]*pattern="([^"]+)"/s
    )?.[1];

    expect(pattern).toBeDefined();
    expect(() => new RegExp(pattern!, 'v')).not.toThrow();
  });
});
