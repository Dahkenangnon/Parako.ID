import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { UsersController } from '../../../../../src/api/v1/controllers/users.controller.js';
import type { UsersControllerDeps } from '../../../../../src/api/v1/controllers/users.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';
import { encodeCursor } from '../../../../../src/api/v1/pagination.js';

// Helpers

function createMockDeps(): UsersControllerDeps {
  return {
    userService: {
      findById: vi.fn().mockResolvedValue(null),
      updateById: vi.fn().mockResolvedValue(null),
      deactivate: vi.fn().mockResolvedValue(null),
      activate: vi.fn().mockResolvedValue(null),
      disableMfa: vi.fn().mockResolvedValue(null),
      anonymize: vi.fn().mockResolvedValue(null),
      findWithPagination: vi.fn().mockResolvedValue([]),
    },
    authService: {
      registerUser: vi.fn().mockResolvedValue({}),
      registerManagedUser: vi.fn().mockResolvedValue({}),
      adminChangeUserPassword: vi.fn().mockResolvedValue(undefined),
      changeUserPasswordByAuthorizedClient: vi
        .fn()
        .mockResolvedValue(undefined),
    },
    activityService: {
      getUserActivities: vi.fn().mockResolvedValue([]),
    },
    oidcAdapter: {
      session: {
        findByAccountId: vi.fn().mockResolvedValue([]),
      },
    },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
  };
}

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    body: {},
    path: '/api/v1/users',
    apiAuth: {
      client_id: 'test-api-client',
      scope: 'parako:users:read parako:users:write',
    },
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// Sample data

const sampleUser = {
  _id: '507f1f77bcf86cd799439011',
  email: 'jane@example.com',
  username: 'janedoe',
  name: 'Jane Doe',
  given_name: 'Jane',
  family_name: 'Doe',
  role: 'user',
  account_enabled: true,
  password: 'hashed-secret',
  hashedPassword: 'hashed-secret',
  mfa: {
    enabled: true,
    secret: 'TOTP_SECRET_BASE32',
    recovery_codes: ['code1', 'code2'],
  },
  webauthn: {
    enabled: false,
    credentials: [{ id: 'cred-1', publicKey: 'pk' }],
  },
};

// Tests

