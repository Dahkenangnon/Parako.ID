/**
 * Users controller — Management API v1.
 *
 * User account management: paginated listing, creation, full and partial
 * updates, anonymization, lock/unlock, administrative password reset,
 * MFA reset, and per-user activity and session views.
 *
 * Dependencies are injected via the constructor to keep the class
 * independent of the DI container and straightforward to unit test.
 */

import type { Request, Response, NextFunction } from 'express';

import { notFound } from '../errors.js';
import { apiSuccess, apiCreated, apiList, apiNoContent } from '../response.js';
import {
  buildCursorQuery,
  buildCursorResponse,
  parsePaginationParams,
} from '../pagination.js';
import type {
  CreateUserInput,
  UpdateUserInput,
  PasswordResetInput,
} from '../validators/users.validator.js';

/** Service and logger dependencies required by {@link UsersController}. */
export interface UsersControllerDeps {
  userService: {
    findById(id: string): Promise<any>;
    updateById(id: string, data: any): Promise<any>;
    deactivate(id: string): Promise<any>;
    activate(id: string): Promise<any>;
    disableMfa(id: string): Promise<any>;
    anonymize(id: string): Promise<any>;
    findWithPagination(filter: any, options: any): Promise<any>;
  };
  authService: {
    registerUser(data: any): Promise<any>;
    adminChangeUserPassword(
      adminUsername: string,
      userId: string,
      password: string,
      options?: any
    ): Promise<any>;
  };
  activityService: {
    getUserActivities(userId: string, options?: any): Promise<any>;
  };
  oidcAdapter: {
    session: {
      findSessionsByAccountId?(accountId: string): Promise<any[]>;
    };
  };
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
  };
}

/**
 * Strip sensitive fields from a user document.
 *
 * Handles both plain objects and Mongoose documents (which expose
 * `.toJSON()`). Returns the input untouched when it is falsy.
 */
function stripSensitiveFields(user: any): any {
  if (!user) return user;

  const obj = { ...user };

  delete obj.password;
  delete obj.hashedPassword;

  if (obj.mfa) {
    delete obj.mfa.secret;
    delete obj.mfa.recovery_codes;
  }

  if (obj.webauthn) {
    delete obj.webauthn.credentials;
  }

  return obj;
}

export class UsersController {
  private readonly userService: UsersControllerDeps['userService'];
  private readonly authService: UsersControllerDeps['authService'];
  private readonly activityService: UsersControllerDeps['activityService'];
  private readonly oidcAdapter: UsersControllerDeps['oidcAdapter'];
  private readonly logger: UsersControllerDeps['logger'];

  constructor(deps: UsersControllerDeps) {
    this.userService = deps.userService;
    this.authService = deps.authService;
    this.activityService = deps.activityService;
    this.oidcAdapter = deps.oidcAdapter;
    this.logger = deps.logger;
  }

  /** List users with cursor-based pagination and optional filters. */
  list = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { limit, cursor, includeCount } = parsePaginationParams(
        req.query as Record<string, unknown>
      );

      const filters: Record<string, unknown> = {
        ...buildCursorQuery(cursor),
      };

      if (req.query.account_enabled !== undefined) {
        filters.account_enabled = req.query.account_enabled === 'true';
      }

      if (
        typeof req.query.role === 'string' &&
        req.query.role.length > 0 &&
        req.query.role.length <= 50
      ) {
        filters.role = req.query.role;
      }

      if (
        typeof req.query.auth_provider === 'string' &&
        req.query.auth_provider.length > 0 &&
        req.query.auth_provider.length <= 50
      ) {
        filters.auth_provider = req.query.auth_provider;
      }

      // Full-text search via `q` parameter — passed as a DB-agnostic
      // appropriate database query ($regex for MongoDB, ILIKE/contains
      // for SQL).
      if (typeof req.query.q === 'string' && req.query.q.trim().length > 0) {
        const searchTerm = req.query.q.trim().slice(0, 200);
        filters.searchTerm = searchTerm;
        filters.searchFields = ['email', 'username', 'name'];
      }

      const result = await this.userService.findWithPagination(filters, {
        page: 1,
        limit: limit + 1,
      });

      const docs = Array.isArray(result) ? result : (result.results ?? []);
      const totalCount = includeCount
        ? (result.totalResults ?? undefined)
        : undefined;

      const page = buildCursorResponse(
        docs.map(stripSensitiveFields),
        limit,
        'id',
        totalCount
      );

