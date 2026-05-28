/**
 * _ops Tenant Routes
 *
 * Minimal route definitions for the _ops infrastructure gateway.
 * These routes handle:
 *   - Social OAuth callback relay (Tier 1 tenants)
 *   - Health probes
 *   - Metrics (delegates to MetricsService)
 *
 * All routes are GET-only. The OpsTenantMiddleware guards access.
 */

import { Router, type Request, type Response } from 'express';
import type { OpsSocialCallbackService } from '../services/ops-social-callback.service.js';
import type { OpsTenantMiddleware } from '../middlewares/ops-tenant.middleware.js';

export function opsRoutes(
  guard: OpsTenantMiddleware,
  callbackService: OpsSocialCallbackService
): Router {
  const router = Router();

  router.use(guard.handler);

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Metrics endpoint (placeholder — delegates to MetricsService in future)
  router.get('/metrics', (_req: Request, res: Response) => {
    res.json({ status: 'ok', message: 'Metrics endpoint' });
  });

  // Social OAuth callback relay
  router.get(
    '/social/:provider/callback',
    async (req: Request, res: Response) => {
      try {
        const { provider } = req.params;
        const code = (req.query.code as string) || '';
        const state = (req.query.state as string) || '';

        if (!code || !state) {
          res.status(400).json({ error: 'Missing code or state parameter' });
          return;
        }

        const result = await callbackService.handleCallback(
          provider,
          code,
          state
        );

        if (result.success === true) {
          res.redirect(result.redirectUrl);
        } else {
          res.status(400).json({ error: result.error });
        }
      } catch {
        // _ops is stateless (no views/session) — always respond with JSON
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  return router;
}
