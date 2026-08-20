import { afterEach, describe, expect, it, vi } from 'vitest';

function createConfig() {
  return {
    application: {
      description: 'Identity for everyone',
      locales: { default: 'en' },
      title: 'Parako.ID',
    },
    branding: {
      colors: { light: { primary: '#123456' } },
      companyName: 'Parako',
    },
    deployment: {
      environment: 'production',
      url: 'https://id.example.com',
    },
    integrations: {
      email: {
        from: 'no-reply@example.com',
        smtp_host: 'smtp.example.com',
        smtp_password: 'secret',
        smtp_port: 587,
        smtp_username: 'mailer',
      },
      urls: {
        contact: 'https://example.com/contact',
        privacy_policy: 'https://example.com/privacy',
        terms_of_service: 'https://example.com/terms',
        website: 'https://example.com',
      },
    },
  };
}

async function createHarness(
  options: {
    config?: ReturnType<typeof createConfig>;
    translations?: Record<string, string>;
  } = {}
) {
  const config = options.config ?? createConfig();
  const transporter = {
    close: vi.fn(),
    sendMail: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue(undefined),
  };
  const render = vi.fn(() => '<html>rendered</html>');
  const readFileSync = vi.fn(() => '<p>template</p>');
  const realpathSync = vi.fn((value: string) => value);
  const createTransport = vi.fn(() => transporter);
  const loaders: Array<{ searchPath: string }> = [];
  const environments: Array<{ loader: unknown; options: unknown }> = [];
  vi.doMock('node:fs', () => ({
    default: {
      readFileSync,
      realpathSync,
    },
  }));
  vi.doMock('nodemailer', () => ({
    default: { createTransport },
  }));
  vi.doMock('nunjucks', () => ({
    default: {
      Environment: class {
        public render = render;

        constructor(loader: unknown, environmentOptions: unknown) {
          environments.push({ loader, options: environmentOptions });
        }
      },
      FileSystemLoader: class {
        public readonly searchPath: string;

        constructor(searchPath: string) {
          this.searchPath = searchPath;
          loaders.push(this);
        }
      },
    },
  }));

  const { default: EmailUtils } = await import('../../../src/utils/email.js');
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const configManager = {
    getConfig: vi.fn(() => config),
    subscribe: vi.fn(),
  };
  const i18nService = {
    __: vi.fn((key: string) => options.translations?.[key] ?? key),
    setLocale: vi.fn(),
  };
  const email = new EmailUtils(
    configManager as never,
    logger as never,
    { rootDir: '/srv/parako' } as never,
    i18nService as never
  );

  return {
    configManager,
    createTransport,
    email,
    environments,
    i18nService,
    loaders,
    logger,
    readFileSync,
    realpathSync,
    render,
    transporter,
  };
}