      apiList(res, page);
    } catch (error) {
      next(error);
    }
  };

  // POST /users

  /** Create a new user. Returns the user with sensitive fields stripped. */
  create = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Body already validated by validateBody(createUserSchema) at the route.
      const body = req.body as CreateUserInput;
      const user = await this.authService.registerUser(body);

      this.logger.info('User created via API', {
        user_id: user.id ?? user._id,
      });

      apiCreated(res, stripSensitiveFields(user));
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve a single user by ID. */
  get = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.userService.findById(req.params.user_id);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      apiSuccess(res, stripSensitiveFields(user));
    } catch (error) {
      next(error);
    }
  };

  // PUT /users/:user_id

  /** Full update of a user (all mutable fields replaced). */
  update = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = req.body as UpdateUserInput;
      const user = await this.userService.updateById(req.params.user_id, body);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      apiSuccess(res, stripSensitiveFields(user));
    } catch (error) {
      next(error);
    }
  };

  // PATCH /users/:user_id

  /** Partial update — only supplied fields are modified. */
  patch = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = req.body as UpdateUserInput;
      const user = await this.userService.updateById(req.params.user_id, body);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      apiSuccess(res, stripSensitiveFields(user));
    } catch (error) {
      next(error);
    }
  };

  /** Destroy (anonymize) a user account. Returns 204 No Content. */
  destroy = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.userService.findById(req.params.user_id);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      await this.userService.anonymize(req.params.user_id);

      this.logger.info('User destroyed via API', {
        user_id: req.params.user_id,
      });

      apiNoContent(res);
    } catch (error) {
      next(error);
    }
  };

  // POST /users/:user_id/lock

  /** Lock (deactivate) a user account. */
  lock = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.userService.deactivate(req.params.user_id);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      this.logger.info('User locked via API', { user_id: req.params.user_id });

      apiSuccess(res, stripSensitiveFields(user));
    } catch (error) {
      next(error);
    }
  };

  /** Unlock (activate) a user account. */
  unlock = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.userService.activate(req.params.user_id);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      this.logger.info('User unlocked via API', {
        user_id: req.params.user_id,
      });

      apiSuccess(res, stripSensitiveFields(user));
    } catch (error) {
      next(error);
    }
  };

  // POST /users/:user_id/password-reset

  /** Administrative password reset — sets a new password for the user. */
  passwordReset = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { new_password } = req.body as PasswordResetInput;

      const user = await this.userService.findById(req.params.user_id);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      const adminUsername = req.apiAuth?.client_id ?? 'api';

      await this.authService.adminChangeUserPassword(
        adminUsername,
        req.params.user_id,
        new_password
      );

      this.logger.info('User password reset via API', {
        user_id: req.params.user_id,
        admin: adminUsername,
      });

      apiSuccess(res, { message: 'Password has been reset' });
    } catch (error) {
      next(error);
    }
  };

  // POST /users/:user_id/mfa/reset

  /** Reset MFA for a user — disables TOTP and clears recovery codes. */
  mfaReset = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.userService.disableMfa(req.params.user_id);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      this.logger.info('User MFA reset via API', {
        user_id: req.params.user_id,
      });

      apiSuccess(res, { message: 'MFA has been reset' });
    } catch (error) {
      next(error);
    }
  };

  /** List activity log entries for a specific user. */
  activities = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.userService.findById(req.params.user_id);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      const { limit, includeCount } = parsePaginationParams(
        req.query as Record<string, unknown>
      );

      const result = await this.activityService.getUserActivities(
        req.params.user_id,
        {
          limit: limit + 1,
          page: 1,
        }
      );

      const docs = Array.isArray(result) ? result : (result.results ?? []);
      const totalCount = includeCount
        ? (result.totalResults ?? undefined)
        : undefined;

      const page = buildCursorResponse(docs, limit, 'id', totalCount);

      apiList(res, page);
    } catch (error) {
      next(error);
    }
  };

  /** List active OIDC sessions for a specific user. */
  sessions = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.userService.findById(req.params.user_id);

      if (!user) {
        throw notFound(`User '${req.params.user_id}' not found`);
      }

      const sessionAdapter = this.oidcAdapter.session;

      if (!sessionAdapter.findSessionsByAccountId) {
        apiSuccess(res, []);
        return;
      }

      const sessions = await sessionAdapter.findSessionsByAccountId(
        req.params.user_id
      );

      apiSuccess(res, sessions ?? []);
    } catch (error) {
      next(error);
    }
  };
}
