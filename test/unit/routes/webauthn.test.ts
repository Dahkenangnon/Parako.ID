import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { webauthnRoutes } from '../../../src/routes/webauthn.js';

function makeHarness() {
  const security = {
    requireAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) =>
      next()
    ),
    validateCsrfToken: vi.fn(
      (_req: Request, _res: Response, next: NextFunction) => next()
    ),
  };
  const handler = (name: string) =>
    vi.fn(async (_req: Request, res: Response) => res.json({ handler: name }));
  const controller = {
    getAuthenticationOptions: handler('getAuthenticationOptions'),
    verifyAuthentication: handler('verifyAuthentication'),
    getRegistrationOptions: handler('getRegistrationOptions'),
    verifyRegistration: handler('verifyRegistration'),
    listCredentials: handler('listCredentials'),
    removeCredential: handler('removeCredential'),
    renameCredential: handler('renameCredential'),
  };
  const logger = { info: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use(
    '/webauthn',
    webauthnRoutes(security as never, controller as never, logger as never)
  );
  app.use(
    (
      error: Error & { operation?: string },
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      res
        .status(500)
        .json({ error: error.message, operation: error.operation });
    }
  );
  return { app, controller, logger, security };
}

describe('webauthnRoutes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('protects login-time MFA endpoints with CSRF but not prior authentication', async () => {
    const { app, controller, security } = makeHarness();

    await request(app)
      .post('/webauthn/authenticate/options')
      .expect(200, { handler: 'getAuthenticationOptions' });
    await request(app)
      .post('/webauthn/authenticate/verify')
      .expect(200, { handler: 'verifyAuthentication' });

    expect(security.validateCsrfToken).toHaveBeenCalledTimes(2);
    expect(security.requireAuth).not.toHaveBeenCalled();
    expect(controller.getAuthenticationOptions).toHaveBeenCalledOnce();
    expect(controller.verifyAuthentication).toHaveBeenCalledOnce();
  });

  it('protects every credential-management endpoint with authentication and CSRF', async () => {
    const { app, controller, security } = makeHarness();

    await request(app)
      .post('/webauthn/register/options')
      .expect(200, { handler: 'getRegistrationOptions' });
    await request(app)
      .post('/webauthn/register/verify')
      .send({ credential: {}, friendly_name: 'Laptop' })
      .expect(200, { handler: 'verifyRegistration' });
    await request(app)
      .get('/webauthn/credentials')
      .expect(200, { handler: 'listCredentials' });
    await request(app)
      .delete('/webauthn/credentials/credential-1')
      .expect(200, { handler: 'removeCredential' });
    await request(app)
      .patch('/webauthn/credentials/credential-1')
      .send({ friendlyName: 'Work key' })
      .expect(200, { handler: 'renameCredential' });

    expect(security.requireAuth).toHaveBeenCalledTimes(5);
    expect(security.validateCsrfToken).toHaveBeenCalledTimes(5);
    expect(controller.verifyRegistration).toHaveBeenCalledOnce();
    expect(controller.renameCredential).toHaveBeenCalledOnce();
  });

  it('blocks invalid registration and rename payloads before controllers run', async () => {
    const { app, controller, logger } = makeHarness();

    const registration = await request(app)
      .post('/webauthn/register/verify')
      .send({ friendly_name: 'Laptop' })
      .expect(400);
    const rename = await request(app)
      .patch('/webauthn/credentials/credential-1')
      .send({ friendlyName: '   ' })
      .expect(400);

    expect(registration.body).toMatchObject({ success: false });
    expect(rename.body).toMatchObject({ success: false });
    expect(controller.verifyRegistration).not.toHaveBeenCalled();
    expect(controller.renameCredential).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('forwards async controller failures with their operation name', async () => {
    const { app, controller } = makeHarness();
    controller.getAuthenticationOptions.mockRejectedValue(
      new Error('options failed')
    );

    await request(app).post('/webauthn/authenticate/options').expect(500, {
      error: 'options failed',
      operation: 'webauthn.authenticate.options',
    });
  });
});
