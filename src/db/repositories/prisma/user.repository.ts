import { injectable } from 'inversify';
import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import type { IUser } from '../../../types/user.js';
import type { WebAuthnCredential } from '../../../types/webauthn.js';
import type {
  IUserRepository,
  UserFilter,
  CreateUserDto,
  UpdateUserDto,
  IUserMfaUpdate,
  IRecoveryLockout,
  ISecurityQuestion,
  IWebAuthnCredential,
} from '../interfaces/user.repository.js';
import type {
  PaginatedResult,
  PaginationOptions,
  QueryOptions,
} from '../interfaces/base.repository.js';
import { AbstractPrismaRepository } from './base.repository.js';

// ─── Name computation (mirrors Mongoose pre-save hook) ────────────────────────

function computeName(
  givenName: string | null | undefined,
  familyName: string | null | undefined,
  customIdentifier1: string | null | undefined,
  storedName: string | null | undefined
): string | undefined {
  const given = givenName?.trim() || '';
  const family = familyName?.trim() || '';
  if (given && family) return `${given} ${family}`;
  if (given) return given;
  if (family) return family;
  // Fall back to whatever is stored, then custom_identifier_1
  return storedName?.trim() || customIdentifier1?.trim() || undefined;
}

// ─── Include clause used on every user read ───────────────────────────────────

const USER_INCLUDE = {
  mfa: true,
  mfa_totp: true,
  mfa_email_otp: true,
  webauthn_credentials: true,
  recovery: {
    include: {
      backup_codes: true,
      security_questions: true,
    },
  },
  backup_codes: true,
  security_questions: true,
  notification_prefs: true,
} as const;

type UserFull = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

// ─── Mapping helper ───────────────────────────────────────────────────────────

