import { type Request, type Response } from 'express';
import { injectable, inject } from 'inversify';
import { validationResult } from 'express-validator';
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
  parsePositiveInt,
  parseEnum,
  escapeRegExp,
} from '../../utils/query-parse.js';
import { SORT_ORDER_VALUES } from '../../middlewares/validation.middleware.js';

const ADMIN_USER_LIST_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'username',
  'email',
  'last_login_at',
] as const;

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

  /**
   * List all users with pagination, search, and filtering
   * GET /admin/users
   */
  public list = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parsePositiveInt(req.query.page, {
        default: 1,
        min: 1,
        max: 10_000,
      });
      const limit = parsePositiveInt(req.query.limit, {
        default: 20,
        min: 1,
        max: 100,
      });
      const search = ((req.query.search as string) || '').trim().slice(0, 200);
      const role = ((req.query.role as string) || '').trim();
      const status = ((req.query.status as string) || '').trim();
      const sortBy = parseEnum(
        req.query.sortBy,
        ADMIN_USER_LIST_SORT_FIELDS,
        'created_at'
      );
      const sortOrder = parseEnum(
        req.query.sortOrder,
        SORT_ORDER_VALUES,
        'desc'
      );

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
          search: search || '',
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
    } catch (error) {
      this.logger.error(error as Error, { context: 'users_listing_failed' });
      this.sessionManager.flash(req).error('Failed to load users');
      res.redirect('/admin');
    }
  };

  /**
   * Show user details
   * GET /admin/users/:id
   */
  public show = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        this.sessionManager.flash(req).error('User ID is required');
        res.redirect('/admin/users');
        return;
      }

      const user = await this.userService.findById(id);
      if (!user) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect('/admin/users');
        return;
      }

      const activities = await this.activityService.getUserActivities(id, {
        limit: 5,
        page: 1,
      });

      res.render('admin/users/show', {
        title: `User details`,
        user,
        activities: activities.results,
        customIdentifierFields: this.userService.getCustomIdentifierFields(),
      });
    } catch (error) {
      this.logger.error('Error showing user', {
        error: (error as Error).message,
      });
      this.sessionManager.flash(req).error('Error loading user');
      res.redirect('/admin/users');
    }
  };

  /**
   * Show create user form
   * GET /admin/users/new
   */
  public create = async (req: Request, res: Response): Promise<void> => {
    try {
      const roles =
        this.configManager.getConfig().security.authentication.roles.available;
      const customIdentifierFields =
        this.userService.getCustomIdentifierFields();

      res.render('admin/users/create', {
        title: 'Create New User',
        roles,
        customIdentifierFields,
      });
    } catch (error) {
      this.logger.error('Error showing create user form', {
        error: (error as Error).message,
      });
      this.sessionManager.flash(req).error('Error loading create user form');
      res.redirect('/admin/users');
    }
  };

  /**
   * Store new user
   * POST /admin/users
   */
  public store = async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        this.sessionManager.flash(req).error(
          errors
            .array()
            .map(err => err.msg)
            .join(', ')
        );
        res.redirect('/admin/users/new');
        return;
      }

      const {
        email,
        given_name,
        family_name,
        middle_name,
        nickname,
        gender,
        birthdate,
        phone_number,
        profile,
        website,
        picture,
        country,
        region,
        city,
        postal_code,
        street_address,
        locale,
        zoneinfo,
        roles: userRoles,
        password,
        account_enabled = true,
      } = req.body;

      const existingUser = await this.userService.findOne({ email });

      if (existingUser) {
        this.sessionManager.flash(req).error('Email already exists');
        res.redirect('/admin/users/new');
        return;
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

      if (middle_name && middle_name.trim()) {
        userData.middle_name = middle_name.trim();
      }
      if (nickname && nickname.trim()) {
        userData.nickname = nickname.trim();
      }
      if (gender && ['M', 'F'].includes(gender)) {
        userData.gender = gender;
      }
      if (birthdate) {
        userData.birthdate = new Date(birthdate);
      }
      if (phone_number && phone_number.trim()) {
        userData.phone_number = phone_number.trim();
      }
      if (profile && profile.trim()) {
        userData.profile = profile.trim();
      }
      if (website && website.trim()) {
        userData.website = website.trim();
      }
      if (picture && picture.trim()) {
        userData.picture = picture.trim();
      }
      if (country && country.trim()) {
        userData.country = country.trim();
      }
      if (region && region.trim()) {
        userData.region = region.trim();
      }
      if (city && city.trim()) {
        userData.city = city.trim();
      }
      if (postal_code && postal_code.trim()) {
        userData.postal_code = postal_code.trim();
      }
      if (street_address && street_address.trim()) {
        userData.street_address = street_address.trim();
      }
      if (locale && locale.trim()) {
        userData.locale = locale.trim();
      }
      if (zoneinfo && zoneinfo.trim()) {
        userData.zoneinfo = zoneinfo.trim();
      }

      const ciFields = this.userService.getCustomIdentifierFields();
      for (const field of ciFields) {
        const rawValue = req.body[`custom_identifier_${field.slot}`];
        if (rawValue && rawValue.trim()) {
          const trimmed = rawValue.trim();
          const normalized = field.case_sensitive
            ? trimmed
            : trimmed.toLowerCase();

          if (!validateIdentifier(normalized, field)) {
            this.sessionManager
              .flash(req)
              .error(`Invalid ${field.name || 'identifier'} format`);
            res.redirect('/admin/users/new');
            return;
          }

          const isAvailable =
            await this.userService.isCustomIdentifierAvailable(
              field.slot as 1 | 2 | 3,
              normalized
            );
          if (!isAvailable) {
            this.sessionManager
              .flash(req)
              .error(
                `This ${field.name || 'identifier'} is already in use by another user`
              );
            res.redirect('/admin/users/new');
            return;
          }

          const slotKey = `custom_identifier_${field.slot}` as
            | 'custom_identifier_1'
            | 'custom_identifier_2'
            | 'custom_identifier_3';
          userData[slotKey] = normalized;
        }
      }

      const newUser =
        await this.userService.createUserWithGeneratedUsername(userData);

      const currentUser = this.sessionManager.getActiveUser(req);
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activityService.success(
        'user_created_by_admin',
        'Admin created new user',
        newUser,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'user',
            username: newUser.username,
            email: newUser.email,
            full_name: newUser.name,
          },
        }
      );

      this.sessionManager
        .flash(req)
        .success(`User ${newUser.username} created successfully`);
      res.redirect(`/admin/users/${newUser._id}`);
    } catch (error) {
      this.logger.error(error as Error, { context: 'user_creation_failed' });
      this.sessionManager.flash(req).error('Failed to create user');
      res.redirect('/admin/users/new');
    }
  };

  /**
   * Show edit user form
   * GET /admin/users/:id/edit
   */
  public edit = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const user = await this.userService.findOne(id);

      if (!user) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect('/admin/users');
        return;
      }

      const roles =
        this.configManager.getConfig().security.authentication.roles.available;
      const customIdentifierFields =
        this.userService.getCustomIdentifierFields();

      res.render('admin/users/edit', {
        title: `Edit User`,
        user,
        roles,
        customIdentifierFields,
      });
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'edit_user_form_loading_failed',
        userId: req.params.id,
      });
      this.sessionManager.flash(req).error('Failed to load edit user form');
      res.redirect('/admin/users');
    }
  };

  /**
   * Update user
   * PUT /admin/users/:id
   */
  public update = async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        this.sessionManager.flash(req).error(
          errors
            .array()
            .map(err => err.msg)
            .join(', ')
        );
        res.redirect(`/admin/users/${req.params.id}/edit`);
        return;
      }

      const { id } = req.params;
      const {
        email,
        given_name,
        family_name,
        middle_name,
        nickname,
        gender,
        birthdate,
        phone_number,
        profile,
        website,
        picture,
        country,
        region,
        city,
        postal_code,
        street_address,
        locale,
        zoneinfo,
        roles: userRoles,
        account_enabled,
        new_password,
        password_force_reset,
      } = req.body;

      const user = await this.userService.findOne(id);
      if (!user) {
        this.sessionManager.flash(req).error('User not found');
        res.redirect('/admin/users');
        return;
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

      if (middle_name !== undefined) {
        updateData.middle_name = middle_name.trim() || undefined;
      }
      if (nickname !== undefined) {
        updateData.nickname = nickname.trim() || undefined;
      }
      if (gender !== undefined) {
        updateData.gender =
          gender && ['M', 'F'].includes(gender) ? gender : undefined;
      }
      if (birthdate !== undefined) {
        updateData.birthdate = birthdate ? new Date(birthdate) : undefined;
      }
      if (phone_number !== undefined) {
        updateData.phone_number = phone_number.trim() || undefined;
      }
      if (profile !== undefined) {
        updateData.profile = profile.trim() || undefined;
      }
      if (website !== undefined) {
        updateData.website = website.trim() || undefined;
      }
      if (picture !== undefined) {
        updateData.picture = picture.trim() || undefined;
      }
      if (country !== undefined) {
        updateData.country = country.trim() || undefined;
      }
      if (region !== undefined) {
        updateData.region = region.trim() || undefined;
      }
      if (city !== undefined) {
        updateData.city = city.trim() || undefined;
      }
      if (postal_code !== undefined) {
        updateData.postal_code = postal_code.trim() || undefined;
      }
      if (street_address !== undefined) {
        updateData.street_address = street_address.trim() || undefined;
      }
      if (locale !== undefined) {
        updateData.locale = locale.trim() || undefined;
      }
      if (zoneinfo !== undefined) {
        updateData.zoneinfo = zoneinfo.trim() || undefined;
      }

      if (password_force_reset !== undefined) {
        updateData.password_force_reset = password_force_reset === 'true';
      }

      if (updateData.password_force_reset && this.pubsub?.isConnected()) {
        this.pubsub
          .publish(`${this.redisPrefix}:user:invalidated`, {
            originId: this.originId,
            username: user.username,
            action: 'force_password_reset',
          })
          .catch((err: unknown) => {
            this.logger.warn('Pubsub broadcast of user invalidation failed', {
              step: 'admin-user-force-password-reset-broadcast',
              username: user.username,
              err: err instanceof Error ? err.message : String(err),
            });
          });
      }

      if (new_password && new_password.trim()) {
        updateData.password =
          await this.passwordUtils.hashPassword(new_password);
        updateData.password_hash_algo = 'argon2id';
        updateData.password_updated_at = new Date();
        updateData.password_force_reset = false;
      }

      const ciFields = this.userService.getCustomIdentifierFields();
      for (const field of ciFields) {
        const slotKey = `custom_identifier_${field.slot}` as
          | 'custom_identifier_1'
          | 'custom_identifier_2'
          | 'custom_identifier_3';
        const rawValue = req.body[slotKey];
        if (rawValue !== undefined) {
          if (rawValue && rawValue.trim()) {
            const trimmed = rawValue.trim();
            const normalized = field.case_sensitive
              ? trimmed
              : trimmed.toLowerCase();

            if (!validateIdentifier(normalized, field)) {
              this.sessionManager
                .flash(req)
                .error(`Invalid ${field.name || 'identifier'} format`);
              res.redirect(`/admin/users/${id}/edit`);
              return;
            }

            const isAvailable =
              await this.userService.isCustomIdentifierAvailable(
                field.slot as 1 | 2 | 3,
                normalized,
                id
              );
            if (!isAvailable) {
              this.sessionManager
                .flash(req)
                .error(
                  `This ${field.name || 'identifier'} is already in use by another user`
                );
              res.redirect(`/admin/users/${id}/edit`);
              return;
            }

            (updateData as any)[slotKey] = normalized;
          } else {
            // If empty string, remove the custom identifier
            (updateData as any)[slotKey] = undefined;
          }
        }
      }

      let updatedUser;
      try {
        // Try using updateWithAssignment instead of updateById for better nested object handling
        updatedUser = await this.userService.updateWithAssignment(
          id,
          updateData
        );

        if (!updatedUser) {
          this.sessionManager.flash(req).error('Failed to update user');
          res.redirect(`/admin/users/${id}/edit`);
          return;
        }
      } catch (updateError) {
        this.logger.error('Error updating user', {
          error:
            updateError instanceof Error
              ? updateError.message
              : 'Unknown error',
          userId: id,
        });
        this.sessionManager
          .flash(req)
          .error(
            `Failed to update user: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`
          );
        res.redirect(`/admin/users/${id}/edit`);
        return;
      }

      const currentUser = this.sessionManager.getActiveUser(req);
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activityService.success(
        'user_updated_by_admin',
        'Admin updated user',
        updatedUser,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'user',
            username: updatedUser.username,
            email: updatedUser.email,
            full_name: updatedUser.name,
          },
        }
      );

      this.sessionManager.flash(req).success('User updated successfully');
      res.redirect(`/admin/users/${id}`);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_update_failed',
        userId: req.params.id,
      });
      this.sessionManager.flash(req).error('Failed to update user');
      res.redirect(`/admin/users/${req.params.id}/edit`);
    }
  };

  /**
   * Enable user account
   * POST /admin/users/:id/enable
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

      const currentUser = this.sessionManager.getActiveUser(req);
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activityService.success(
        'user_enabled_by_admin',
        'Admin enabled user',
        updatedUser,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'user',
            username: updatedUser.username,
            email: updatedUser.email,
            full_name: updatedUser.name,
          },
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
   * Disable user account
   * POST /admin/users/:id/disable
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

      // Immediately revoke all sessions for the disabled user
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
          context: 'Failed to revoke sessions for disabled user',
          username: updatedUser.username,
        });
        // Continue even if session revocation fails - user is still disabled
      }

      if (this.pubsub?.isConnected()) {
        this.pubsub
          .publish(`${this.redisPrefix}:user:invalidated`, {
            originId: this.originId,
            username: updatedUser.username,
            action: 'disabled',
          })
          .catch((err: unknown) => {
            this.logger.warn('Pubsub broadcast of user disable failed', {
              step: 'admin-user-disable-broadcast',
              username: updatedUser.username,
              err: err instanceof Error ? err.message : String(err),
            });
          });
      }

      const currentUser = this.sessionManager.getActiveUser(req);
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activityService.success(
        'user_disabled_by_admin',
        'Admin disabled user',
        updatedUser,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'user',
            username: updatedUser.username,
            email: updatedUser.email,
            full_name: updatedUser.name,
          },
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
   * Delete user (soft delete/anonymize)
   * DELETE /admin/users/:id
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
        email: `anon-${Date.now()}_${user.email}`, // We keep old email for reference
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

      if (this.pubsub?.isConnected()) {
        this.pubsub
          .publish(`${this.redisPrefix}:user:invalidated`, {
            originId: this.originId,
            username: user.username,
            action: 'deleted',
          })
          .catch((err: unknown) => {
            this.logger.warn('Pubsub broadcast of user deletion failed', {
              step: 'admin-user-delete-broadcast',
              username: user.username,
              err: err instanceof Error ? err.message : String(err),
            });
          });
      }

      const currentUser = this.sessionManager.getActiveUser(req);
      const deviceInfos =
        this.clientDeviceInfoManager.getClientInfoFromRequest(req);

      this.activityService.success(
        'user_anonymized_by_admin',
        'Admin anonymized user',
        anonymizedUser,
        {
          ip_address: deviceInfos.ip,
          user_agent: deviceInfos.user_agent,
          device_infos: deviceInfos,
          actor: {
            ...currentUser,
            actor_type: 'admin',
          },
          target: {
            target_type: 'user',
            username: user.username,
            email: user.email,
            full_name: user.name,
          },
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
    try {
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
        this.sessionManager.flash(req).error('User not found');
        res.redirect('/admin/users');
        return;
      }

      // Build filter for activities — use ActivityFilter key, not legacy field
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
        if (
          activity.device_infos &&
          typeof activity.device_infos === 'object'
        ) {
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
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'user_activities_loading_failed',
        userId: req.params.id,
      });
      this.sessionManager.flash(req).error('Failed to load user activities');
      res.redirect(`/admin/users/${req.params.id}`);
    }
  };
}
