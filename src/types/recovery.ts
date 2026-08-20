/**
 * Recovery method types supported by the system
 */
export type RecoveryMethod =
  'backup_codes' | 'secondary_email' | 'sms' | 'security_questions';

/**
 * Recovery configuration interface
 */
export interface RecoveryConfig {
  enabled: boolean;
  methods: RecoveryMethod[];
  backup_codes?: {
    codes: string[];
    generated_at: Date;
    expires_at: Date;
  };
  secondary_email?: {
    email: string;
    verified: boolean;
    verification_token?: string;
    verification_expires?: Date;
  };
  sms?: {
    phone_number: string;
    verified: boolean;
    verification_code?: string;
    verification_expires?: Date;
  };
  security_questions?: {
    questions: Array<{
      id: string;
      question_key: string; // i18n key (e.g., 'q1', 'q2') from security-questions namespace
      answer_hash: string;
    }>;
    setup_at?: Date;
    last_used_at?: Date;
    failed_attempts?: number;
    last_failed_at?: Date;
    locked_until?: Date;
  };
}

/**
 * Backup code generation result
 */
export interface BackupCodeResult {
  codes: string[]; // Plain codes for one-time display
  hashedCodes: string[]; // Hashed codes for database storage
  generatedAt: Date;
  expiresAt: Date;
}

/**
 * Secondary email verification result
 */
export interface SecondaryEmailResult {
  email: string;
  verificationToken: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Recovery verification result
 */
export interface RecoveryVerificationResult {
  valid: boolean;
  method: RecoveryMethod;
  error?: string;
  matchedCode?: string; // The hashed code that matched (for removal)
}

/**
 * Recovery lockout check result
 */
export interface RecoveryLockoutResult {
  locked: boolean;
  failedAttempts?: number;
  remainingAttempts?: number;
  lockedUntil?: Date;
  minutesRemaining?: number;
}

/**
 * Failed recovery attempt result
 */
export interface FailedAttemptResult {
  locked: boolean;
  failedAttempts: number;
  lockedUntil?: Date;
}

/**
 * Recovery cooldown check result
 */
export interface RecoveryCooldownResult {
  inCooldown: boolean;
  cooldownEndsAt?: Date;
  hoursRemaining?: number;
}

/**
 * Security question answer validation result
 */
export interface SecurityAnswerValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

/**
 * Security questions setup input
 */
export interface SecurityQuestionInput {
  question_key: string; // i18n key (e.g., 'q1', 'q2')
  answer: string;
}

/**
 * Security questions setup result
 */
export interface SecurityQuestionsSetupResult {
  valid: boolean;
  error?: string;
  questions?: Array<{
    id: string;
    question_key: string;
    answer_hash: string;
  }>;
  setup_at?: Date;
}

/**
 * Security questions lockout result
 */
export interface SecurityQuestionsLockoutResult {
  locked: boolean;
  failedAttempts?: number;
  remainingAttempts?: number;
  lockedUntil?: Date;
  minutesRemaining?: number;
}

/**
 * Security questions verification result
 */
export interface SecurityQuestionsVerificationResult {
  valid: boolean;
  error?: string;
  allCorrect?: boolean;
  incorrectCount?: number;
}
