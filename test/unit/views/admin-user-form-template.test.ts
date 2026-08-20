import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  adminTemplateEnvironment,
  adminTemplateLocals,
} from './support/admin-template.js';

const createTemplate = readFileSync('src/views/admin/users/create.njk', 'utf8');
const editTemplate = readFileSync('src/views/admin/users/edit.njk', 'utf8');

function renderCreate() {
  return adminTemplateEnvironment.render('admin/users/create.njk', {
    ...adminTemplateLocals(),
    customIdentifierFields: [],
    roles: ['user', 'admin'],
    title: 'Create New User',
  });
}

function renderEdit(zoneinfo: string) {
  return adminTemplateEnvironment.render('admin/users/edit.njk', {
    ...adminTemplateLocals(),
    customIdentifierFields: [],
    roles: ['user', 'admin'],
    title: 'Edit User',
    user: {
      _id: 'user-1',
      account_enabled: true,
      email: 'ada@example.test',
      family_name: 'Lovelace',
      given_name: 'Ada',
      name: 'Ada Lovelace',
      roles: ['user'],
      username: 'ada',
      zoneinfo,
    },
  });
}

describe('admin user form templates', () => {
  it('keeps the create-form timezone default', () => {
    const rendered = renderCreate();

    expect(rendered).toMatch(
      /<option value="Africa\/Porto-Novo"\s+selected>Porto-Novo<\/option>/
    );
  });

  it('selects the persisted timezone on the edit form', () => {
    const rendered = renderEdit('Europe/Paris');

    expect(rendered).toMatch(
      /<option value="Europe\/Paris"\s+selected>Paris<\/option>/
    );
    expect(rendered).not.toMatch(
      /<option value="Africa\/Porto-Novo"\s+selected>Porto-Novo<\/option>/
    );
  });

  it('shares the timezone option markup instead of copying it into each page', () => {
    expect(createTemplate).toContain("timezone_options('Africa/Porto-Novo')");
    expect(editTemplate).toContain('timezone_options(user.zoneinfo)');
    expect(`${createTemplate}\n${editTemplate}`).not.toContain(
      '<optgroup label="Africa">'
    );
  });
});