function toIUser(row: UserFull): IUser {
  const hasMfaData =
    row.mfa !== null ||
    row.mfa_totp !== null ||
    row.mfa_email_otp !== null ||
    row.webauthn_credentials.length > 0;

  type MfaShape = NonNullable<IUser['mfa']>;
  type RecoveryShape = NonNullable<IUser['recovery']>;
  type NotifShape = NonNullable<IUser['notification_preferences']>;

  const mfaData: IUser['mfa'] = hasMfaData
    ? {
        enabled: row.mfa?.enabled ?? false,
        preferred_method:
          (row.mfa?.preferred_method as MfaShape['preferred_method']) ??
          undefined,
        methods: {
          totp: row.mfa_totp
            ? {
                enabled: row.mfa_totp.enabled,
                secret: row.mfa_totp.secret ?? undefined,
                verified_at: row.mfa_totp.verified_at ?? undefined,
              }
            : undefined,
          email: row.mfa_email_otp ? { enabled: true } : undefined,
          webauthn:
            row.webauthn_credentials.length > 0
              ? {
                  enabled: true,
                  credentials: row.webauthn_credentials.map(c => ({
                    credential_id: c.credential_id,
                    credential_public_key: c.public_key,
                    counter: c.counter,
                    device_type:
                      (c.device_type as WebAuthnCredential['device_type']) ??
                      'singleDevice',
                    backed_up: c.backed_up,
                    transports: JSON.parse(
                      c.transports
                    ) as WebAuthnCredential['transports'],
                    created_at: c.created_at,
                    friendly_name: c.credential_id,
                  })),
                }
              : undefined,
        },
        email_otp: row.mfa_email_otp?.otp_hash
          ? {
              hash: row.mfa_email_otp.otp_hash,
              expires: row.mfa_email_otp.expires_at!,
            }
          : undefined,
      }
    : undefined;

  // them even when the UserRecovery row is absent
  const hasRecoveryData =
    row.recovery !== null ||
    row.backup_codes.length > 0 ||
    row.security_questions.length > 0;

  const recoveryData: IUser['recovery'] = hasRecoveryData
    ? {
        enabled: row.recovery?.enabled ?? false,
        methods: JSON.parse(
          row.recovery?.methods ?? '[]'
        ) as RecoveryShape['methods'],
        secondary_email: row.recovery?.secondary_email
          ? {
              email: row.recovery.secondary_email,
              verified: row.recovery.secondary_email_verified,
              verification_token:
                row.recovery.secondary_email_token ?? undefined,
              verification_expires:
                row.recovery.secondary_email_token_exp ?? undefined,
            }
          : undefined,
        sms: row.recovery?.sms_phone_number
          ? {
              phone_number: row.recovery.sms_phone_number,
              verified: row.recovery.sms_verified,
              verification_code: row.recovery.sms_code ?? undefined,
              verification_expires: row.recovery.sms_code_exp ?? undefined,
            }
          : undefined,
        backup_codes: row.recovery?.backup_codes_generated_at
          ? {
              codes: row.backup_codes
                .filter(bc => !bc.used)
                .map(bc => bc.code_hash),
              generated_at: row.recovery.backup_codes_generated_at,
              expires_at: row.recovery.backup_codes_expires_at!,
            }
          : undefined,
        security_questions:
          row.security_questions.length > 0
            ? {
                questions: row.security_questions.map(sq => ({
                  id: sq.id,
                  question_key: sq.question_key,
                  answer_hash: sq.answer_hash,
                })),
                setup_at: row.recovery?.sq_setup_at ?? undefined,
                last_used_at: row.recovery?.sq_last_used_at ?? undefined,
                failed_attempts: row.recovery?.sq_failed_attempts ?? 0,
                last_failed_at: row.recovery?.sq_last_failed_at ?? undefined,
                locked_until: row.recovery?.sq_locked_until ?? undefined,
              }
            : undefined,
      }
    : undefined;

  return {
    id: row.id,
    _id: row.id,
    email: row.email ?? undefined,
    username: row.username ?? '',
    custom_identifier_1: row.custom_identifier_1 ?? undefined,
    custom_identifier_2: row.custom_identifier_2 ?? undefined,
    custom_identifier_3: row.custom_identifier_3 ?? undefined,
    sub: row.sub ?? undefined,
    given_name: row.given_name ?? undefined,
    family_name: row.family_name ?? undefined,
    name: computeName(
      row.given_name,
      row.family_name,
      row.custom_identifier_1,
      row.name
    ),
    nickname: row.nickname ?? undefined,
    middle_name: row.middle_name ?? undefined,
    gender: (row.gender as IUser['gender']) ?? 'M',
    birthdate: row.birthdate ?? undefined,
    phone_number: row.phone_number ?? undefined,
    profile: row.profile ?? undefined,
    website: row.website ?? undefined,
    picture: row.picture ?? undefined,
    locale: row.locale ?? undefined,
    country: row.country ?? undefined,
    zoneinfo: row.zoneinfo ?? undefined,
    city: row.city ?? undefined,
    address: row.address ?? undefined,
    street_address: row.street_address ?? undefined,
    region: row.region ?? undefined,
    postal_code: row.postal_code ?? undefined,
    roles: JSON.parse(row.roles) as string[],
    phone_number_verified: row.phone_number_verified,
    email_verified: row.email_verified,
    theme: (row.theme as IUser['theme']) ?? undefined,
    sidebar_expanded: row.sidebar_expanded,
    last_login: row.last_login ?? undefined,
    password: row.password ?? undefined,
    password_hash_algo: row.password_hash_algo ?? undefined,
    password_updated_at: row.password_updated_at ?? undefined,
    password_force_reset: row.password_force_reset,
    reset_password_token: row.reset_password_token ?? undefined,
    reset_password_expires: row.reset_password_expires ?? undefined,
    email_verification_token: row.email_verification_token ?? undefined,
    email_verification_expires: row.email_verification_expires ?? undefined,
    blocked_from: JSON.parse(row.blocked_from) as string[],
    account_is_anonymized: row.account_is_anonymized,
    register_with: row.register_with as IUser['register_with'],
    auth_provider: (row.auth_provider as IUser['auth_provider']) ?? undefined,
    account_enabled: row.account_enabled,
    mfa: mfaData,
    recovery: recoveryData,
    notification_preferences: row.notification_prefs
      ? {
          preferred_channel: row.notification_prefs
            .preferred_channel as NotifShape['preferred_channel'],
          security_alerts: row.notification_prefs.security_alerts,
          new_session_alerts: row.notification_prefs.new_session_alerts,
          marketing: row.notification_prefs.marketing,
        }
      : undefined,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

@injectable()
export class PrismaUserRepository
  extends AbstractPrismaRepository
  implements IUserRepository
{
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async findFull(
    where: Prisma.UserWhereUniqueInput
  ): Promise<IUser | null> {
    const row = await this.prisma.user.findUnique({
      where,
      include: USER_INCLUDE,
    });
    return row ? toIUser(row) : null;
  }

  private async findFirstFull(
    where: Prisma.UserWhereInput
  ): Promise<IUser | null> {
    const row = await this.prisma.user.findFirst({
      where,
      include: USER_INCLUDE,
    });
    return row ? toIUser(row) : null;
  }

  // ── IBaseRepository ────────────────────────────────────────────────────────

  async findById(id: string): Promise<IUser | null> {
    return this.findFull({ id });
  }

  async findOne(filter: Record<string, unknown>): Promise<IUser | null> {
    return this.findFirstFull(filter as Prisma.UserWhereInput);
  }

  async findMany(
    filter: UserFilter | Record<string, unknown>,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<IUser>> {
    return this.paginateDelegate(
      {
        findMany: args =>
          this.prisma.user.findMany({ ...args, include: USER_INCLUDE }),
        count: args => this.prisma.user.count(args as Prisma.UserCountArgs),
      },
      filter as Record<string, unknown>,
      opts,
      row => toIUser(row as UserFull)
    );
  }

  async create(data: CreateUserDto): Promise<IUser> {
    const id = crypto.randomUUID();
    const row = await this.prisma.user.create({
      data: {
        id,
        email: data.email ?? null,
        username: data.username ?? null,
        custom_identifier_1: data.custom_identifier_1 ?? null,
        custom_identifier_2: data.custom_identifier_2 ?? null,
        custom_identifier_3: data.custom_identifier_3 ?? null,
        sub: data.sub ?? null,
        given_name: data.given_name ?? null,
        family_name: data.family_name ?? null,
        name:
          computeName(
            data.given_name,
            data.family_name,
            data.custom_identifier_1,
            data.name
          ) ?? null,
        nickname: data.nickname ?? null,
        middle_name: data.middle_name ?? null,
        gender: data.gender ?? 'M',
        birthdate: data.birthdate ?? null,
        phone_number: data.phone_number ?? null,
        profile: data.profile ?? null,
        website: data.website ?? null,
        picture: data.picture ?? null,
        locale: data.locale ?? 'fr',
        country: data.country ?? 'bj',
        zoneinfo: data.zoneinfo ?? 'Africa/Porto-Novo',
        city: data.city ?? null,
        address: data.address ?? null,
        street_address: data.street_address ?? null,
        region: data.region ?? null,
        postal_code: data.postal_code ?? null,
        roles: JSON.stringify(data.roles ?? ['user']),
        phone_number_verified: data.phone_number_verified ?? false,
        email_verified: data.email_verified ?? false,
        theme: data.theme ?? null,
        sidebar_expanded: data.sidebar_expanded ?? false,
        last_login: data.last_login ?? null,
        password: data.password ?? null,
        password_hash_algo: data.password_hash_algo ?? null,
        password_updated_at: data.password_updated_at ?? null,
        password_force_reset: data.password_force_reset ?? false,
        reset_password_token: data.reset_password_token ?? null,
        reset_password_expires: data.reset_password_expires ?? null,
        email_verification_token: data.email_verification_token ?? null,
        email_verification_expires: data.email_verification_expires ?? null,
        blocked_from: JSON.stringify(data.blocked_from ?? []),
        account_is_anonymized: data.account_is_anonymized ?? false,
        register_with: data.register_with ?? 'email',
        auth_provider: data.auth_provider ?? null,
        account_enabled: data.account_enabled ?? true,
        mfa: data.mfa
          ? {
              create: {
                enabled: data.mfa.enabled,
                preferred_method: data.mfa.preferred_method ?? null,
              },
            }
          : undefined,
        mfa_totp: data.mfa?.methods?.totp
          ? {
              create: {
                enabled: data.mfa.methods.totp.enabled,
                secret: data.mfa.methods.totp.secret ?? null,
                verified_at: data.mfa.methods.totp.verified_at ?? null,
              },
            }
          : undefined,
        mfa_email_otp: data.mfa?.email_otp
          ? {
              create: {
                otp_hash: data.mfa.email_otp.hash,
                expires_at: data.mfa.email_otp.expires,
              },
            }
          : undefined,
        webauthn_credentials: data.mfa?.methods?.webauthn?.credentials?.length
          ? {
              create: data.mfa.methods.webauthn.credentials.map(c => ({
                credential_id: c.credential_id,
                public_key: c.credential_public_key,
                counter: c.counter,
                device_type: c.device_type ?? null,
                backed_up: c.backed_up,
                transports: JSON.stringify(c.transports ?? []),
              })),
            }
          : undefined,
        recovery: data.recovery
          ? {
              create: {
                enabled: data.recovery.enabled,
                methods: JSON.stringify(data.recovery.methods),
                secondary_email: data.recovery.secondary_email?.email ?? null,
                secondary_email_verified:
                  data.recovery.secondary_email?.verified ?? false,
                secondary_email_token:
                  data.recovery.secondary_email?.verification_token ?? null,
                secondary_email_token_exp:
                  data.recovery.secondary_email?.verification_expires ?? null,
                sms_phone_number: data.recovery.sms?.phone_number ?? null,
                sms_verified: data.recovery.sms?.verified ?? false,
                sms_code: data.recovery.sms?.verification_code ?? null,
                sms_code_exp: data.recovery.sms?.verification_expires ?? null,
                backup_codes_generated_at:
                  data.recovery.backup_codes?.generated_at ?? null,
                backup_codes_expires_at:
                  data.recovery.backup_codes?.expires_at ?? null,
                sq_setup_at: data.recovery.security_questions?.setup_at ?? null,
                sq_last_used_at:
                  data.recovery.security_questions?.last_used_at ?? null,
                sq_failed_attempts:
                  data.recovery.security_questions?.failed_attempts ?? 0,
                sq_last_failed_at:
                  data.recovery.security_questions?.last_failed_at ?? null,
                sq_locked_until:
                  data.recovery.security_questions?.locked_until ?? null,
              },
            }
          : undefined,
        backup_codes: data.recovery?.backup_codes?.codes?.length
          ? {
              create: data.recovery.backup_codes.codes.map(code => ({
                code_hash: code,
                used: false,
              })),
            }
          : undefined,
        security_questions: data.recovery?.security_questions?.questions?.length
          ? {
              create: data.recovery.security_questions.questions.map(q => ({
                question_key: q.question_key,
                answer_hash: q.answer_hash,
              })),
            }
          : undefined,
        notification_prefs: data.notification_preferences
          ? {
              create: {
                preferred_channel:
                  data.notification_preferences.preferred_channel,
                security_alerts: data.notification_preferences.security_alerts,
                new_session_alerts:
                  data.notification_preferences.new_session_alerts,
                marketing: data.notification_preferences.marketing,
              },
            }
          : undefined,
      },
      include: USER_INCLUDE,
    });
    return toIUser(row);
  }

  async update(id: string, data: UpdateUserDto): Promise<IUser> {
    const updateData: Prisma.UserUpdateInput = {};
    if (data.email !== undefined) updateData.email = data.email ?? null;
    if (data.username !== undefined)
      updateData.username = data.username ?? null;
    if (data.given_name !== undefined)
      updateData.given_name = data.given_name ?? null;
    if (data.family_name !== undefined)
      updateData.family_name = data.family_name ?? null;
    if (
      data.given_name !== undefined ||
      data.family_name !== undefined ||
      data.name !== undefined
    ) {
      updateData.name =
        computeName(
          data.given_name,
          data.family_name,
          data.custom_identifier_1,
          data.name
        ) ?? null;
    }
    if (data.phone_number !== undefined)
      updateData.phone_number = data.phone_number ?? null;
    if (data.email_verified !== undefined)
      updateData.email_verified = data.email_verified;
    if (data.phone_number_verified !== undefined)
      updateData.phone_number_verified = data.phone_number_verified;
    if (data.account_enabled !== undefined)
      updateData.account_enabled = data.account_enabled;
    if (data.password !== undefined)
      updateData.password = data.password ?? null;
    if (data.password_hash_algo !== undefined)
      updateData.password_hash_algo = data.password_hash_algo ?? null;
    if (data.password_updated_at !== undefined)
      updateData.password_updated_at = data.password_updated_at ?? null;
    if (data.password_force_reset !== undefined)
      updateData.password_force_reset = data.password_force_reset;
    if (data.reset_password_token !== undefined)
      updateData.reset_password_token = data.reset_password_token ?? null;
    if (data.reset_password_expires !== undefined)
      updateData.reset_password_expires = data.reset_password_expires ?? null;
    if (data.email_verification_token !== undefined)
      updateData.email_verification_token =
        data.email_verification_token ?? null;
    if (data.email_verification_expires !== undefined)
      updateData.email_verification_expires =
        data.email_verification_expires ?? null;
    if (data.picture !== undefined) updateData.picture = data.picture ?? null;
    if (data.locale !== undefined) updateData.locale = data.locale ?? null;
    if (data.theme !== undefined) updateData.theme = data.theme ?? null;
    if (data.last_login !== undefined)
      updateData.last_login = data.last_login ?? null;
    if (data.roles !== undefined) updateData.roles = JSON.stringify(data.roles);
    if (data.sub !== undefined) updateData.sub = data.sub ?? null;
    if (data.auth_provider !== undefined)
      updateData.auth_provider = data.auth_provider ?? null;
    if (data.custom_identifier_1 !== undefined)
      updateData.custom_identifier_1 = data.custom_identifier_1 ?? null;
    if (data.custom_identifier_2 !== undefined)
      updateData.custom_identifier_2 = data.custom_identifier_2 ?? null;
    if (data.custom_identifier_3 !== undefined)
      updateData.custom_identifier_3 = data.custom_identifier_3 ?? null;

    const row = await this.prisma.user.update({
      where: { id },
      data: updateData,
      include: USER_INCLUDE,
    });
    return toIUser(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    return this.prisma.user.count({
      where: filter as Prisma.UserWhereInput,
    });
  }

  // ── IUserRepository extras ────────────────────────────────────────────────

  async findByEmail(email: string): Promise<IUser | null> {
    return this.findFirstFull({ email });
  }

  async findByUsername(username: string): Promise<IUser | null> {
    return this.findFirstFull({ username });
  }

  async findBySub(sub: string): Promise<IUser | null> {
    return this.findFirstFull({ sub });
  }

  async findBySecondaryEmail(email: string): Promise<IUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { recovery: { secondary_email: email } },
      include: USER_INCLUDE,
    });
    return row ? toIUser(row) : null;
  }

  async updateMfa(id: string, mfa: IUserMfaUpdate): Promise<void> {
    if (mfa.enabled !== undefined || mfa.preferred_method !== undefined) {
      await this.prisma.userMfa.upsert({
        where: { user_id: id },
        create: {
          user_id: id,
          enabled: mfa.enabled ?? false,
          preferred_method: mfa.preferred_method ?? null,
        },
        update: {
          ...(mfa.enabled !== undefined && { enabled: mfa.enabled }),
          ...(mfa.preferred_method !== undefined && {
            preferred_method: mfa.preferred_method,
          }),
        },
      });
    }
    if (mfa['methods.totp'] !== undefined) {
      const totp = mfa['methods.totp'];
      await this.prisma.userMfaTotp.upsert({
        where: { user_id: id },
        create: {
          user_id: id,
          enabled: totp.enabled ?? false,
          secret: totp.secret ?? null,
          verified_at: totp.verified_at ?? null,
        },
        update: {
          ...(totp.enabled !== undefined && { enabled: totp.enabled }),
          ...(totp.secret !== undefined && { secret: totp.secret }),
          ...(totp.verified_at !== undefined && {
            verified_at: totp.verified_at,
          }),
        },
      });
    }
  }

  async updateRecovery(
    id: string,
    recovery: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.userRecovery.upsert({
      where: { user_id: id },
      create: {
        user_id: id,
        enabled: (recovery['enabled'] as boolean) ?? false,
        methods: JSON.stringify((recovery['methods'] as string[]) ?? []),
      },
      update: recovery as Prisma.UserRecoveryUpdateInput,
    });
  }

  async addWebAuthnCredential(
    id: string,
    credential: IWebAuthnCredential
  ): Promise<void> {
    await this.prisma.userWebauthnCredential.create({
      data: {
        user_id: id,
        credential_id: credential.credential_id,
        public_key: credential.publicKey,
        counter: credential.counter,
        device_type: credential.device_type ?? null,
        backed_up: credential.backed_up ?? false,
        transports: JSON.stringify(credential.transports ?? []),
      },
    });
  }

  async removeWebAuthnCredential(
    id: string,
    credentialId: string
  ): Promise<void> {
    await this.prisma.userWebauthnCredential.deleteMany({
      where: { user_id: id, credential_id: credentialId },
    });
  }

  async addBackupCodes(id: string, codes: string[]): Promise<void> {
    await this.prisma.userBackupCode.createMany({
      data: codes.map(code => ({ user_id: id, code_hash: code, used: false })),
    });
  }

  async consumeBackupCode(id: string, codeHash: string): Promise<boolean> {
    const code = await this.prisma.userBackupCode.findFirst({
      where: { user_id: id, code_hash: codeHash, used: false },
    });
    if (!code) return false;
    await this.prisma.userBackupCode.update({
      where: { id: code.id },
      data: { used: true },
    });
    return true;
  }

  async addSecurityQuestion(id: string, q: ISecurityQuestion): Promise<void> {
    await this.prisma.userSecurityQuestion.create({
      data: {
        id: q.id,
        user_id: id,
        question_key: q.question_key,
        answer_hash: q.answer_hash,
      },
    });
  }

  async updateRecoveryLockout(
    id: string,
    lockout: IRecoveryLockout
  ): Promise<void> {
    await this.prisma.userRecovery.upsert({
      where: { user_id: id },
      create: {
        user_id: id,
        enabled: false,
        methods: '[]',
        sq_failed_attempts: lockout.failed_attempts ?? 0,
        sq_last_failed_at: lockout.last_failed_at ?? null,
        sq_locked_until: lockout.locked_until ?? null,
      },
      update: {
        sq_failed_attempts: lockout.failed_attempts,
        sq_last_failed_at: lockout.last_failed_at ?? null,
        sq_locked_until: lockout.locked_until ?? null,
      },
    });
  }

  async setEmailOtp(
    id: string,
    otp: { hash: string; expires: Date }
  ): Promise<void> {
    await this.prisma.userMfaEmailOtp.upsert({
      where: { user_id: id },
      create: { user_id: id, otp_hash: otp.hash, expires_at: otp.expires },
      update: { otp_hash: otp.hash, expires_at: otp.expires },
    });
  }

  async clearEmailOtp(id: string): Promise<void> {
    await this.prisma.userMfaEmailOtp.deleteMany({ where: { user_id: id } });
  }

  async forcePasswordReset(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { password_force_reset: true },
    });
  }

  async anonymize(id: string): Promise<IUser> {
    const anonId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        email: `anon-${anonId}@deleted.invalid`,
        username: `deleted-${anonId}`,
        given_name: null,
        family_name: null,
        name: null,
        nickname: null,
        phone_number: null,
        picture: null,
        address: null,
        street_address: null,
        city: null,
        region: null,
        postal_code: null,
        custom_identifier_1: null,
        custom_identifier_2: null,
        custom_identifier_3: null,
        account_is_anonymized: true,
        account_enabled: false,
      },
      include: USER_INCLUDE,
    });
    return toIUser(row);
  }

  // findMany with QueryOptions (from IBaseRepository — not paginated)
  async findManyRaw(
    filter: Record<string, unknown>,
    opts?: QueryOptions
  ): Promise<IUser[]> {
    const rows = await this.prisma.user.findMany({
      where: filter as Prisma.UserWhereInput,
      take: opts?.limit,
      skip: opts?.skip,
      orderBy: opts?.sort
        ? Object.fromEntries(
            Object.entries(opts.sort).map(([k, v]) => [
              k,
              v === 1 || v === 'asc' ? 'asc' : 'desc',
            ])
          )
        : undefined,
      include: USER_INCLUDE,
    });
    return rows.map(toIUser);
  }
}
