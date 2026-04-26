/**
 * Get environment-based default configuration for logger
 */
export function getEnvironmentDefaults(environment: string) {
  const baseDefaults = {
    application: {
      name: 'parako-id',
      version: '0.0.0',
    },
  };

  switch (environment) {
    case 'development':
      return {
        ...baseDefaults,
        security: {
          logging: {
            enabled: true,
            level: 'debug',
            pretty_print: true,
            file_logging: {
              enabled: false,
              directory: 'logs',
            },
            http_logging: {
              enabled: true,
              ignore_paths: ['/health', '/ping', '/favicon.ico'],
            },
            redaction: {
              enabled: true,
              paths: [
                // Request/Response sensitive data
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.secrets',
                'req.body.client_secret',
                'req.body.config',
                'res.body.secrets',

                // User/Client/Token data
                'user.password',
                'user.client_secret',
                'client.client_secret',
                'token.access_token',
                'token.refresh_token',
                'token.authorization_code',
                'token.id_token',
                'token.device_code',
                'session.secret',

                // Configuration fields (wildcard patterns)
                '*.jwt_secret',
                '*.cookie_secrets',
                '*.smtp_password',
                '*.client_secret',
                '*.password',
                '*.token',
                '*.pairwise_salt',
                '*.private_key',
                '*.encryption_key',

                // Connection strings / URIs
                '*.uri',
                '*.connectionString',
                '*.redisUrl',

                // Configuration objects (full objects)
                'config.security.secrets',
                'config.security.secrets.*',
                'config.integrations.email.smtp.password',
                'config.integrations.social_providers',
                'config.oidc.secrets',
                'config.oidc.secrets.*',

                'settings.security.secrets',
                'settings.security.secrets.*',
                'settings.integrations.email.smtp.password',
                'settings.integrations.social_providers',
                'settings.oidc.secrets',
                'settings.oidc.secrets.*',
              ],
            },
          },
        },
      };

    case 'production':
      return {
        ...baseDefaults,
        security: {
          logging: {
            enabled: true,
            level: 'info',
            pretty_print: false,
            file_logging: {
              enabled: true,
              directory: 'logs',
              max_size: '10m',
              max_files: 5,
            },
            http_logging: {
              enabled: true,
              ignore_paths: ['/health', '/ping', '/favicon.ico', '/robots.txt'],
            },
            redaction: {
              enabled: true,
              paths: [
                // Request/Response sensitive data
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.secrets',
                'req.body.client_secret',
                'req.body.config',
                'res.body.secrets',

                // User/Client/Token data
                'user.password',
                'user.client_secret',
                'client.client_secret',
                'token.access_token',
                'token.refresh_token',
                'session.secret',

                // Configuration fields (wildcard patterns)
                '*.jwt_secret',
                '*.cookie_secrets',
                '*.smtp_password',
                '*.client_secret',
                '*.password',
                '*.token',
                '*.pairwise_salt',
                '*.private_key',
                '*.encryption_key',

                // Connection strings / URIs
                '*.uri',
                '*.connectionString',
                '*.redisUrl',

                // Configuration objects (full objects)
                'config.security.secrets',
                'config.security.secrets.*',
                'config.integrations.email.smtp.password',
                'config.integrations.social_providers',
                'config.oidc.secrets',
                'config.oidc.secrets.*',

                'settings.security.secrets',
                'settings.security.secrets.*',
                'settings.integrations.email.smtp.password',
                'settings.integrations.social_providers',
                'settings.oidc.secrets',
                'settings.oidc.secrets.*',
              ],
            },
          },
        },
      };

    case 'staging':
      return {
        ...baseDefaults,
        security: {
          logging: {
            enabled: true,
            level: 'info',
            pretty_print: false,
            file_logging: {
              enabled: true,
              directory: 'logs',
              max_size: '10m',
              max_files: 3,
            },
            http_logging: {
              enabled: true,
              ignore_paths: ['/health', '/ping', '/favicon.ico'],
            },
            redaction: {
              enabled: true,
              paths: [
                // Request/Response sensitive data
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.secrets',
                'req.body.client_secret',
                'req.body.config',
                'res.body.secrets',

                // User/Client/Token data
                'user.password',
                'user.client_secret',
                'client.client_secret',
                'session.secret',

                // Configuration fields (wildcard patterns)
                '*.jwt_secret',
                '*.cookie_secrets',
                '*.smtp_password',
                '*.client_secret',
                '*.password',
                '*.token',
                '*.pairwise_salt',
                '*.private_key',
                '*.encryption_key',

                // Connection strings / URIs
                '*.uri',
                '*.connectionString',
                '*.redisUrl',

                // Configuration objects (full objects)
                'config.security.secrets',
                'config.security.secrets.*',
                'config.integrations.email.smtp.password',
                'config.integrations.social_providers',
                'config.oidc.secrets',
                'config.oidc.secrets.*',

                'settings.security.secrets',
                'settings.security.secrets.*',
                'settings.integrations.email.smtp.password',
                'settings.integrations.social_providers',
                'settings.oidc.secrets',
                'settings.oidc.secrets.*',
              ],
            },
          },
        },
      };

    default:
      return {
        ...baseDefaults,
        security: {
          logging: {
            enabled: true,
            level: 'info',
            pretty_print: false,
            file_logging: {
              enabled: false,
              directory: 'logs',
            },
            http_logging: {
              enabled: true,
              ignore_paths: ['/health', '/ping', '/favicon.ico'],
            },
            redaction: {
              enabled: true,
              paths: [
                // Request/Response sensitive data
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.secrets',
                'req.body.client_secret',
                'req.body.config',
                'res.body.secrets',

                // User/Client/Token data
                'user.password',
                'user.client_secret',
                'client.client_secret',
                'session.secret',

                // Configuration fields (wildcard patterns)
                '*.jwt_secret',
                '*.cookie_secrets',
                '*.smtp_password',
                '*.client_secret',
                '*.password',
                '*.token',
                '*.pairwise_salt',
                '*.private_key',
                '*.encryption_key',

                // Connection strings / URIs
                '*.uri',
                '*.connectionString',
                '*.redisUrl',

                // Configuration objects (full objects)
                'config.security.secrets',
                'config.security.secrets.*',
                'config.integrations.email.smtp.password',
                'config.integrations.social_providers',
                'config.oidc.secrets',
                'config.oidc.secrets.*',

                'settings.security.secrets',
                'settings.security.secrets.*',
                'settings.integrations.email.smtp.password',
                'settings.integrations.social_providers',
                'settings.oidc.secrets',
                'settings.oidc.secrets.*',
              ],
            },
          },
        },
      };
  }
}
