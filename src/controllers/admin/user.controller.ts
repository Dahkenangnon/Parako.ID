import { type Request, type Response } from 'express';
import { injectable, inject } from 'inversify';
import { randomUUID } from 'node:crypto';
import type { ILogger } from '../../di/interfaces/logger.interface.js';
import type { IUserService } from '../../di/interfaces/user-service.interface.js';
import type { IActivityService } from '../../di/interfaces/activity-service.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { IPasswordUtils } from '../../di/interfaces/password-utils.interface.js';
import type { IClientDeviceInfoManager } from '../../di/interfaces/client-device-info-manager.interface.js';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IAdminUsersController } from '../../di/interfaces/admin-users-controller.interface.js';
import type { IOIDCAdapterBridge } from '../../di/interfaces/oidc-adapter-bridge.interface.js';
import type { IRedisPubSubService } from '../../di/interfaces/redis-pubsub-service.interface.js';
import { TYPES } from '../../di/types.js';
import { type IUser } from '../../types/user.js';
import { validateIdentifier } from '../../utils/custom-identifier-validation.js';
import {
  ADMIN_USER_SORT_FIELDS,
  parsePositiveInt,
  escapeRegExp,
  extractListingQuery,
} from '../../validators/listing-query.js';
import { activityLoggerFor } from '../../utils/activity-logger.factory.js';
import { flashAndRedirect } from '../../utils/flash-redirect.js';

interface UserActivityTarget {
  username: string;
  email?: string;
  full_name?: string;
}

/**
 * Admin Users Controller
 * Handles all user management operations for admin panel
 */
@injectable()
export class AdminUsersController implements IAdminUsersController {
  private readonly originId = randomUUID();