describe('api/v1/controllers/UsersController', () => {
  let deps: UsersControllerDeps;
  let controller: UsersController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new UsersController(deps);
  });

  // list
  describe('list()', () => {
    it('should return a paginated list of users with sensitive fields stripped', async () => {
      const users = [
        { ...sampleUser },
        {
          ...sampleUser,
          _id: '507f1f77bcf86cd799439012',
          email: 'john@example.com',
        },
      ];
      vi.mocked(deps.userService.findWithPagination).mockResolvedValue(users);

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.userService.findWithPagination).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);

      // Sensitive fields must be stripped
      for (const user of jsonCall.data) {
        expect(user).not.toHaveProperty('password');
        expect(user).not.toHaveProperty('hashedPassword');
        expect(user.mfa).not.toHaveProperty('secret');
        expect(user.mfa).not.toHaveProperty('recovery_codes');
        expect(user.webauthn).not.toHaveProperty('credentials');
      }

      expect(jsonCall.pagination).toBeDefined();
      expect(jsonCall.pagination.has_more).toBe(false);
    });

    it('should filter by account_enabled when provided', async () => {
      vi.mocked(deps.userService.findWithPagination).mockResolvedValue([]);

      const req = createMockRequest({ query: { account_enabled: 'true' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.userService.findWithPagination).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('account_enabled', true);
    });

    it('should filter by role when provided', async () => {
      vi.mocked(deps.userService.findWithPagination).mockResolvedValue([]);

      const req = createMockRequest({ query: { role: 'admin' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.userService.findWithPagination).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('role', 'admin');
    });

    it('should filter by auth_provider when provided', async () => {
      vi.mocked(deps.userService.findWithPagination).mockResolvedValue([]);

      const req = createMockRequest({ query: { auth_provider: 'google' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.userService.findWithPagination).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('auth_provider', 'google');
    });

    it('should apply text search via q parameter', async () => {
      vi.mocked(deps.userService.findWithPagination).mockResolvedValue([]);

      const req = createMockRequest({ query: { q: 'jane' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.userService.findWithPagination).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('searchTerm', 'jane');
      expect(callArg).toHaveProperty('searchFields', [
        'email',
        'username',
        'name',
      ]);
    });

    it('should ignore empty or oversized string filters', async () => {
      const requests = [
        { role: '', auth_provider: 'x'.repeat(51), q: '   ' },
        { role: 'x'.repeat(51), auth_provider: '' },
      ];

      for (const query of requests) {
        await controller.list(
          createMockRequest({ query }),
          createMockResponse(),
          createMockNext()
        );
      }

      for (const [filter] of vi.mocked(deps.userService.findWithPagination).mock
        .calls) {
        expect(filter).not.toHaveProperty('role');
        expect(filter).not.toHaveProperty('auth_provider');
        expect(filter).not.toHaveProperty('searchTerm');
      }
    });

    it('should support service pagination metadata and optional counts', async () => {
      vi.mocked(deps.userService.findWithPagination)
        .mockResolvedValueOnce({
          results: [{ id: 'user-1', email: 'one@example.com' }],
          totalResults: 7,
        })
        .mockResolvedValueOnce({});

      const countedResponse = createMockResponse();
      await controller.list(
        createMockRequest({ query: { include_count: 'true' } }),
        countedResponse,
        createMockNext()
      );
      expect(
        vi.mocked(countedResponse.json).mock.calls[0][0].pagination.total_count
      ).toBe(7);

      const emptyResponse = createMockResponse();
      await controller.list(
        createMockRequest({ query: { include_count: 'true' } }),
        emptyResponse,
        createMockNext()
      );
      expect(vi.mocked(emptyResponse.json).mock.calls[0][0].data).toEqual([]);
      expect(
        vi.mocked(emptyResponse.json).mock.calls[0][0].pagination
      ).not.toHaveProperty('total_count');
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('DB connection lost');
      vi.mocked(deps.userService.findWithPagination).mockRejectedValue(error);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // create
  describe('create()', () => {
    it('should create a user and return 201 with sensitive fields stripped', async () => {
      const created = { ...sampleUser };
      vi.mocked(deps.authService.registerManagedUser).mockResolvedValue(
        created
      );

      const req = createMockRequest({
        body: {
          email: 'jane@example.com',
          password: 'securepassword123',
          username: 'janedoe',
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(deps.authService.registerManagedUser).toHaveBeenCalledWith(
        req.body
      );
      expect(deps.authService.registerUser).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
      expect(jsonCall.data).not.toHaveProperty('hashedPassword');
      expect(jsonCall.data.email).toBe('jane@example.com');
    });

    it('should log user creation', async () => {
      const created = { ...sampleUser };
      vi.mocked(deps.authService.registerManagedUser).mockResolvedValue(
        created
      );

      const req = createMockRequest({
        body: {
          email: 'jane@example.com',
          password: 'securepassword123',
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'User created via API',
        expect.objectContaining({ user_id: '507f1f77bcf86cd799439011' })
      );
    });

    it('should call next(error) on service failure', async () => {
      const error = new Error('Registration failed');
      vi.mocked(deps.authService.registerManagedUser).mockRejectedValue(error);

      const req = createMockRequest({
        body: { email: 'jane@example.com', password: 'securepassword123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // get
  describe('get()', () => {
    it('should return a user with sensitive fields stripped', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(deps.userService.findById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
      expect(jsonCall.data).not.toHaveProperty('hashedPassword');
      expect(jsonCall.data.email).toBe('jane@example.com');
    });

    it('should strip sensitive fields from Mongoose documents (toJSON)', async () => {
      const mongooseDoc = {
        ...sampleUser,
        toJSON: () => ({ ...sampleUser }),
      };
      vi.mocked(deps.userService.findById).mockResolvedValue(mongooseDoc);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
      expect(jsonCall.data.mfa).not.toHaveProperty('secret');
    });

    it('should call next with 404 ApiError when user is not found', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue(null);

      const req = createMockRequest({ params: { user_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.detail).toContain('nonexistent');
    });
  });

  // update
  describe('update()', () => {
    it('translates the API role field to the domain roles array without mutating the body', async () => {
      const updated = { ...sampleUser, roles: ['admin'] };
      const body = { name: 'Jane Updated', role: 'admin' };
      vi.mocked(deps.userService.updateById).mockResolvedValue(updated);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body,
      });

      await controller.update(req, createMockResponse(), createMockNext());

      expect(deps.userService.updateById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        { name: 'Jane Updated', roles: ['admin'] }
      );
      expect(body).toEqual({ name: 'Jane Updated', role: 'admin' });
    });

    it('should validate body, update, and return the user without sensitive fields', async () => {
      const updated = { ...sampleUser, name: 'Jane Updated' };
      vi.mocked(deps.userService.updateById).mockResolvedValue(updated);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body: { name: 'Jane Updated' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(deps.userService.updateById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        expect.objectContaining({ name: 'Jane Updated' })
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
      expect(jsonCall.data.name).toBe('Jane Updated');
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.updateById).mockResolvedValue(null);

      const req = createMockRequest({
        params: { user_id: 'nonexistent' },
        body: { name: 'Updated' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // patch
  describe('patch()', () => {
    it('should accept a partial body and return the updated user', async () => {
      const patched = { ...sampleUser, nickname: 'JD' };
      vi.mocked(deps.userService.updateById).mockResolvedValue(patched);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body: { nickname: 'JD' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.patch(req, res, next);

      expect(deps.userService.updateById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        expect.objectContaining({ nickname: 'JD' })
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
    });

    it('should accept an empty body (all fields optional)', async () => {
      const unchanged = { ...sampleUser };
      vi.mocked(deps.userService.updateById).mockResolvedValue(unchanged);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body: {},
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.patch(req, res, next);

      expect(deps.userService.updateById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        expect.objectContaining({})
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.updateById).mockResolvedValue(null);

      const req = createMockRequest({
        params: { user_id: 'nonexistent' },
        body: { name: 'Patched' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.patch(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // destroy
  describe('destroy()', () => {
    it('should destroy the user and return 204', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });
      vi.mocked(deps.userService.anonymize).mockResolvedValue(undefined);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.destroy(req, res, next);

      expect(deps.userService.findById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(deps.userService.anonymize).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should log user destruction', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });
      vi.mocked(deps.userService.anonymize).mockResolvedValue(undefined);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.destroy(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'User destroyed via API',
        expect.objectContaining({ user_id: '507f1f77bcf86cd799439011' })
      );
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue(null);

      const req = createMockRequest({ params: { user_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.destroy(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(deps.userService.anonymize).not.toHaveBeenCalled();
    });
  });

  // lock
  describe('lock()', () => {
    it('should lock the user and return 200 with sensitive fields stripped', async () => {
      const locked = { ...sampleUser, account_enabled: false };
      vi.mocked(deps.userService.deactivate).mockResolvedValue(locked);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.lock(req, res, next);

      expect(deps.userService.deactivate).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
      expect(jsonCall.data.account_enabled).toBe(false);
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.deactivate).mockResolvedValue(null);

      const req = createMockRequest({ params: { user_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.lock(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // unlock
  describe('unlock()', () => {
    it('should unlock the user and return 200 with sensitive fields stripped', async () => {
      const unlocked = { ...sampleUser, account_enabled: true };
      vi.mocked(deps.userService.activate).mockResolvedValue(unlocked);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.unlock(req, res, next);

      expect(deps.userService.activate).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
      expect(jsonCall.data.account_enabled).toBe(true);
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.activate).mockResolvedValue(null);

      const req = createMockRequest({ params: { user_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.unlock(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // passwordReset
  describe('passwordReset()', () => {
    it('should validate and reset the password, returning 200', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body: { new_password: 'newSecurePassword123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.passwordReset(req, res, next);

      expect(
        deps.authService.changeUserPasswordByAuthorizedClient
      ).toHaveBeenCalledWith(
        'test-api-client',
        '507f1f77bcf86cd799439011',
        'newSecurePassword123'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.message).toBe('Password has been reset');
    });

    it('should log password reset', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body: { new_password: 'newSecurePassword123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.passwordReset(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'User password reset via API',
        expect.objectContaining({
          user_id: '507f1f77bcf86cd799439011',
          admin: 'test-api-client',
        })
      );
    });

    it('should use a non-user API actor when client authentication is absent', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });

      await controller.passwordReset(
        createMockRequest({
          params: { user_id: '507f1f77bcf86cd799439011' },
          body: { new_password: 'SecurePassword123!' },
          apiAuth: undefined,
        }),
        createMockResponse(),
        createMockNext()
      );

      expect(
        deps.authService.changeUserPasswordByAuthorizedClient
      ).toHaveBeenCalledWith(
        'api',
        '507f1f77bcf86cd799439011',
        'SecurePassword123!'
      );
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue(null);

      const req = createMockRequest({
        params: { user_id: 'nonexistent' },
        body: { new_password: 'newSecurePassword123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.passwordReset(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(
        deps.authService.changeUserPasswordByAuthorizedClient
      ).not.toHaveBeenCalled();
    });
  });

  // mfaReset
  describe('mfaReset()', () => {
    it('should reset MFA and return 200', async () => {
      const mfaDisabled = { ...sampleUser, mfa: { enabled: false } };
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });
      vi.mocked(deps.userService.disableMfa).mockResolvedValue(mfaDisabled);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.mfaReset(req, res, next);

      expect(deps.userService.disableMfa).toHaveBeenCalledWith('janedoe');
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.message).toBe('MFA has been reset');
    });

    it('should log MFA reset', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });
      vi.mocked(deps.userService.disableMfa).mockResolvedValue({
        ...sampleUser,
      });

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.mfaReset(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'User MFA reset via API',
        expect.objectContaining({ user_id: '507f1f77bcf86cd799439011' })
      );
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue(null);

      const req = createMockRequest({ params: { user_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.mfaReset(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(deps.userService.disableMfa).not.toHaveBeenCalled();
    });
  });

  // activities
  describe('activities()', () => {
    it('should return paginated activities for the user', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });

      const activities = [
        { _id: 'act-1', action: 'login', timestamp: '2026-03-07T10:00:00Z' },
        {
          _id: 'act-2',
          action: 'password_change',
          timestamp: '2026-03-06T15:30:00Z',
        },
      ];
      vi.mocked(deps.activityService.getUserActivities).mockResolvedValue(
        activities
      );

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.activities(req, res, next);

      expect(deps.userService.findById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(deps.activityService.getUserActivities).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        expect.objectContaining({ limit: expect.any(Number) })
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);
      expect(jsonCall.pagination).toBeDefined();
    });

    it('should support paginated service results and optional counts', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });
      vi.mocked(deps.activityService.getUserActivities)
        .mockResolvedValueOnce({
          results: [{ id: 'activity-1', type: 'login' }],
          totalResults: 4,
        })
        .mockResolvedValueOnce({});

      const countedResponse = createMockResponse();
      await controller.activities(
        createMockRequest({
          params: { user_id: '507f1f77bcf86cd799439011' },
          query: { include_count: 'true' },
        }),
        countedResponse,
        createMockNext()
      );
      expect(
        vi.mocked(countedResponse.json).mock.calls[0][0].pagination.total_count
      ).toBe(4);

      const emptyResponse = createMockResponse();
      await controller.activities(
        createMockRequest({
          params: { user_id: '507f1f77bcf86cd799439011' },
          query: { include_count: 'true' },
        }),
        emptyResponse,
        createMockNext()
      );
      expect(vi.mocked(emptyResponse.json).mock.calls[0][0].data).toEqual([]);
    });

    it('should continue activity pagination after the timestamp and id cursor', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });
      vi.mocked(deps.activityService.getUserActivities).mockResolvedValue({
        results: [
          {
            id: 'activity-2',
            type: 'login',
            timestamp: new Date('2026-08-04T12:00:00.000Z'),
          },
          {
            id: 'activity-1',
            type: 'logout',
            timestamp: new Date('2026-08-04T11:00:00.000Z'),
          },
        ],
        totalResults: 2,
      });
      const after = encodeCursor({
        timestamp: '2026-08-05T12:00:00.000Z',
        id: 'activity-3',
      });
      const res = createMockResponse();

      await controller.activities(
        createMockRequest({
          params: { user_id: '507f1f77bcf86cd799439011' },
          query: { after, limit: '1' },
        }),
        res,
        createMockNext()
      );

      expect(deps.activityService.getUserActivities).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        {
          limit: 2,
          page: 1,
          sort: { timestamp: -1, id: -1 },
          cursor: {
            timestamp: new Date('2026-08-05T12:00:00.000Z'),
            id: 'activity-3',
          },
        }
      );

      const body = vi.mocked(res.json).mock.calls[0][0];
      expect(body.pagination.has_more).toBe(true);
      expect(body.pagination.next_cursor).not.toBeNull();
      const decoded = JSON.parse(
        Buffer.from(body.pagination.next_cursor, 'base64url').toString()
      );
      expect(decoded).toEqual({
        timestamp: new Date('2026-08-04T12:00:00.000Z').toString(),
        id: 'activity-2',
      });
    });

    it('should reject an activity cursor with an invalid timestamp', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });
      const next = createMockNext();

      await controller.activities(
        createMockRequest({
          params: { user_id: '507f1f77bcf86cd799439011' },
          query: {
            after: encodeCursor({ timestamp: 'not-a-date', id: 'activity-1' }),
          },
        }),
        createMockResponse(),
        next
      );

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(
        (vi.mocked(next).mock.calls[0][0] as unknown as ApiError).status
      ).toBe(422);
      expect(deps.activityService.getUserActivities).not.toHaveBeenCalled();
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue(null);

      const req = createMockRequest({ params: { user_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.activities(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(deps.activityService.getUserActivities).not.toHaveBeenCalled();
    });
  });

  // sessions
  describe('sessions()', () => {
    it('should return sessions for the user', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });

      const sessions = [
        {
          jti: 'sess-1',
          accountId: 'janedoe',
          exp: 1741348800,
        },
        {
          jti: 'sess-2',
          accountId: 'janedoe',
          exp: 1741352400,
        },
      ];
      vi.mocked(deps.oidcAdapter.session.findByAccountId!).mockResolvedValue(
        sessions
      );

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.sessions(req, res, next);

      expect(deps.userService.findById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(deps.oidcAdapter.session.findByAccountId).toHaveBeenCalledWith(
        'janedoe'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);
    });

    it('should return empty array when findByAccountId is not available', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });

      // Remove the method to simulate adapter without this capability
      const depsWithoutMethod = createMockDeps();
      depsWithoutMethod.oidcAdapter.session = {} as any;
      const controllerWithout = new UsersController(depsWithoutMethod);
      vi.mocked(depsWithoutMethod.userService.findById).mockResolvedValue({
        ...sampleUser,
      });

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controllerWithout.sessions(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual([]);
    });

    it('should normalize a null adapter result to an empty list', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });
      vi.mocked(deps.oidcAdapter.session.findByAccountId!).mockResolvedValue(
        null as never
      );
      const res = createMockResponse();

      await controller.sessions(
        createMockRequest({
          params: { user_id: '507f1f77bcf86cd799439011' },
        }),
        res,
        createMockNext()
      );

      expect(vi.mocked(res.json).mock.calls[0][0].data).toEqual([]);
    });

    it('should call next with 404 when user is not found', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue(null);

      const req = createMockRequest({ params: { user_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.sessions(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // DB abstraction
  describe('DB abstraction', () => {
    describe('stripSensitiveFields', () => {
      it('should strip fields from plain object (Prisma-style, no toJSON)', async () => {
        const plainUser = {
          id: 'prisma-id',
          email: 'test@example.com',
          password: 'hashed',
          hashedPassword: 'hashed',
          mfa: { secret: 'totp-secret', recovery_codes: ['code1'] },
        };
        vi.mocked(deps.userService.findById).mockResolvedValue(plainUser);
        const req = createMockRequest({ params: { user_id: 'prisma-id' } });
        const res = createMockResponse();
        await controller.get(req, res, createMockNext());
        const body = vi.mocked(res.json).mock.calls[0][0];
        expect(body.data.password).toBeUndefined();
        expect(body.data.hashedPassword).toBeUndefined();
        expect(body.data.mfa.secret).toBeUndefined();
      });

      it('should strip canonical credential fields without mutating the service result', async () => {
        const plainUser = {
          id: 'prisma-id',
          email: 'test@example.com',
          password: 'password-hash',
          reset_password_token: 'reset-token',
          email_verification_token: 'verification-token',
          mfa: {
            enabled: true,
            preferred_method: 'totp',
            methods: {
              totp: {
                enabled: true,
                secret: 'totp-secret',
                verified_at: '2026-08-05T00:00:00.000Z',
              },
              webauthn: {
                enabled: true,
                credentials: [{ credential_id: 'credential-id' }],
              },
            },
            email_otp: {
              hash: 'email-otp-hash',
              expires: '2026-08-05T00:05:00.000Z',
            },
          },
          recovery: {
            enabled: true,
            methods: ['backup_codes', 'secondary_email'],
            backup_codes: {
              codes: ['backup-code-hash'],
              generated_at: '2026-08-05T00:00:00.000Z',
            },
            secondary_email: {
              email: 'recovery@example.com',
              verified: false,
              verification_token: 'secondary-email-token',
            },
            sms: {
              phone_number: '+22900000000',
              verified: false,
              verification_code: 'sms-code',
            },
            security_questions: {
              questions: [
                {
                  id: 'question-id',
                  question_key: 'question.pet',
                  answer_hash: 'answer-hash',
                },
              ],
            },
          },
        };
        vi.mocked(deps.userService.findById).mockResolvedValue(plainUser);
        const res = createMockResponse();

        await controller.get(
          createMockRequest({ params: { user_id: 'prisma-id' } }),
          res,
          createMockNext()
        );

        const data = vi.mocked(res.json).mock.calls[0][0].data;
        expect(data).not.toHaveProperty('password');
        expect(data).not.toHaveProperty('reset_password_token');
        expect(data).not.toHaveProperty('email_verification_token');
        expect(data.mfa.methods.totp).not.toHaveProperty('secret');
        expect(data.mfa.methods.webauthn).not.toHaveProperty('credentials');
        expect(data.mfa).not.toHaveProperty('email_otp');
        expect(data.recovery.backup_codes).not.toHaveProperty('codes');
        expect(data.recovery.secondary_email).not.toHaveProperty(
          'verification_token'
        );
        expect(data.recovery.sms).not.toHaveProperty('verification_code');
        expect(
          data.recovery.security_questions.questions[0]
        ).not.toHaveProperty('answer_hash');

        expect(data.mfa.enabled).toBe(true);
        expect(data.mfa.methods.totp.verified_at).toBe(
          '2026-08-05T00:00:00.000Z'
        );
        expect(data.recovery.secondary_email.email).toBe(
          'recovery@example.com'
        );

        expect(plainUser.mfa.methods.totp.secret).toBe('totp-secret');
        expect(plainUser.mfa.methods.webauthn.credentials).toEqual([
          { credential_id: 'credential-id' },
        ]);
        expect(plainUser.recovery.backup_codes.codes).toEqual([
          'backup-code-hash',
        ]);
        expect(
          plainUser.recovery.security_questions.questions[0].answer_hash
        ).toBe('answer-hash');
      });

      it('should preserve disabled nested security metadata without adding fields', async () => {
        const plainUser = {
          id: 'minimal-security-state',
          mfa: { enabled: false, methods: {} },
          recovery: {
            enabled: false,
            security_questions: { questions: undefined },
          },
        };
        vi.mocked(deps.userService.findById).mockResolvedValue(plainUser);
        const res = createMockResponse();

        await controller.get(
          createMockRequest({
            params: { user_id: 'minimal-security-state' },
          }),
          res,
          createMockNext()
        );

        expect(vi.mocked(res.json).mock.calls[0][0].data).toEqual(plainUser);

        const recoveryOnlyUser = {
          id: 'recovery-disabled',
          recovery: { enabled: false },
        };
        vi.mocked(deps.userService.findById).mockResolvedValue(
          recoveryOnlyUser
        );
        const recoveryResponse = createMockResponse();

        await controller.get(
          createMockRequest({ params: { user_id: 'recovery-disabled' } }),
          recoveryResponse,
          createMockNext()
        );

        expect(vi.mocked(recoveryResponse.json).mock.calls[0][0].data).toEqual(
          recoveryOnlyUser
        );
      });

      it('should strip fields from object with toJSON (Mongoose-style)', async () => {
        const toJSON = vi.fn().mockReturnValue({
          _id: 'mongo-id',
          email: 'test@example.com',
          password: 'hashed',
        });
        const mongoUser = {
          $__: { internal: true },
          toJSON,
        };
        vi.mocked(deps.userService.findById).mockResolvedValue(mongoUser);
        const req = createMockRequest({ params: { user_id: 'mongo-id' } });
        const res = createMockResponse();
        await controller.get(req, res, createMockNext());
        const body = vi.mocked(res.json).mock.calls[0][0];
        expect(toJSON).toHaveBeenCalledOnce();
        expect(body.data.email).toBe('test@example.com');
        expect(body.data).not.toHaveProperty('$__');
        expect(body.data.password).toBeUndefined();
      });

      it('should strip fields from a Mongoose-style toObject result', async () => {
        const toObject = vi.fn().mockReturnValue({
          _id: 'mongo-object-id',
          email: 'object@example.com',
          password: 'hashed',
        });
        vi.mocked(deps.userService.findById).mockResolvedValue({ toObject });
        const res = createMockResponse();

        await controller.get(
          createMockRequest({ params: { user_id: 'mongo-object-id' } }),
          res,
          createMockNext()
        );

        expect(toObject).toHaveBeenCalledOnce();
        expect(vi.mocked(res.json).mock.calls[0][0].data).toEqual({
          _id: 'mongo-object-id',
          email: 'object@example.com',
        });
      });
    });

    describe('list — cursor field', () => {
      it('should use "id" as cursor field (not "_id")', async () => {
        const users = [
          { id: 'u1', email: 'a@test.com' },
          { id: 'u2', email: 'b@test.com' },
        ];
        vi.mocked(deps.userService.findWithPagination).mockResolvedValue(users);
        const req = createMockRequest({ query: { limit: '1' } });
        const res = createMockResponse();
        await controller.list(req, res, createMockNext());
        const body = vi.mocked(res.json).mock.calls[0][0];
        // has_more should be true (2 docs > limit 1), cursor should use 'id' key
        expect(body.pagination.has_more).toBe(true);
        const decoded = JSON.parse(
          Buffer.from(
            body.pagination.next_cursor.replace(/-/g, '+').replace(/_/g, '/'),
            'base64'
          ).toString()
        );
        expect(decoded.id).toBeDefined();
        expect(decoded._id).toBeUndefined();
      });
    });

    describe('create — id logging', () => {
      it('should prefer user.id over user._id for logging', async () => {
        const user = { id: 'prisma-id', email: 'test@example.com' };
        vi.mocked(deps.authService.registerManagedUser).mockResolvedValue(user);
        const req = createMockRequest({
          body: {
            email: 'test@example.com',
            password: 'ValidPass1!',
            username: 'testuser',
          },
        });
        const res = createMockResponse();
        await controller.create(req, res, createMockNext());
        expect(deps.logger.info).toHaveBeenCalledWith(
          'User created via API',
          expect.objectContaining({ user_id: 'prisma-id' })
        );
      });
    });
  });
});
