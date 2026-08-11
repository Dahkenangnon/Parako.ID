import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it } from 'vitest';

import { SmtpCaptureServer } from '../../../e2e/support/smtp-capture.mjs';

describe('SmtpCaptureServer', () => {
  const servers: SmtpCaptureServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.close()));
  });

  it('accepts authenticated pooled Nodemailer messages and exposes the envelope and source', async () => {
    const server = new SmtpCaptureServer({
      host: '127.0.0.1',
      port: 0,
      username: 'parako-e2e',
      // gitleaks:allow -- deterministic credential for an isolated SMTP test.
      password: 'smtp-capture-test-password',
    });
    servers.push(server);
    await server.start();

    const transport = nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: false,
      pool: true,
      auth: {
        user: 'parako-e2e',
        pass: 'smtp-capture-test-password',
      },
      tls: { rejectUnauthorized: false },
    });

    await transport.verify();
    await transport.sendMail({
      from: 'Parako <no-reply@parako.test>',
      to: 'person@example.test',
      subject: 'Reset your password',
      text: 'Open http://127.0.0.1/reset?token=abc123',
    });
    transport.close();

    await expect.poll(() => server.messages.length).toBe(1);
    expect(server.messages[0]).toMatchObject({
      mailFrom: 'no-reply@parako.test',
      rcptTo: ['person@example.test'],
    });
    expect(server.messages[0]?.source).toContain(
      'Subject: Reset your password'
    );
    expect(server.messages[0]?.source).toContain('token=abc123');

    server.clear();
    expect(server.messages).toEqual([]);
  });

  it('rejects invalid SMTP credentials without capturing a message', async () => {
    const server = new SmtpCaptureServer({
      host: '127.0.0.1',
      port: 0,
      username: 'parako-e2e',
      // gitleaks:allow -- deterministic credential for an isolated SMTP test.
      password: 'smtp-capture-test-password',
    });
    servers.push(server);
    await server.start();

    const transport = nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: false,
      auth: { user: 'parako-e2e', pass: 'wrong-password' },
    });

    await expect(transport.verify()).rejects.toThrow();
    transport.close();
    expect(server.messages).toEqual([]);
  });
});
