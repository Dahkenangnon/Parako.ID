// SHARED TYPES FOR PARAKO.ID MANAGEMENT SCRIPTS

// CORE UTILITY TYPES

/**
 * Box drawing utilities for console output
 */
export interface BoxDrawing {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
  cross: string;
  teeUp: string;
  teeDown: string;
  teeLeft: string;
  teeRight: string;
}

/**
 * Table display options
 */
export interface TableOptions {
  width?: number;
  colors?: boolean;
  maxColumnWidth?: number;
}

/**
 * Box display options
 */
export interface BoxOptions {
  width?: number;
  colors?: boolean;
  maxColumnWidth?: number;
}

/**
 * Console logging utilities
 */
export interface ConsoleLogger {
  info: (msg: string) => void;
  success: (msg: string) => void;
  warning: (msg: string) => void;
  error: (msg: string) => void;
  title: (msg: string) => void;
  subtitle: (msg: string) => void;
  highlight: (msg: string) => void;
  dim: (msg: string) => void;
  progress: (msg: string) => void;
  debug: (msg: string) => void;
}

// CONFIGURATION TYPES

/**
 * Requirement check result
 */
export interface RequirementCheck {
  name: string;
  required: string;
  current: string;
  status: 'pass' | 'fail' | 'warning' | 'info';
  critical: boolean;
  message?: string;
}

/**
 * Command execution result
 */
export interface ExecuteCommandResult {
  code: number;
  stdout: string;
  stderr: string;
  success: boolean;
}

/**
 * Environment preset configuration
 */
export interface EnvironmentPreset {
  name: string;
  description: string;
  icon: string;
  changes: Record<string, unknown>;
}

/**
 * Backup information
 */
export interface BackupInfo {
  name: string;
  date: Date;
  size: number;
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * System check configuration
 */
export interface SystemCheck {
  name: string;
  command: string;
  args: string[];
  required: string;
  critical: boolean;
  failMessage: string;
}

/**
 * Configuration object type
 */
export type ConfigObject = Record<string, unknown>;

// CLIENT MANAGEMENT TYPES

/**
 * OIDC Client configuration
 */
export interface OidcClient {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: any;
  software_id?: string;
  software_version?: string;
  redirect_uris?: string[];
  post_logout_redirect_uris?: string[];
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  contacts?: string[];
  token_endpoint_auth_method?: string;
  token_endpoint_auth_signing_alg?: string;
  default_max_age?: number;
  require_auth_time?: boolean;
  default_acr_values?: string[];
  initiate_login_uri?: string;
  request_uris?: string[];
  request_object_signing_alg?: string;
  userinfo_signed_response_alg?: string;
  userinfo_encrypted_response_alg?: string;
  userinfo_encrypted_response_enc?: string;
  id_token_signed_response_alg?: string;
  id_token_encrypted_response_alg?: string;
  id_token_encrypted_response_enc?: string;
  subject_type?: string;
  tls_client_certificate_bound_access_tokens?: boolean;
  revocation_endpoint_auth_method?: string;
  introspection_endpoint_auth_method?: string;
  code_challenge_method?: string;
  authorization_signed_response_alg?: string;
  authorization_encrypted_response_alg?: string;
  authorization_encrypted_response_enc?: string;
  backchannel_logout_uri?: string;
  backchannel_logout_session_required?: boolean;
  frontchannel_logout_uri?: string;
  frontchannel_logout_session_required?: boolean;
  issuer?: string;
  scopes?: string[];
  // Device flow specific properties (RFC 8628)
  device_authorization_endpoint?: string;
  device_code_lifetime?: number;
  user_code_lifetime?: number;
  verification_uri_complete?: boolean;
  user_code_challenge_method?: string;
  [key: string]: any;
}

// CLI MANAGEMENT TYPES

/**
 * Sub-CLI configuration
 */
export interface SubCLIConfig {
  name: string;
  description: string;
  script: string;
  icon: string;
  category: string;
  commands: Record<string, string>;
}

/**
 * Command shortcut mapping
 */
export interface CommandShortcut {
  module: string;
  command: string;
  args?: string[];
}

// CONSTANTS

/**
 * Default box width for console output
 */
export const DEFAULT_BOX_WIDTH = 80;

/**
 * Box drawing characters
 */
export const BOX_DRAWING: BoxDrawing = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  cross: '┼',
  teeUp: '┴',
  teeDown: '┬',
  teeLeft: '┤',
  teeRight: '├',
};

/**
 * Sub-CLI configurations (only active modules: client, update, keys)
 */
export const SUB_CLIS: Record<string, SubCLIConfig> = {
  client: {
    name: 'Client Manager',
    description: 'Manage OIDC clients and applications',
    script: 'client.js',
    icon: '🔧',
    category: 'management',
    commands: {
      list: 'List all registered clients',
      add: 'Add a new OIDC client',
      show: 'Show detailed client information',
      update: 'Update an existing client',
      remove: 'Remove a client',
      export: 'Export clients to a file',
      import: 'Import clients from a file',
      init: 'Initialize empty client registry',
    },
  },
  update: {
    name: 'Version Manager',
    description: 'Update to latest or specific Parako.ID version',
    script: 'update.js',
    icon: '📦',
    category: 'maintenance',
    commands: {
      latest: 'Update to latest version',
      version: 'Show current installed version',
      list: 'List available versions (default: 5 latest)',
      'list --max <n>': 'List max N versions (--max 0 for all)',
      '--interactive': 'Interactive version selection',
      '--target <ver>': 'Update to specific version',
      '--target latest': 'Update to latest version (alternative syntax)',
    },
  },
  keys: {
    name: 'Key Manager',
    description: 'Generate and manage JWKS keys',
    script: 'keys.js',
    icon: '🔑',
    category: 'security',
    commands: {
      generate: 'Generate JWKS keys interactively',
    },
  },
} as const;

/**
 * Command shortcuts for convenience (only active modules)
 */
export const COMMAND_SHORTCUTS: Record<string, CommandShortcut> = {
  list: { module: 'client', command: 'list' },
  add: { module: 'client', command: 'add' },
  show: { module: 'client', command: 'show' },
  remove: { module: 'client', command: 'remove' },
  export: { module: 'client', command: 'export' },
  import: { module: 'client', command: 'import' },

  latest: { module: 'update', command: 'latest' },
  version: { module: 'update', command: 'version' },

  generate: { module: 'keys', command: 'generate' },
};