  private get redisPrefix(): string {
    return this.configManager.getConfig().deployment?.redis_prefix || 'parako';
  }

  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.ActivityService)
    private readonly activityService: IActivityService,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.PasswordUtils) private readonly passwordUtils: IPasswordUtils,
    @inject(TYPES.ClientDeviceInfoManager)
    private readonly clientDeviceInfoManager: IClientDeviceInfoManager,
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapter: IOIDCAdapterBridge,
    @inject(TYPES.RedisPubSubService)
    private readonly pubsub: IRedisPubSubService
  ) {}

  private get activityLoggerDeps() {
    return {
      activityService: this.activityService,
      sessionManager: this.sessionManager,
      clientDeviceInfoManager: this.clientDeviceInfoManager,
    };
  }

  private logUserActivity(
    req: Request,
    type: string,
    description: string,
    user: IUser,
    target: UserActivityTarget
  ): void {
    activityLoggerFor(this.activityLoggerDeps, req, {
      defaultActorType: 'admin',
    }).success(type, user, description, {
      target: {
        target_type: 'user',
        ...target,
      },
    });
  }

  private publishUserInvalidation(
    username: string,
    action: string,
    step: string
  ): void {
    if (!this.pubsub?.isConnected()) return;
    this.pubsub
      .publish(`${this.redisPrefix}:user:invalidated`, {
        originId: this.originId,
        username,
        action,
      })
      .catch((err: unknown) => {
        this.logger.warn('Pubsub broadcast of user invalidation failed', {
          step,
          username,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }

  /**
   * List all users with pagination, search, and filtering
   * GET /admin/users
   */
  public list = async (req: Request, res: Response): Promise<void> => {
    const { page, limit, search, sortBy, sortOrder } = extractListingQuery(
      req.query,
      ADMIN_USER_SORT_FIELDS,
      { sortBy: 'created_at' }
    );
    const role = ((req.query.role as string) || '').trim();
    const status = ((req.query.status as string) || '').trim();

    const filter: any = {};

    // OWASP ReDoS: escape user-controlled input before $regex.
    if (search) {
      const safeSearch = new RegExp(escapeRegExp(search), 'i');
      filter.$or = [
        { username: { $regex: safeSearch } },
        { email: { $regex: safeSearch } },
        { name: { $regex: safeSearch } },
        { given_name: { $regex: safeSearch } },
        { family_name: { $regex: safeSearch } },
      ];
    }

    if (role && role !== 'all') {
      filter.roles = { $in: [role] };
    }

    if (status && status !== 'all') {
      switch (status) {
        case 'active':
          filter.account_enabled = true;
          filter.account_is_anonymized = false;
          break;
        case 'disabled':
          filter.account_enabled = false;
          break;
        case 'anonymized':
          filter.account_is_anonymized = true;
          break;
      }
    }

    const sort: any = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const result = await this.userService.findWithPagination(filter, {
      page,
      limit,
      sort,
    });

    const stats = await this.userService.getUserStatistics();

    res.render('admin/users/index', {
      title: 'User Management',
      users: result.results,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        totalResults: result.totalResults,
        hasNextPage: result.page < result.totalPages,
        hasPrevPage: result.page > 1,
        nextPage: result.page + 1,
        prevPage: result.page - 1,
      },
      filters: {
        search,
        role: role || 'all',
        status: status || 'all',
        sortBy,
        sortOrder,
      },
      roles: [
        'all',
        ...this.configManager.getConfig().security.authentication.roles
          .available,
      ],
      stats,
      customIdentifierFields: this.userService.getCustomIdentifierFields(),
    });
  };

  /**
   * Show user details
   * GET /admin/users/:id
   */
  public show = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    if (!id) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        'User ID is required',
        '/admin/users'
      );
    }

    const user = await this.userService.findById(id);
    if (!user) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        'User not found',
        '/admin/users'
      );
    }

    const activities = await this.activityService.getUserActivities(id, {
      limit: 5,
      page: 1,
    });

    res.render('admin/users/show', {
      title: 'User details',
      user,
      activities: activities.results,
      customIdentifierFields: this.userService.getCustomIdentifierFields(),
    });
  };

  /**
   * Show create user form
   * GET /admin/users/new
   */
  public create = async (_req: Request, res: Response): Promise<void> => {
    const roles =
      this.configManager.getConfig().security.authentication.roles.available;
    const customIdentifierFields = this.userService.getCustomIdentifierFields();

    res.render('admin/users/create', {
      title: 'Create New User',
      roles,
      customIdentifierFields,
    });
  };

  /**
   * Store new user
   * POST /admin/users
   */
  public store = async (req: Request, res: Response): Promise<void> => {
    const {
      email,
      given_name,
      family_name,
      gender,
      birthdate,
      roles: userRoles,
      password,
      account_enabled = true,
    } = req.body;

    const existingUser = await this.userService.findOne({ email });

    if (existingUser) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        'Email already exists',
        '/admin/users/new'
      );
    }

    const hashedPassword = await this.passwordUtils.hashPassword(password);

    const userData: Partial<IUser> = {
      email,
      given_name,
      family_name,
      password: hashedPassword,
      password_hash_algo: 'argon2id',
      password_updated_at: new Date(),
      roles: Array.isArray(userRoles)
        ? userRoles.map((r: string) => r.trim())
        : [(userRoles || 'user').trim()],
      account_enabled: account_enabled === 'true',
      email_verified: true, // Admin created users are pre-verified
      auth_provider: 'local',
    };

    const optionalTrimmed: Array<keyof IUser> = [
      'middle_name',
      'nickname',
      'phone_number',
      'profile',
      'website',
      'picture',
      'country',
      'region',
      'city',
      'postal_code',
      'street_address',
      'locale',
      'zoneinfo',
    ];
    for (const key of optionalTrimmed) {
      const value = (req.body as Record<string, unknown>)[key as string];
      if (typeof value === 'string' && value.trim()) {
        (userData as Record<string, unknown>)[key as string] = value.trim();
      }
    }
    if (gender && ['M', 'F'].includes(gender)) {
      userData.gender = gender;
    }
    if (birthdate) {
      userData.birthdate = new Date(birthdate);
    }

    const ciError = await this.applyCustomIdentifiers(req, userData, undefined);
    if (ciError) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        ciError,
        '/admin/users/new'
      );
    }

    const newUser =
      await this.userService.createUserWithGeneratedUsername(userData);

    this.logUserActivity(
      req,
      'user_created_by_admin',
      'Admin created new user',
      newUser,
      {
        username: newUser.username,
        email: newUser.email,
        full_name: newUser.name,
      }
    );

    return flashAndRedirect(
      { sessionManager: this.sessionManager },
      req,
      res,
      'success',
      `User ${newUser.username} created successfully`,
      `/admin/users/${newUser._id}`
    );
  };

  /**
   * Show edit user form
   * GET /admin/users/:id/edit
   */
  public edit = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const user = await this.userService.findOne(id);

    if (!user) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        'User not found',
        '/admin/users'
      );
    }

    const roles =
      this.configManager.getConfig().security.authentication.roles.available;
    const customIdentifierFields = this.userService.getCustomIdentifierFields();

    res.render('admin/users/edit', {
      title: 'Edit User',
      user,
      roles,
      customIdentifierFields,
    });
  };

  /**
   * Update user
   * PUT /admin/users/:id
   */
  public update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const {
      email,
      given_name,
      family_name,
      gender,
      birthdate,
      roles: userRoles,
      account_enabled,
      new_password,
      password_force_reset,
    } = req.body;

    const user = await this.userService.findOne(id);
    if (!user) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        'User not found',
        '/admin/users'
      );
    }

    const updateData: Partial<IUser> = {
      email,
      given_name,
      family_name,
      roles: Array.isArray(userRoles)
        ? userRoles.map((r: string) => r.trim())
        : [(userRoles || 'user').trim()],
      account_enabled: account_enabled === 'true',
    };

    const optionalUpdates: Array<keyof IUser> = [
      'middle_name',
      'nickname',
      'phone_number',
      'profile',
      'website',
      'picture',
      'country',
      'region',
      'city',
      'postal_code',
      'street_address',
      'locale',
      'zoneinfo',
    ];
    const bodyRecord = req.body as Record<string, unknown>;
    for (const key of optionalUpdates) {
      const value = bodyRecord[key as string];
      if (value !== undefined) {
        (updateData as Record<string, unknown>)[key as string] =
          typeof value === 'string' && value.trim() ? value.trim() : undefined;
      }
    }
    if (gender !== undefined) {
      updateData.gender =
        gender && ['M', 'F'].includes(gender) ? gender : undefined;
    }
    if (birthdate !== undefined) {
      updateData.birthdate = birthdate ? new Date(birthdate) : undefined;
    }

    if (password_force_reset !== undefined) {
      updateData.password_force_reset = password_force_reset === 'true';
    }

    if (updateData.password_force_reset) {
      this.publishUserInvalidation(
        user.username,
        'force_password_reset',
        'admin-user-force-password-reset-broadcast'
      );
    }

    if (new_password && new_password.trim()) {
      updateData.password = await this.passwordUtils.hashPassword(new_password);
      updateData.password_hash_algo = 'argon2id';
      updateData.password_updated_at = new Date();
      updateData.password_force_reset = false;
    }

    const ciError = await this.applyCustomIdentifiers(req, updateData, id);
    if (ciError) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        ciError,
        `/admin/users/${id}/edit`
      );
    }

    let updatedUser;
    try {
      updatedUser = await this.userService.updateWithAssignment(id, updateData);
    } catch (updateError) {
      this.logger.error(updateError as Error, {
        context: 'user_update_failed',
        userId: id,
      });
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        `Failed to update user: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`,
        `/admin/users/${id}/edit`
      );
    }

    if (!updatedUser) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        'Failed to update user',
        `/admin/users/${id}/edit`
      );
    }

    this.logUserActivity(
      req,
      'user_updated_by_admin',
      'Admin updated user',
      updatedUser,
      {
        username: updatedUser.username,
        email: updatedUser.email,
        full_name: updatedUser.name,
      }
    );

    return flashAndRedirect(
      { sessionManager: this.sessionManager },
      req,
      res,
      'success',
      'User updated successfully',
      `/admin/users/${id}`
    );
  };

  /**
   * Enable user account.
   * POST /admin/users/:id/enable — JSON endpoint consumed by admin UI.
   */
  public enable = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const user = await this.userService.findOne(id);

      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (user.account_enabled) {
        res.json({ success: false, error: 'User is already enabled' });
        return;
      }

      const updatedUser = await this.userService.updateById(id, {
        account_enabled: true,
      });

      if (!updatedUser) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to enable user' });
        return;
      }

      this.logUserActivity(
        req,
        'user_enabled_by_admin',
        'Admin enabled user',
        updatedUser,
        {
          username: updatedUser.username,
          email: updatedUser.email,
          full_name: updatedUser.name,
        }
      );

      res.json({ success: true, message: 'User enabled successfully' });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_enable_failed',
        userId: req.params.id,
      });
      res.status(500).json({ success: false, error: 'Failed to enable user' });
    }
  };

  /**
   * Disable user account.
   * POST /admin/users/:id/disable — JSON endpoint consumed by admin UI.
   */
  public disable = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const user = await this.userService.findOne(id);

      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (!user.account_enabled) {
        res.json({ success: false, error: 'User is already disabled' });
        return;
      }

      const updatedUser = await this.userService.updateById(id, {
        account_enabled: false,
      });

      if (!updatedUser) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to disable user' });
        return;
      }

      let revokedSessionsCount = 0;
      try {
        const oidcResult =
          await this.oidcAdapter.session.deleteSessionsByAccountId(
            updatedUser.username
          );
        revokedSessionsCount += oidcResult.deletedCount;

        const expressSessionsRevoked =
          await this.sessionManager.revokeAllSessionsForUser(
            updatedUser.username
          );
        revokedSessionsCount += expressSessionsRevoked;

        if (revokedSessionsCount > 0) {
          this.logger.info('Revoked all sessions for disabled user', {
            username: updatedUser.username,
            revokedSessionsCount,
          });
        }
      } catch (sessionError) {
        this.logger.error(sessionError as Error, {
          context: 'session_revocation_for_disabled_user_failed',
          username: updatedUser.username,
        });
        // Session revocation failure does not block the user-disable result.
      }

      this.publishUserInvalidation(
        updatedUser.username,
        'disabled',
        'admin-user-disable-broadcast'
      );

      this.logUserActivity(
        req,
        'user_disabled_by_admin',
        'Admin disabled user',
        updatedUser,
        {
          username: updatedUser.username,
          email: updatedUser.email,
          full_name: updatedUser.name,
        }
      );

      res.json({ success: true, message: 'User disabled successfully' });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_disable_failed',
        userId: req.params.id,
      });
      res.status(500).json({ success: false, error: 'Failed to disable user' });
    }
  };

  /**
   * Delete user (soft delete/anonymize).
   * DELETE /admin/users/:id — JSON endpoint consumed by admin UI.
   */
  public destroy = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const user = await this.userService.findOne(id);

      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (user.account_is_anonymized) {
        res.json({ success: false, error: 'User is already anonymized' });
        return;
      }

      const anonymizedUser = await this.userService.updateById(id, {
        account_is_anonymized: true,
        family_name: 'Anonymized',
        given_name: 'Anonymized',
        nickname: 'Anonymized',
        middle_name: 'Anonymized',
        gender: 'M',
        birthdate: new Date('1970-01-01'),
        email: `anon-${Date.now()}_${user.email}`,
        phone_number: 'Anonymized',
        profile: 'Anonymized',
        website: 'Anonymized',
        picture: 'Anonymized',
        address: 'Anonymized',
        street_address: 'Anonymized',
        city: 'Anonymized',
        region: 'Anonymized',
        postal_code: 'Anonymized',
        country: 'Anonymized',
        locale: 'Anonymized',
        zoneinfo: 'Anonymized',
        custom_identifier_1: undefined,
        custom_identifier_2: undefined,
        custom_identifier_3: undefined,
        register_with: 'email',
        theme: 'light',
        auth_provider: 'local',
      });

      if (!anonymizedUser) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to anonymize user' });
        return;
      }

      this.publishUserInvalidation(
        user.username,
        'deleted',
        'admin-user-delete-broadcast'
      );

      this.logUserActivity(
        req,
        'user_anonymized_by_admin',
        'Admin anonymized user',
        anonymizedUser,
        {
          username: user.username,
          email: user.email,
          full_name: user.name,
        }
      );

      res.json({ success: true, message: 'User anonymized successfully' });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_anonymize_failed',
        userId: req.params.id,
      });
      res
        .status(500)
        .json({ success: false, error: 'Failed to anonymize user' });
    }
  };

  /**
   * Show user activities
   * GET /admin/users/:id/activities
   */
  public activities = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const page = parsePositiveInt(req.query.page, {
      default: 1,
      min: 1,
      max: 10_000,
    });
    const limit = parsePositiveInt(req.query.limit, {
      default: 50,
      min: 1,
      max: 100,
    });
    const type = req.query.type as string;

    const user = await this.userService.findOne(id);
    if (!user) {
      return flashAndRedirect(
        { sessionManager: this.sessionManager },
        req,
        res,
        'error',
        'User not found',
        '/admin/users'
      );
    }

    const filter: any = { 'actor.user_id': id };
    if (type && type !== 'all') {
      filter.type = type;
    }

    const activities = await this.activityService.queryActivities(filter, {
      page,
      limit,
      sort: { timestamp: -1 },
    });

    const activityTypes = await this.activityService.getUserActivityTypes(
      user.username
    );

    const processedActivities = activities.results.map((activity: any) => {
      if (activity.device_infos && typeof activity.device_infos === 'object') {
        activity.device_infos = {
          ...activity.device_infos,
          browser: activity.device_infos.browser || {},
          os: activity.device_infos.os || {},
          device: activity.device_infos.device || {},
          screen: activity.device_infos.screen || {},
          geo_location: activity.device_infos.geo_location || {},
        };
      }

      if (activity.timestamp && typeof activity.timestamp === 'string') {
        activity.timestamp = new Date(activity.timestamp);
      }

      return activity;
    });

    res.render('admin/users/activities', {
      title: `${user.name || user.username} - Activities`,
      user,
      activities: processedActivities,
      pagination: {
        page: activities.page,
        limit: activities.limit,
        totalPages: activities.totalPages,
        totalResults: activities.totalResults,
        hasNextPage: activities.page < activities.totalPages,
        hasPrevPage: activities.page > 1,
        nextPage: activities.page + 1,
        prevPage: activities.page - 1,
      },
      filters: {
        type: type || 'all',
      },
      activityTypes: ['all', ...activityTypes],
    });
  };

  /**
   * Validate and apply custom-identifier slot values from the form body to
   * `target`. Returns an error message if any field is invalid or already
   * taken; otherwise `null`. Pass `excludeUserId` on update so the user
   * being edited does not collide with their own existing value.
   */
  private async applyCustomIdentifiers(
    req: Request,
    target: Partial<IUser>,
    excludeUserId: string | undefined
  ): Promise<string | null> {
    const ciFields = this.userService.getCustomIdentifierFields();
    const bodyRecord = req.body as Record<string, unknown>;

    for (const field of ciFields) {
      const slotKey = `custom_identifier_${field.slot}` as
        'custom_identifier_1' | 'custom_identifier_2' | 'custom_identifier_3';
      const rawValue = bodyRecord[slotKey];

      // Create: only set when a value is provided; Update: also clear when
      // the form sends an empty string.
      if (excludeUserId === undefined && rawValue === undefined) continue;
      if (
        rawValue !== undefined &&
        (typeof rawValue !== 'string' || !rawValue.trim())
      ) {
        if (excludeUserId !== undefined) {
          (target as Record<string, unknown>)[slotKey] = undefined;
        }
        continue;
      }

      const trimmed = (rawValue as string).trim();
      const normalized = field.case_sensitive ? trimmed : trimmed.toLowerCase();

      if (!validateIdentifier(normalized, field)) {
        return `Invalid ${field.name || 'identifier'} format`;
      }

      const isAvailable = await this.userService.isCustomIdentifierAvailable(
        field.slot as 1 | 2 | 3,
        normalized,
        excludeUserId
      );
      if (!isAvailable) {
        return `This ${field.name || 'identifier'} is already in use by another user`;
      }

      (target as Record<string, unknown>)[slotKey] = normalized;
    }

    return null;
  }
}
