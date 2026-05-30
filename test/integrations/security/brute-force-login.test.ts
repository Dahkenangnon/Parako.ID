import { describe, it, expect, beforeAll, vi } from 'vitest';

// The shared rate-limiter factory inflates limits by a 10× multiplier when
// NODE_ENV !== 'production'. Vitest leaves NODE_ENV unset by default, so we
// pin it to 'production' before the limiter module loads — otherwise the
// budgets under test would be 50 and 1000 instead of 5 and 100.
vi.hoisted(() => {
  process.env.NODE_ENV = 'production';
});

import express, { type Express } from 'express';
import request from 'supertest';

import {
  loginBruteForceByIdentifierAndIp,
  loginBruteForceByIp,
} from '../../../src/utils/rate-limiter.js';
import { HARDENING } from '../../../src/config/hardening-defaults.js';

// The two limiters under test consume their quota only when a downstream
// handler marks the response with `res.locals.loginFailed = true`. The test
// app below stands in for the OIDC login handler — it accepts the form
// payload and either marks the response as failed (the `fail=1` flag) or
// returns success.
function buildLoginApp(): Express {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.post(
    '/login',
    loginBruteForceByIp,
    loginBruteForceByIdentifierAndIp,
    (req, res) => {
      if (req.body.fail === '1' || req.body.fail === 1) {
        res.locals.loginFailed = true;
        res.status(200).json({ ok: false, reason: 'invalid_credentials' });
        return;
      }
      res.status(200).json({ ok: true });
    }
  );
  return app;
}

// Distinct, deterministic IPs per scenario keep the per-IP buckets isolated
// between tests. Express's trust-proxy reader honors X-Forwarded-For when
// `trust proxy` is enabled on the app instance.
const IP_A = '203.0.113.10';
const IP_B = '203.0.113.11';
const IP_SPRAY = '203.0.113.20';

describe('login brute-force protection', () => {
  let app: Express;

  beforeAll(() => {
    app = buildLoginApp();
  });

  describe('per-identifier + IP counter', () => {
    const maxFailures = HARDENING.bruteForce.perIdentifier.max;

    it('blocks the (identifier, IP) pair after the configured failure budget', async () => {
      const username = 'alice@example.test';

      for (let i = 0; i < maxFailures; i++) {
        const res = await request(app)
          .post('/login')
          .set('X-Forwarded-For', IP_A)
          .send({ login: username, password: 'wrong', fail: '1' });
        expect(res.status).toBe(200);
      }

      const blocked = await request(app)
        .post('/login')
        .set('X-Forwarded-For', IP_A)
        .send({ login: username, password: 'wrong', fail: '1' });
      expect(blocked.status).toBe(429);
    });

    it('treats identifier case and surrounding whitespace as the same bucket', async () => {
      // Exhaust the (alice, IP_B) bucket using mixed-case + padded inputs.
      const inputs = [
        'alice@case.test',
        'Alice@case.test',
        '  alice@case.test  ',
      ];
      for (let i = 0; i < maxFailures; i++) {
        const res = await request(app)
          .post('/login')
          .set('X-Forwarded-For', IP_B)
          .send({
            login: inputs[i % inputs.length],
            password: 'wrong',
            fail: '1',
          });
        expect(res.status).toBe(200);
      }

      const blocked = await request(app)
        .post('/login')
        .set('X-Forwarded-For', IP_B)
        .send({ login: 'ALICE@case.test', password: 'wrong', fail: '1' });
      expect(blocked.status).toBe(429);
    });
  });

  describe('IP-only spray counter', () => {
    it('lets a single IP fail against many different usernames before tripping', async () => {
      // Stay well under the (identifier+IP) cap by varying the username each
      // request so that bucket never accumulates more than one hit.
      const sprayAttempts = HARDENING.bruteForce.perIdentifier.max - 1;
      for (let i = 0; i < sprayAttempts; i++) {
        const res = await request(app)
          .post('/login')
          .set('X-Forwarded-For', IP_SPRAY)
          .send({ login: `user${i}@spray.test`, password: 'wrong', fail: '1' });
        expect(res.status).toBe(200);
      }
    });
  });

  it('does not consume the quota on a successful credential check', async () => {
    const IP_OK = '203.0.113.30';
    const success = await request(app)
      .post('/login')
      .set('X-Forwarded-For', IP_OK)
      .send({ login: 'good@user.test', password: 'right' });
    expect(success.status).toBe(200);
    expect(success.body.ok).toBe(true);

    // Same identifier + IP, just-after-success. The bucket must be empty so
    // the next attempt is allowed even if it fails — otherwise a legit user
    // gets locked out by a single typo after a successful sign-in.
    const next = await request(app)
      .post('/login')
      .set('X-Forwarded-For', IP_OK)
      .send({ login: 'good@user.test', password: 'wrong', fail: '1' });
    expect(next.status).toBe(200);
  });
});
