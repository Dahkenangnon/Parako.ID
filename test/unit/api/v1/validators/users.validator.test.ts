import { describe, expect, it } from 'vitest';

import {
  createUserSchema,
  passwordResetSchema,
  updateUserSchema,
} from '../../../../../src/api/v1/validators/users.validator.js';

const requiredCreateFields = {
  email: 'alice@example.com',
  password: 'correct horse battery staple',
};

describe('createUserSchema', () => {
  it('normalizes identity and profile fields consistently across adapters', () => {
    expect(
      createUserSchema.parse({
        email: '  Alice@Example.COM  ',
        password: requiredCreateFields.password,
        username: '  alice  ',
        given_name: '  Alice  ',
        family_name: '  Example  ',
        name: '  Alice Example  ',
        nickname: '  Ally  ',
        role: '  administrator  ',
        account_enabled: false,
      })
    ).toEqual({
      email: 'alice@example.com',
      password: requiredCreateFields.password,
      username: 'alice',
      given_name: 'Alice',
      family_name: 'Example',
      name: 'Alice Example',
      nickname: 'Ally',
      role: 'administrator',
      account_enabled: false,
    });
  });

  it('retains password whitespace because it is part of the credential', () => {
    const password = '  password with spaces  ';

    expect(
      createUserSchema.parse({
        email: requiredCreateFields.email,
        password,
      }).password
    ).toBe(password);
  });

  it.each([
    'user@example.com',
    'USER+tag@sub.example.com',
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}`,
  ])('accepts and normalizes valid email %j', email => {
    expect(
      createUserSchema.parse({
        ...requiredCreateFields,
        email: `  ${email}  `,
      }).email
    ).toBe(email.toLowerCase());
  });

  it.each([
    '',
    '   ',
    'not-an-email',
    'user @example.com',
    `${'a'.repeat(245)}@example.com`,
    42,
  ])('rejects invalid email %j', email => {
    expect(
      createUserSchema.safeParse({ ...requiredCreateFields, email }).success
    ).toBe(false);
  });

  it.each(['12345678', 'x'.repeat(128)])(
    'accepts password boundary %j',
    password => {
      expect(
        createUserSchema.parse({ ...requiredCreateFields, password }).password
      ).toBe(password);
    }
  );

  it.each(['1234567', 'x'.repeat(129), 12345678, null])(
    'rejects invalid password %j',
    password => {
      expect(
        createUserSchema.safeParse({ ...requiredCreateFields, password })
          .success
      ).toBe(false);
    }
  );

  it.each(['a', 'user-name', 'x'.repeat(100)])(
    'accepts normalized username %j',
    username => {
      expect(
        createUserSchema.parse({
          ...requiredCreateFields,
          username: `  ${username}  `,
        }).username
      ).toBe(username);
    }
  );

  it.each(['', '   ', 'x'.repeat(101), 42])(
    'rejects invalid username %j',
    username => {
      expect(
        createUserSchema.safeParse({ ...requiredCreateFields, username })
          .success
      ).toBe(false);
    }
  );

  it.each([
    ['given_name', 100],
    ['family_name', 100],
    ['name', 200],
    ['nickname', 100],
  ] as const)(
    'accepts empty and maximum-length normalized %s values',
    (field, maxLength) => {
      expect(
        createUserSchema.parse({
          ...requiredCreateFields,
          [field]: '   ',
        })[field]
      ).toBe('');
      expect(
        createUserSchema.parse({
          ...requiredCreateFields,
          [field]: `  ${'x'.repeat(maxLength)}  `,
        })[field]
      ).toBe('x'.repeat(maxLength));
    }
  );

  it.each([
    ['given_name', 101],
    ['family_name', 101],
    ['name', 201],
    ['nickname', 101],
  ] as const)('rejects oversized %s values', (field, length) => {
    expect(
      createUserSchema.safeParse({
        ...requiredCreateFields,
        [field]: 'x'.repeat(length),
      }).success
    ).toBe(false);
  });

  it.each(['user', 'platform-admin', 'x'.repeat(50)])(
    'accepts normalized role %j',
    role => {
      expect(
        createUserSchema.parse({
          ...requiredCreateFields,
          role: `  ${role}  `,
        }).role
      ).toBe(role);
    }
  );

  it.each(['', '   ', 'x'.repeat(51), 42])('rejects invalid role %j', role => {
    expect(
      createUserSchema.safeParse({ ...requiredCreateFields, role }).success
    ).toBe(false);
  });

  it.each([true, false])('accepts account_enabled=%s', account_enabled => {
    expect(
      createUserSchema.parse({ ...requiredCreateFields, account_enabled })
        .account_enabled
    ).toBe(account_enabled);
  });

  it.each(['true', 1, null])(
    'rejects non-boolean account_enabled %j',
    account_enabled => {
      expect(
        createUserSchema.safeParse({
          ...requiredCreateFields,
          account_enabled,
        }).success
      ).toBe(false);
    }
  );

  it('strips unknown properties without mutating the request body', () => {
    const body = {
      email: '  Alice@Example.COM  ',
      password: requiredCreateFields.password,
      roles: ['superadmin'],
    };

    expect(createUserSchema.parse(body)).toEqual(requiredCreateFields);
    expect(body).toEqual({
      email: '  Alice@Example.COM  ',
      password: requiredCreateFields.password,
      roles: ['superadmin'],
    });
  });
});

describe('updateUserSchema', () => {
  it('accepts an empty partial update', () => {
    expect(updateUserSchema.parse({})).toEqual({});
  });

  it('normalizes mutable fields and retains explicit empty profile values', () => {
    expect(
      updateUserSchema.parse({
        email: '  Alice@Example.COM  ',
        username: '  alice  ',
        given_name: '   ',
        family_name: '  Example  ',
        name: '  Alice Example  ',
        nickname: '   ',
        role: '  user  ',
        account_enabled: false,
      })
    ).toEqual({
      email: 'alice@example.com',
      username: 'alice',
      given_name: '',
      family_name: 'Example',
      name: 'Alice Example',
      nickname: '',
      role: 'user',
      account_enabled: false,
    });
  });

  it('strips the create-only password field', () => {
    expect(
      updateUserSchema.parse({ password: 'replacement-password' })
    ).toEqual({});
  });

  it.each([
    { email: 'invalid' },
    { username: '   ' },
    { role: '   ' },
    { account_enabled: 'false' },
  ])('rejects invalid partial update %j', update => {
    expect(updateUserSchema.safeParse(update).success).toBe(false);
  });
});

describe('passwordResetSchema', () => {
  it.each(['12345678', 'x'.repeat(128), '  password with spaces  '])(
    'accepts password bytes unchanged for %j',
    new_password => {
      expect(passwordResetSchema.parse({ new_password }).new_password).toBe(
        new_password
      );
    }
  );

  it.each(['1234567', 'x'.repeat(129), 12345678, null])(
    'rejects invalid new password %j',
    new_password => {
      expect(passwordResetSchema.safeParse({ new_password }).success).toBe(
        false
      );
    }
  );

  it('strips unknown properties without mutating the request body', () => {
    const body = {
      new_password: 'new-password',
      require_reset: false,
    };

    expect(passwordResetSchema.parse(body)).toEqual({
      new_password: 'new-password',
    });
    expect(body).toEqual({
      new_password: 'new-password',
      require_reset: false,
    });
  });
});
