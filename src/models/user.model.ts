import mongoose, { Schema } from 'mongoose';
import { type TypedModel } from './base.model.js';
import toJSON from '../db/plugins/to-json.plugin.js';
import paginate from '../db/plugins/paginate.plugin.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IPasswordUtils } from '../di/interfaces/password-utils.interface.js';
import {
  type IUser,
  type IUserMethods,
  RegisterWithValues,
  AuthProviderValues,
} from '../types/user.js';

export type {
  IUser,
  IUserMethods,
  Gender,
  RegisterWith,
  AuthProvider,
} from '../types/user.js';
export { RegisterWithValues, AuthProviderValues } from '../types/user.js';

export type UserModel = TypedModel<IUser, IUserMethods>;

/**
 * Factory function to create User model with DI dependencies
 */
export const createUserModel = (
  logger: ILogger,
  configManager: IConfigManager,
  _passwordUtils: IPasswordUtils
): UserModel => {
  const config = configManager.getConfig();

  // Grouped schema fields according to the IUser interface
  const userSchema = new Schema<IUser, UserModel, IUserMethods>(
    {
      // --- Business fields (OpenID Standard Claims) ---
      family_name: {
        type: String,
        required: false,
        trim: true,
      },
      given_name: {
        type: String,
        required: false,
        trim: true,
      },
      name: {
        type: String,
        required: false,
        trim: true,
      },
      nickname: {
        type: String,
        required: false,
        trim: true,
      },
      middle_name: {
        type: String,
        required: false,
        trim: true,
      },
      gender: {
        type: String,
        enum: ['M', 'F'],
        default: 'M',
      },
      birthdate: {
        type: Date,
        required: false,
      },
      phone_number: {
        type: String,
        required: false,
        trim: true,
      },
      profile: {
        type: String,
        required: false,
      },
      website: {
        type: String,
        required: false,
      },
      picture: {
        type: String,
        required: false,
        trim: true,
      },
      email: {
        type: String,
        required: false,
        trim: true,
        lowercase: true,
      },
      locale: {
        type: String,
        required: false,
        trim: true,
        default: 'fr',
      },
      country: {
        type: String,
        required: false,
        trim: true,
        default: 'bj',
      },
      zoneinfo: {
        type: String,
        required: false,
        trim: true,
        default: 'Africa/Porto-Novo',
      },
      city: {
        type: String,
        required: false,
        trim: true,
      },
      address: {
        type: String,
        required: false,
        trim: true,
      },
      street_address: {
        type: String,
        required: false,
        trim: true,
      },
      region: {
        type: String,
        required: false,
        trim: true,
      },
      postal_code: {
        type: String,
        required: false,
        trim: true,
      },
      roles: [
        {
          type: String,
          enum: config.security.authentication.roles.available,
          default: config.security.authentication.roles.default,
          set: (value: string) => value?.trim(),
        },
      ],

      // --- Custom identifier fields ---
      // Note: uniqueness enforced via compound indexes with tenant_id below
      custom_identifier_1: {
        type: String,
        required: false,
        trim: true,
        set: (v: string | undefined | null) =>
          v == null || v.trim() === '' ? undefined : v.trim(),
      },
      custom_identifier_2: {
        type: String,
        required: false,
        trim: true,
        set: (v: string | undefined | null) =>
          v == null || v.trim() === '' ? undefined : v.trim(),
      },
      custom_identifier_3: {
        type: String,
        required: false,
        trim: true,
        set: (v: string | undefined | null) =>
          v == null || v.trim() === '' ? undefined : v.trim(),
      },

      // --- Technical fields (internal only) ---
      phone_number_verified: {
        type: Boolean,
        default: false,
      },
      email_verified: {
        type: Boolean,
        default: false,
      },
      sub: {
        type: String,
        required: false,
        trim: true,
      },
      theme: {
        type: String,
        enum: ['light', 'dark'],
        default: 'light',
      },
      sidebar_expanded: {
        type: Boolean,
        default: true,
      },
      last_login: {
        type: Date,
        required: false,
      },

      // --- Multi-factor authentication configuration (multi-method support) ---
      mfa: {
        enabled: { type: Boolean, default: false },
        methods: {
          totp: {
            enabled: { type: Boolean, default: false },
            secret: { type: String, required: false },
            verified_at: { type: Date, required: false },
          },
          email: {
            enabled: { type: Boolean, default: false },
            verified_at: { type: Date, required: false },
          },
          webauthn: {
            enabled: { type: Boolean, default: false },
            credentials: { type: [Schema.Types.Mixed], required: false },
            verified_at: { type: Date, required: false },
          },
        },
        preferred_method: {
          type: String,
          enum: ['totp', 'email', 'webauthn'],
          required: false,
        },
        email_otp: {
          hash: { type: String, required: false },
          expires: { type: Date, required: false },
        },
      },

      // --- Account recovery configuration ---
      recovery: {
        enabled: { type: Boolean, default: false },
        methods: {
          type: [String],
          enum: [
            'backup_codes',
            'secondary_email',
            'sms',
            'security_questions',
          ],
          default: [],
        },
        backup_codes: {
          codes: { type: [String], required: false },
          generated_at: { type: Date, required: false },
          expires_at: { type: Date, required: false },
        },
        secondary_email: {
          email: { type: String, required: false },
          verified: { type: Boolean, default: false },
          verification_token: { type: String, required: false },
          verification_expires: { type: Date, required: false },
        },
        sms: {
          phone_number: { type: String, required: false },
          verified: { type: Boolean, default: false },
          verification_code: { type: String, required: false },
          verification_expires: { type: Date, required: false },
        },
        security_questions: {
          questions: {
            type: [
              {
                id: { type: String, required: true },
                question_key: { type: String, required: true }, // i18n key (e.g., 'q1', 'q2')
                answer_hash: { type: String, required: true },
              },
            ],
            required: false,
          },
          setup_at: { type: Date, required: false },
          last_used_at: { type: Date, required: false },
          failed_attempts: { type: Number, default: 0 },
          last_failed_at: { type: Date, required: false },
          locked_until: { type: Date, required: false },
        },
        lockout: {
          failed_attempts: { type: Number, default: 0 },
          last_failed_at: { type: Date, required: false },
          locked_until: { type: Date, required: false },
        },
        last_recovered_at: { type: Date, required: false },
      },

      // --- Authentication and account management fields ---
      username: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50,
      },
      password: {
        type: String,
        required: false,
      },
      password_hash_algo: {
        type: String,
        required: false,
      },
      password_updated_at: {
        type: Date,
        required: false,
      },
      password_force_reset: {
        type: Boolean,
        default: false,
      },
      reset_password_token: {
        type: String,
        required: false,
      },
      reset_password_expires: {
        type: Date,
        required: false,
      },
      email_verification_token: {
        type: String,
        required: false,
      },
      email_verification_expires: {
        type: Date,
        required: false,
      },
      blocked_from: {
        type: [String],
        default: [],
      },
      account_is_anonymized: {
        type: Boolean,
        default: false,
      },
      register_with: {
        type: String,
        enum: RegisterWithValues,
        default: 'email',
      },
      auth_provider: {
        type: String,
        enum: AuthProviderValues,
        required: false,
        default: 'local',
      },
      account_enabled: {
        type: Boolean,
        default: true,
      },
      notification_preferences: {
        preferred_channel: {
          type: String,
          enum: ['email', 'sms', 'auto'],
          default: 'auto',
        },
        security_alerts: {
          type: Boolean,
          default: true,
        },
        new_session_alerts: {
          type: Boolean,
          default: true,
        },
        marketing: {
          type: Boolean,
          default: false,
        },
      },
    },
    {
      timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
  );

  // All business logic methods have been moved to UserService

  // All dynamic fields methods have been moved to UserService

  userSchema.pre('save', function () {
    const givenName = this.given_name?.trim() || '';
    const familyName = this.family_name?.trim() || '';

    if (givenName && familyName) {
      this.name = `${givenName} ${familyName}`;
    } else if (givenName) {
      this.name = givenName;
    } else if (familyName) {
      this.name = familyName;
    } else {
      this.name = this.custom_identifier_1?.trim() || '';
    }
  });

  // All static methods have been moved to UserService

  userSchema.plugin(toJSON);
  userSchema.plugin(paginate);

  // Compound unique indexes with tenant_id for multi-tenant isolation.
  // Different tenants can have the same username/email/custom identifiers.
  userSchema.index({ tenant_id: 1, username: 1 }, { unique: true });
  userSchema.index(
    { tenant_id: 1, email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
  );
  userSchema.index(
    { tenant_id: 1, custom_identifier_1: 1 },
    {
      unique: true,
      partialFilterExpression: { custom_identifier_1: { $type: 'string' } },
    }
  );
  userSchema.index(
    { tenant_id: 1, custom_identifier_2: 1 },
    {
      unique: true,
      partialFilterExpression: { custom_identifier_2: { $type: 'string' } },
    }
  );
  userSchema.index(
    { tenant_id: 1, custom_identifier_3: 1 },
    {
      unique: true,
      partialFilterExpression: { custom_identifier_3: { $type: 'string' } },
    }
  );
  userSchema.index({ roles: 1 }, { unique: false });
  userSchema.index({ account_is_anonymized: 1 }, { unique: false });
  userSchema.index({ last_login: 1 }, { unique: false });
  userSchema.index({ auth_provider: 1 }, { unique: false });
  userSchema.index({ account_enabled: 1 }, { unique: false });

  const User =
    mongoose.models.User ||
    mongoose.model<IUser, UserModel>('User', userSchema);

  return User;
};
