/* eslint-env node */
/**
 * PM2 Ecosystem Configuration for Parako.ID
 *
 * Environment Variables:
 *   APP_NAME              - PM2 process name (default: 'parako-id')
 *   PORT                  - Server port (default: 9007)
 *   PM2_INSTANCES         - Number of instances (default: 1)
 *   PM2_MAX_MEMORY        - Max memory before restart (default: '400M')
 *   PM2_WORKER_MAX_MEMORY - Max memory for worker (default: '512M')
 *   PM2_UID / PM2_GID     - Run as specific user/group (optional)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DEFAULT: single instance. Safe for SQLite and for memory-constrained     │
 * │ hosts. `pm2 reload` is NOT zero-downtime in this configuration: the      │
 * │ single process is drained, exited, and respawned, producing a brief     │
 * │ unavailability window. Deployments with an uptime SLA on PostgreSQL or   │
 * │ MongoDB should set PM2_INSTANCES=2 (or higher) and ensure sufficient     │
 * │ memory headroom.                                                         │
 * │                                                                          │
 * │ SQLITE USERS: PM2_INSTANCES must remain 1. SQLite does not support       │
 * │ concurrent writes from multiple processes. The application enforces     │
 * │ this at startup (src/index.ts) and refuses to start otherwise.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

const appName = process.env.APP_NAME || 'parako-id';

const config = {
  apps: [
    {
      name: appName,
      script: './dist/src/index.js',
      interpreter: 'node',

      // Cluster mode for zero-downtime reloads and load balancing
      exec_mode: 'cluster',
      instances: process.env.PM2_INSTANCES || 1,

      // Graceful start: wait for process.send('ready') before routing traffic
      wait_ready: true,
      listen_timeout: 30000,

      // Graceful shutdown: send 'shutdown' message, wait up to kill_timeout
      // Must exceed the in-app SHUTDOWN_TIMEOUT_MS (10s, see src/utils/shutdown.ts)
      // so the application's own forced-exit triggers before PM2 sends SIGKILL.
      kill_timeout: 14000,
      shutdown_with_message: true,

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: process.env.PM2_MAX_MEMORY || '400M',

      // Logging
      error_file: './logs/pm2_error.log',
      output_file: './logs/pm2_output.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Environment (production-only — dev uses scripts/dev.js, not PM2)
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 9007,
        APP_NAME: appName,
      },

      // Security: run as non-root if configured
      ...(process.env.PM2_UID && { uid: process.env.PM2_UID }),
      ...(process.env.PM2_GID && { gid: process.env.PM2_GID }),
    },

    // Worker process — background jobs (JWKS rotation, scheduled tasks)
    // Single instance (fork mode) since BullMQ handles its own concurrency
    {
      name: `${appName}-worker`,
      script: './dist/src/worker.js',
      interpreter: 'node',

      exec_mode: 'fork',
      instances: 1,

      wait_ready: true,
      listen_timeout: 15000,

      // Must exceed the in-app SHUTDOWN_TIMEOUT_MS (10s, see src/utils/shutdown.ts)
      // so the application's own forced-exit triggers before PM2 sends SIGKILL.
      kill_timeout: 14000,
      shutdown_with_message: true,

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: process.env.PM2_WORKER_MAX_MEMORY || '512M',

      error_file: './logs/pm2_worker_error.log',
      output_file: './logs/pm2_worker_output.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env: {
        NODE_ENV: 'production',
        APP_NAME: `${appName}-worker`,
      },

      ...(process.env.PM2_UID && { uid: process.env.PM2_UID }),
      ...(process.env.PM2_GID && { gid: process.env.PM2_GID }),
    },
  ],
};

module.exports = config;
