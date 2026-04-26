import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { UsersController } from '../../../../../src/api/v1/controllers/users.controller.js';
import type { UsersControllerDeps } from '../../../../../src/api/v1/controllers/users.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      adminChangeUserPassword: vi.fn().mockResolvedValue(undefined),
    },
    activityService: {
      getUserActivities: vi.fn().mockResolvedValue([]),
    },
    oidcAdapter: {
      session: {
        findSessionsByAccountId: vi.fn().mockResolvedValue([]),
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

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/controllers/UsersController', () => {
  let deps: UsersControllerDeps;
  let controller: UsersController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new UsersController(deps);
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create()', () => {
    it('should create a user and return 201 with sensitive fields stripped', async () => {
      const created = { ...sampleUser };
      vi.mocked(deps.authService.registerUser).mockResolvedValue(created);

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

      expect(deps.authService.registerUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jane@example.com' })
      );
      expect(res.status).toHaveBeenCalledWith(201);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('password');
      expect(jsonCall.data).not.toHaveProperty('hashedPassword');
      expect(jsonCall.data.email).toBe('jane@example.com');
    });

    it('should log user creation', async () => {
      const created = { ...sampleUser };
      vi.mocked(deps.authService.registerUser).mockResolvedValue(created);

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

    it('should call next with Zod error when email is missing', async () => {
      const req = createMockRequest({
        body: { password: 'securepassword123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(deps.authService.registerUser).not.toHaveBeenCalled();
    });

    it('should call next with Zod error when password is too short', async () => {
      const req = createMockRequest({
        body: { email: 'jane@example.com', password: 'short' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const passedError = vi.mocked(next).mock.calls[0][0] as any;
      expect(passedError.issues).toBeDefined();
    });

    it('should call next(error) on service failure', async () => {
      const error = new Error('Registration failed');
      vi.mocked(deps.authService.registerUser).mockRejectedValue(error);

      const req = createMockRequest({
        body: { email: 'jane@example.com', password: 'securepassword123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // -----------------------------------------------------------------------
  // get
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update()', () => {
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

    it('should call next with Zod error when email is invalid', async () => {
      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body: { email: 'not-an-email' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(deps.userService.updateById).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // patch
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // destroy
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // lock
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // unlock
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // passwordReset
  // -----------------------------------------------------------------------
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

      expect(deps.authService.adminChangeUserPassword).toHaveBeenCalledWith(
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
      expect(deps.authService.adminChangeUserPassword).not.toHaveBeenCalled();
    });

    it('should call next with Zod error when new_password is too short', async () => {
      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body: { new_password: 'short' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.passwordReset(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const passedError = vi.mocked(next).mock.calls[0][0] as any;
      expect(passedError.issues).toBeDefined();
    });

    it('should call next with Zod error when new_password is missing', async () => {
      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
        body: {},
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.passwordReset(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // -----------------------------------------------------------------------
  // mfaReset
  // -----------------------------------------------------------------------
  describe('mfaReset()', () => {
    it('should reset MFA and return 200', async () => {
      const mfaDisabled = { ...sampleUser, mfa: { enabled: false } };
      vi.mocked(deps.userService.disableMfa).mockResolvedValue(mfaDisabled);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.mfaReset(req, res, next);

      expect(deps.userService.disableMfa).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.message).toBe('MFA has been reset');
    });

    it('should log MFA reset', async () => {
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
      vi.mocked(deps.userService.disableMfa).mockResolvedValue(null);

      const req = createMockRequest({ params: { user_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.mfaReset(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // activities
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // sessions
  // -----------------------------------------------------------------------
  describe('sessions()', () => {
    it('should return sessions for the user', async () => {
      vi.mocked(deps.userService.findById).mockResolvedValue({ ...sampleUser });

      const sessions = [
        {
          jti: 'sess-1',
          accountId: '507f1f77bcf86cd799439011',
          exp: 1741348800,
        },
        {
          jti: 'sess-2',
          accountId: '507f1f77bcf86cd799439011',
          exp: 1741352400,
        },
      ];
      vi.mocked(
        deps.oidcAdapter.session.findSessionsByAccountId!
      ).mockResolvedValue(sessions);

      const req = createMockRequest({
        params: { user_id: '507f1f77bcf86cd799439011' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.sessions(req, res, next);

      expect(deps.userService.findById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011'
      );
      expect(
        deps.oidcAdapter.session.findSessionsByAccountId
      ).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);
    });

    it('should return empty array when findSessionsByAccountId is not available', async () => {
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

  // -----------------------------------------------------------------------
  // DB abstraction
  // -----------------------------------------------------------------------
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

      it('should strip fields from object with toJSON (Mongoose-style)', async () => {
        const mongoUser = {
          _id: 'mongo-id',
          email: 'test@example.com',
          password: 'hashed',
          toJSON() {
            return {
              _id: this._id,
              email: this.email,
              password: this.password,
            };
          },
        };
        vi.mocked(deps.userService.findById).mockResolvedValue(mongoUser);
        const req = createMockRequest({ params: { user_id: 'mongo-id' } });
        const res = createMockResponse();
        await controller.get(req, res, createMockNext());
        const body = vi.mocked(res.json).mock.calls[0][0];
        expect(body.data.password).toBeUndefined();
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
        vi.mocked(deps.authService.registerUser).mockResolvedValue(user);
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
