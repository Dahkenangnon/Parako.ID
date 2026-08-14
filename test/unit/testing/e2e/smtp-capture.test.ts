import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it } from 'vitest';

import { SmtpCaptureServer } from '../../../e2e/support/smtp-capture.mjs';

describe('SmtpCaptureServer', () => {
  const servers: SmtpCaptureServer[] = [];

  async function startServer(): Promise<SmtpCaptureServer> {
    const server = new SmtpCaptureServer({
      host: '127.0.0.1',
      port: 0,
      username: 'parako-e2e',
      // gitleaks:allow -- deterministic credential for an isolated SMTP test.
      password: 'smtp-capture-test-password',
    });
    servers.push(server);
    await server.start();
    return server;
  }

  function createTransport(
    server: SmtpCaptureServer,
    password = 'smtp-capture-test-password'
  ) {
    return nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: false,
      pool: true,
      auth: { user: 'parako-e2e', pass: password },
      tls: { rejectUnauthorized: false },
    });
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.close()));
  });

  it('accepts authenticated pooled Nodemailer messages and exposes the envelope and source', async () => {
    const server = await startServer();
    const transport = createTransport(server);

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
    const server = await startServer();
    const transport = createTransport(server, 'wrong-password');

    await expect(transport.verify()).rejects.toThrow();
    transport.close();
    expect(server.messages).toEqual([]);
  });

  it('rejects exactly the next message and then resumes capture', async () => {
    const server = await startServer();
    const transport = createTransport(server);
    await transport.verify();

    server.rejectNextMessage();
    await expect(
      transport.sendMail({
        from: 'no-reply@parako.test',
        to: 'first@example.test',
        subject: 'Rejected message',
        text: 'This delivery must fail.',
      })
    ).rejects.toThrow();
    expect(server.messages).toEqual([]);

    await transport.sendMail({
      from: 'no-reply@parako.test',
      to: 'second@example.test',
      subject: 'Accepted message',
      text: 'This delivery must succeed.',
    });
    transport.close();

    await expect.poll(() => server.messages.length).toBe(1);
    expect(server.messages[0]?.rcptTo).toEqual(['second@example.test']);
  });
});