describe('EmailUtils', () => {
  afterEach(() => {
    vi.doUnmock('node:fs');
    vi.doUnmock('nunjucks');
    vi.doUnmock('nodemailer');
    vi.resetModules();
  });

  it('rejects custom email template paths that escape the configured views root', async () => {
    const readFileSync = vi.fn(() => '<p>outside template</p>');
    vi.doMock('node:fs', () => ({
      default: {
        readFileSync,
        realpathSync: vi.fn((value: string) => value),
      },
    }));
    vi.doMock('nodemailer', () => ({
      default: {
        createTransport: vi.fn(() => ({
          close: vi.fn(),
          sendMail: vi.fn(),
          verify: vi.fn(),
        })),
      },
    }));

    const { default: EmailUtils } = await import('../../../src/utils/email.js');
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const configManager = {
      getConfig: vi.fn(() => ({
        application: {
          description: 'Identity for everyone',
          locales: { default: 'en' },
          title: 'Parako.ID',
        },
        branding: {
          companyName: 'Parako',
          ui: {
            customization: {
              enabled: true,
              rootPath: 'runtime/views',
              views: { email: { mail: '../../secrets/mail.njk' } },
            },
          },
        },
        deployment: {
          environment: 'production',
          url: 'https://id.example.com',
        },
        integrations: {
          email: {
            from: 'no-reply@example.com',
            smtp_host: 'smtp.example.com',
            smtp_password: 'secret',
            smtp_port: 587,
            smtp_username: 'mailer',
          },
          urls: {
            contact: 'https://example.com/contact',
            privacy_policy: 'https://example.com/privacy',
            terms_of_service: 'https://example.com/terms',
            website: 'https://example.com',
          },
        },
      })),
      subscribe: vi.fn(),
    };
    const email = new EmailUtils(
      configManager as never,
      logger as never,
      { rootDir: '/srv/parako' } as never,
      { __: vi.fn((key: string) => key), setLocale: vi.fn() } as never
    );

    email.initialize();

    expect(readFileSync).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Custom email template configured but not found or invalid',
      expect.objectContaining({
        configuredPath: '../../secrets/mail.njk',
      })
    );
  }, 30_000);

  it('rejects custom email templates whose canonical path escapes through a symlink', async () => {
    const readFileSync = vi.fn(() => '<p>outside template</p>');
    const realpathSync = vi.fn((filePath: string) =>
      filePath.endsWith('runtime/views')
        ? '/srv/parako/runtime/views'
        : '/srv/parako/secrets/mail.njk'
    );
    vi.doMock('node:fs', () => ({
      default: { readFileSync, realpathSync },
    }));
    vi.doMock('nodemailer', () => ({
      default: {
        createTransport: vi.fn(() => ({
          close: vi.fn(),
          sendMail: vi.fn(),
          verify: vi.fn(),
        })),
      },
    }));

    const { default: EmailUtils } = await import('../../../src/utils/email.js');
    const configManager = {
      getConfig: vi.fn(() => ({
        branding: {
          ui: {
            customization: {
              enabled: true,
              rootPath: 'runtime/views',
              views: { email: { mail: 'linked-mail.njk' } },
            },
          },
        },
        deployment: { environment: 'production' },
        integrations: {
          email: {
            smtp_host: 'smtp.example.com',
            smtp_password: 'secret',
            smtp_port: 587,
            smtp_username: 'mailer',
          },
        },
      })),
      subscribe: vi.fn(),
    };
    const email = new EmailUtils(
      configManager as never,
      { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
      { rootDir: '/srv/parako' } as never,
      { __: vi.fn(), setLocale: vi.fn() } as never
    );

    email.initialize();

    expect(realpathSync).toHaveBeenCalledWith('/srv/parako/runtime/views');
    expect(realpathSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/views/linked-mail.njk'
    );
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('propagates the requested locale for generic notification emails', async () => {
    const { email } = await createHarness();
    const sendTemplatedEmail = vi
      .spyOn(email, 'sendTemplatedEmail')
      .mockResolvedValue(undefined);

    await email.sendNotificationEmail(
      'user@example.com',
      'Maria',
      'Security notice',
      'Your account changed',
      'https://id.example.com/accounts/security',
      'Review account',
      'fr'
    );

    expect(sendTemplatedEmail).toHaveBeenCalledWith(
      'user@example.com',
      'Security notice',
      'email/mail.njk',
      {
        actions: [
          {
            text: 'Review account',
            url: 'https://id.example.com/accounts/security',
          },
        ],
        content: 'Your account changed',
        title: 'Security notice',
        username: 'Maria',
      },
      'fr'
    );
  });

  it('initializes a pooled SMTP transport with secure production defaults', async () => {
    const { createTransport, email, environments, loaders } =
      await createHarness();

    email.initialize();

    expect(createTransport).toHaveBeenCalledWith({
      auth: { pass: 'secret', user: 'mailer' },
      host: 'smtp.example.com',
      maxConnections: 5,
      maxMessages: 100,
      pool: true,
      port: 587,
      secure: false,
      tls: { rejectUnauthorized: true },
    });
    expect(loaders.at(-1)?.searchPath).toBe('/srv/parako/dist/src/views');
    expect(environments.at(-1)?.options).toEqual({
      autoescape: true,
      lstripBlocks: true,
      noCache: false,
      throwOnUndefined: false,
      trimBlocks: true,
    });
  });

  it('uses development TLS/cache defaults and honors an explicit TLS override', async () => {
    const developmentConfig = createConfig();
    developmentConfig.deployment.environment = 'development';
    const development = await createHarness({ config: developmentConfig });
    development.email.initialize();

    expect(development.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ tls: { rejectUnauthorized: false } })
    );
    expect(development.environments.at(-1)?.options).toEqual(
      expect.objectContaining({ noCache: true })
    );

    vi.doUnmock('node:fs');
    vi.doUnmock('nunjucks');
    vi.doUnmock('nodemailer');
    vi.resetModules();

    const productionConfig = createConfig();
    Object.assign(productionConfig.integrations.email, {
      tls_reject_unauthorized: false,
    });
    const production = await createHarness({ config: productionConfig });
    production.email.initialize();

    expect(production.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ tls: { rejectUnauthorized: false } })
    );
  });

  it('reinitializes when its configuration subscription is notified', async () => {
    const { configManager, createTransport, email, logger } =
      await createHarness();
    const callback = configManager.subscribe.mock.calls[0]?.[1] as () => void;

    email.initialize();
    callback();

    expect(createTransport).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      'Configuration updated, reinitializing email service'
    );
  });

  it('loads a valid canonical custom template and renders complete localized context', async () => {
    const config = createConfig();
    Object.assign(config.branding, {
      ui: {
        customization: {
          enabled: true,
          rootPath: 'runtime/views',
          views: { email: { mail: 'tenant/mail.njk' } },
        },
      },
    });
    const { email, i18nService, loaders, logger, render } = await createHarness(
      { config, translations: { greeting: 'Bonjour' } }
    );

    email.initialize();
    const result = email.renderTemplate(
      'email/mail.njk',
      { privacyUrl: 'https://tenant.example/privacy', title: 'Hello' },
      'fr'
    );

    expect(result).toBe('<html>rendered</html>');
    expect(loaders.at(-1)?.searchPath).toBe('/srv/parako/runtime/views/tenant');
    expect(logger.info).toHaveBeenCalledWith('Custom email template loaded', {
      customTemplate: 'mail.njk',
    });
    expect(i18nService.setLocale).toHaveBeenCalledWith('fr');
    const [template, data] = render.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(template).toBe('mail.njk');
    expect(data).toMatchObject({
      appDescription: 'Identity for everyone',
      appTitle: 'Parako.ID',
      appUrl: 'https://id.example.com',
      brandColors: { primary: '#123456' },
      branding: config.branding,
      companyName: 'Parako',
      contactUrl: 'https://example.com/contact',
      currentYear: new Date().getFullYear(),
      locale: 'fr',
      privacyUrl: 'https://tenant.example/privacy',
      termsUrl: 'https://example.com/terms',
      title: 'Hello',
      websiteUrl: 'https://example.com',
    });
    expect((data.t as (key: string) => string)('greeting')).toBe('Bonjour');
  });

  it('renders the requested built-in template with default locale and brand color', async () => {
    const config = createConfig();
    delete (config.branding as { colors?: typeof config.branding.colors })
      .colors;
    const { email, i18nService, render } = await createHarness({ config });
    email.initialize();

    email.renderTemplate('email/mail.njk', { title: 'Hello' });

    expect(i18nService.setLocale).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith(
      'email/mail.njk',
      expect.objectContaining({
        brandColors: { primary: '#2656a8' },
        locale: 'en',
        privacyUrl: 'https://example.com/privacy',
      })
    );
  });

  it('reports attempts to render before initialization and template-engine failures', async () => {
    const { email, logger, render } = await createHarness();

    expect(() =>
      email.renderTemplate('email/mail.njk', { title: 'Hello' })
    ).toThrow('Nunjucks environment not initialized');
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        context: 'email_template_rendering_failed',
        customTemplateUsed: false,
        template: 'email/mail.njk',
      })
    );

    email.initialize();
    const renderError = new Error('template failed');
    render.mockImplementationOnce(() => {
      throw renderError;
    });

    expect(() =>
      email.renderTemplate('email/mail.njk', { title: 'Hello' }, 'fr')
    ).toThrow(renderError);
    expect(logger.error).toHaveBeenLastCalledWith(
      renderError,
      expect.objectContaining({ locale: 'fr' })
    );
  });

  it.each(['ENOENT', 'EISDIR'])(
    'falls back quietly when custom template canonicalization fails with %s',
    async code => {
      const config = createConfig();
      Object.assign(config.branding, {
        ui: {
          customization: {
            enabled: true,
            views: { email: { mail: 'mail.njk' } },
          },
        },
      });
      const { email, logger, realpathSync, readFileSync } = await createHarness(
        { config }
      );
      realpathSync.mockImplementation(() => {
        throw Object.assign(new Error(code), { code });
      });

      email.initialize();

      expect(readFileSync).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Custom email template configured but not found or invalid',
        expect.any(Object)
      );
    }
  );

  it('logs unexpected canonicalization errors and uses the built-in template', async () => {
    const config = createConfig();
    Object.assign(config.branding, {
      ui: {
        customization: {
          enabled: true,
          views: { email: { mail: 'mail.njk' } },
        },
      },
    });
    const { email, logger, realpathSync } = await createHarness({ config });
    realpathSync.mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    email.initialize();

    expect(logger.error).toHaveBeenCalledWith('permission denied', {
      context: 'failed_to_check_if_template_file_exists',
      filePath: '/srv/parako/runtime/views/mail.njk',
    });
  });

  it.each([
    { code: undefined, content: '   ', logsError: false },
    { code: 'ENOENT', content: undefined, logsError: false },
    { code: 'EISDIR', content: undefined, logsError: false },
    { code: 'EACCES', content: undefined, logsError: true },
  ])(
    'falls back for an invalid custom template file ($code)',
    async ({ code, content, logsError }) => {
      const config = createConfig();
      Object.assign(config.branding, {
        ui: {
          customization: {
            enabled: true,
            views: { email: { mail: 'mail.njk' } },
          },
        },
      });
      const { email, logger, readFileSync } = await createHarness({ config });
      if (code) {
        readFileSync.mockImplementation(() => {
          throw Object.assign(new Error(code), { code });
        });
      } else {
        readFileSync.mockReturnValue(content ?? '');
      }

      email.initialize();

      expect(logger.warn).toHaveBeenCalledWith(
        'Custom email template configured but not found or invalid',
        expect.any(Object)
      );
      expect(logger.error).toHaveBeenCalledTimes(logsError ? 1 : 0);
    }
  );

  it('skips SMTP verification in configured environments', async () => {
    const config = createConfig();
    config.deployment.environment = 'test';
    const { email, logger, transporter } = await createHarness({ config });

    await expect(email.connectToEmailServer()).resolves.toBe(true);

    expect(transporter.verify).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Email server connection skipped for environment: test'
    );
  });

  it('verifies and closes the pooled SMTP connection', async () => {
    const { email, logger, transporter } = await createHarness();
    email.initialize();

    await expect(email.connectToEmailServer([])).resolves.toBe(true);
    await email.closeConnection();

    expect(transporter.verify).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      '🟢 Connected to email server (with connection pooling)'
    );
    expect(transporter.close).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith('SMTP connection pool closed');
  });

  it('reports SMTP verification failures without marking the service connected', async () => {
    const { email, logger, transporter } = await createHarness();
    const connectionError = new Error('smtp unavailable');
    transporter.verify.mockRejectedValue(connectionError);
    email.initialize();

    await expect(email.connectToEmailServer([])).resolves.toBe(false);

    expect(logger.warn).toHaveBeenCalledWith(
      '🔴 Unable to connect to email server. Make sure you have configured the SMTP options.'
    );
    expect(logger.error).toHaveBeenCalledWith('smtp unavailable', {
      context: 'failed_to_connect_to_email_server',
      skipEnvs: [],
    });
  });

  it('does nothing when closing before a transport is initialized', async () => {
    const { email, logger, transporter } = await createHarness();

    await email.closeConnection();

    expect(transporter.close).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith('SMTP connection pool closed');
  });

  it('connects once and sends complete or minimal email options', async () => {
    const { email, transporter } = await createHarness();
    email.initialize();

    await email.sendEmail(
      'user@example.com',
      'Subject',
      'Plain text',
      '<p>HTML</p>'
    );
    await email.sendEmail('second@example.com', 'Minimal');

    expect(transporter.verify).toHaveBeenCalledOnce();
    expect(transporter.sendMail).toHaveBeenNthCalledWith(1, {
      from: 'no-reply@example.com',
      html: '<p>HTML</p>',
      subject: 'Subject',
      text: 'Plain text',
      to: 'user@example.com',
    });
    expect(transporter.sendMail).toHaveBeenNthCalledWith(2, {
      from: 'no-reply@example.com',
      subject: 'Minimal',
      to: 'second@example.com',
    });
  });

  it('rejects sending when the SMTP connection cannot be established', async () => {
    const { email, logger, transporter } = await createHarness();
    transporter.verify.mockRejectedValue(new Error('offline'));
    email.initialize();

    await expect(
      email.sendEmail('user@example.com', 'Subject')
    ).rejects.toThrow('Email server not connected');

    expect(transporter.sendMail).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Cannot send email: not connected to email server'
    );
  });

  it('logs and rethrows SMTP send failures', async () => {
    const { email, logger, transporter } = await createHarness();
    const sendError = new Error('delivery rejected');
    transporter.sendMail.mockRejectedValue(sendError);
    email.initialize();

    await expect(email.sendEmail('user@example.com', 'Subject')).rejects.toBe(
      sendError
    );

    expect(logger.error).toHaveBeenCalledWith(sendError, {
      context: 'email_sending_failed',
      to: 'user@example.com',
    });
  });

  it.each([
    {
      data: { content: ' Hello <strong>world</strong>\n<script>x</script> ' },
      expectedText: 'Hello world x',
      name: 'HTML content',
    },
    {
      data: { title: 'Fallback title' },
      expectedText: 'Fallback title',
      name: 'title',
    },
    { data: {}, expectedText: 'Subject', name: 'subject' },
  ])('derives plain text from $name', async ({ data, expectedText }) => {
    const { email } = await createHarness();
    email.initialize();
    const sendEmail = vi.spyOn(email, 'sendEmail').mockResolvedValue(undefined);

    await email.sendTemplatedEmail(
      'user@example.com',
      'Subject',
      'email/mail.njk',
      data,
      'fr'
    );

    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com',
      'Subject',
      expectedText,
      '<html>rendered</html>'
    );
  });

  it('logs and rethrows templated-email failures with context', async () => {
    const { email, logger, render } = await createHarness();
    email.initialize();
    const renderError = new Error('cannot render');
    render.mockImplementationOnce(() => {
      throw renderError;
    });

    await expect(
      email.sendTemplatedEmail(
        'user@example.com',
        'Subject',
        'email/mail.njk',
        { title: 'Hello' }
      )
    ).rejects.toBe(renderError);

    expect(logger.error).toHaveBeenLastCalledWith(renderError, {
      context: 'templated_email_sending_failed',
      template: 'email/mail.njk',
      to: 'user@example.com',
    });
  });

  it('builds localized verification and password-reset messages', async () => {
    const { email, i18nService } = await createHarness({
      translations: {
        'email.password_reset.body': 'Reset your password.',
        'email.password_reset.button': 'Reset password',
        'email.password_reset.expires': 'Expires in {{hours}} hour.',
        'email.password_reset.ignore': 'Ignore this request.',
        'email.password_reset.title': 'Password reset',
        'email.subject.email_verification': 'Verify your email',
        'email.subject.password_reset': 'Reset your password',
        'email.verification.body': 'Please verify your email.',
        'email.verification.button': 'Verify email',
        'email.verification.expires': 'Expires in {{hours}} hours.',
        'email.verification.ignore': 'Ignore this request.',
        'email.verification.title': 'Email verification',
      },
    });
    const sendTemplatedEmail = vi
      .spyOn(email, 'sendTemplatedEmail')
      .mockResolvedValue(undefined);

    await email.sendVerificationEmail(
      'user@example.com',
      'Maria',
      'https://id.example.com/verify',
      'fr'
    );
    await email.sendPasswordResetEmail(
      'user@example.com',
      'Maria',
      'https://id.example.com/reset',
      'fr'
    );

    expect(i18nService.setLocale).toHaveBeenCalledTimes(2);
    expect(sendTemplatedEmail).toHaveBeenNthCalledWith(
      1,
      'user@example.com',
      'Verify your email',
      'email/mail.njk',
      expect.objectContaining({
        actions: [
          { text: 'Verify email', url: 'https://id.example.com/verify' },
        ],
        content: expect.stringContaining('Expires in 24 hours.'),
        title: 'Email verification',
        username: 'Maria',
      }),
      'fr'
    );
    expect(sendTemplatedEmail).toHaveBeenNthCalledWith(
      2,
      'user@example.com',
      'Reset your password',
      'email/mail.njk',
      expect.objectContaining({
        actions: [
          { text: 'Reset password', url: 'https://id.example.com/reset' },
        ],
        content: expect.stringContaining('Expires in 1 hour.'),
        title: 'Password reset',
      }),
      'fr'
    );
  });

  it('escapes configuration values interpolated into welcome messages', async () => {
    const config = createConfig();
    config.application.title = '<Parako & ID>';
    config.application.description = '<strong>Secure</strong>';
    const { email } = await createHarness({
      config,
      translations: {
        'email.subject.welcome': 'Welcome to {{appName}}',
        'email.welcome.body_description': '{{appDescription}}',
        'email.welcome.body_intro': 'Welcome to {{appName}}',
        'email.welcome.button': 'Open account',
        'email.welcome.features_intro': '{{appName}} includes:',
        'email.welcome.get_started': 'Get started.',
        'email.welcome.title': 'Welcome to {{appName}}',
      },
    });
    const sendTemplatedEmail = vi
      .spyOn(email, 'sendTemplatedEmail')
      .mockResolvedValue(undefined);

    await email.sendWelcomeEmail('user@example.com', 'Maria', 'fr');

    const [to, subject, template, data, locale] = sendTemplatedEmail.mock
      .calls[0] as [string, string, string, Record<string, unknown>, string];
    expect(to).toBe('user@example.com');
    expect(subject).toBe('Welcome to &lt;Parako &amp; ID&gt;');
    expect(template).toBe('email/mail.njk');
    expect(data.title).toBe('Welcome to &lt;Parako &amp; ID&gt;');
    expect(data.content).toContain('&lt;strong&gt;Secure&lt;&#x2F;strong&gt;');
    expect(data.content).not.toContain('<strong>Secure</strong>');
    expect(data.actions).toEqual([
      {
        text: 'Open account',
        url: 'https://id.example.com/accounts/',
      },
    ]);
    expect(locale).toBe('fr');
  });

  it('escapes user-controlled security alert values', async () => {
    const { email } = await createHarness({
      translations: {
        'email.security_alert.body': 'Alert from {{appName}}',
        'email.security_alert.title': 'Alert: {{alertType}}',
      },
    });
    const sendTemplatedEmail = vi
      .spyOn(email, 'sendTemplatedEmail')
      .mockResolvedValue(undefined);

    await email.sendSecurityAlertEmail(
      'user@example.com',
      'Maria',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'fr'
    );

    const data = sendTemplatedEmail.mock.calls[0]?.[3] as Record<
      string,
      unknown
    >;
    expect(data.title).toBe(
      'Alert: &lt;script&gt;alert(1)&lt;&#x2F;script&gt;'
    );
    expect(data.content).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(data.content).not.toContain('<script>');
  });

  it('builds escaped new-session security details and account action', async () => {
    const { email } = await createHarness({
      translations: {
        'email.new_session.body': 'New session in {{appName}}',
        'email.subject.new_session': '{{appName}} session',
      },
    });
    const sendTemplatedEmail = vi
      .spyOn(email, 'sendTemplatedEmail')
      .mockResolvedValue(undefined);
    const timestamp = new Date('2026-08-01T12:00:00.000Z');

    await email.sendNewSessionNotification({
      email: 'user@example.com',
      ip: '<127.0.0.1>',
      locale: 'fr',
      timestamp,
      userAgent: '<Browser>',
      username: 'Maria',
    });

    const data = sendTemplatedEmail.mock.calls[0]?.[3] as Record<
      string,
      unknown
    >;
    expect(data.content).toContain('&lt;127.0.0.1&gt;');
    expect(data.content).toContain('&lt;Browser&gt;');
    expect(data.content).toContain(
      timestamp.toLocaleString().replaceAll('/', '&#x2F;')
    );
    expect(data.actions).toEqual([
      {
        text: 'email.new_session.button',
        url: 'https://id.example.com/accounts/security',
      },
    ]);
  });

  it('builds an escaped new-device OTP message without actions', async () => {
    const { email } = await createHarness({
      translations: {
        'email.new_device_otp.body': 'New device in {{appName}}',
        'email.subject.new_device_otp': '{{appName}} device code',
      },
    });
    const sendTemplatedEmail = vi
      .spyOn(email, 'sendTemplatedEmail')
      .mockResolvedValue(undefined);

    await email.sendNewDeviceOtpEmail({
      deviceInfo: '<Browser>',
      email: 'user@example.com',
      ip: '<127.0.0.1>',
      locale: 'fr',
      otp: '<123456>',
      username: 'Maria',
    });

    const data = sendTemplatedEmail.mock.calls[0]?.[3] as Record<
      string,
      unknown
    >;
    expect(data.content).toContain('&lt;123456&gt;');
    expect(data.content).toContain('&lt;Browser&gt;');
    expect(data.content).toContain('&lt;127.0.0.1&gt;');
    expect(data).not.toHaveProperty('actions');
  });

  it('omits generic notification actions unless both URL and text exist', async () => {
    const { email } = await createHarness();
    const sendTemplatedEmail = vi
      .spyOn(email, 'sendTemplatedEmail')
      .mockResolvedValue(undefined);

    await email.sendNotificationEmail(
      'user@example.com',
      'Maria',
      'Notice',
      'Content',
      'https://id.example.com/action',
      undefined,
      'fr'
    );

    expect(sendTemplatedEmail).toHaveBeenCalledWith(
      'user@example.com',
      'Notice',
      'email/mail.njk',
      { content: 'Content', title: 'Notice', username: 'Maria' },
      'fr'
    );
  });

  it('uses the current i18n locale when public notification methods omit locale', async () => {
    const { email, i18nService } = await createHarness();
    const sendTemplatedEmail = vi
      .spyOn(email, 'sendTemplatedEmail')
      .mockResolvedValue(undefined);

    await email.sendVerificationEmail('user@example.com', 'Maria', '/verify');
    await email.sendPasswordResetEmail('user@example.com', 'Maria', '/reset');
    await email.sendWelcomeEmail('user@example.com', 'Maria');
    await email.sendSecurityAlertEmail(
      'user@example.com',
      'Maria',
      'Login',
      'Unknown browser'
    );
    await email.sendNewSessionNotification({
      email: 'user@example.com',
      ip: '127.0.0.1',
      timestamp: new Date('2026-08-01T12:00:00.000Z'),
      userAgent: 'Browser',
      username: 'Maria',
    });
    await email.sendNewDeviceOtpEmail({
      deviceInfo: 'Browser',
      email: 'user@example.com',
      ip: '127.0.0.1',
      otp: '123456',
      username: 'Maria',
    });

    expect(i18nService.setLocale).not.toHaveBeenCalled();
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(6);
    for (const call of sendTemplatedEmail.mock.calls) {
      expect(call[4]).toBeUndefined();
    }
  });
});
