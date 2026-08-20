const EMAIL_ADDRESS_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const FREE_EMAIL_PROVIDERS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'protonmail.com',
  'mail.com',
]);

export interface TestEmailDependencies {
  getDeploymentUrl(): string | undefined;
  initialize(): void;
  sendEmail(
    recipient: string,
    subject: string,
    text: string,
    html: string
  ): Promise<void>;
  now(): Date;
}

export type TestEmailResult =
  | {
      status: 'invalid';
      error: string;
      auditDescription: string;
      auditData?: Record<string, unknown>;
    }
  | {
      status: 'sent';
      recipientEmail: string;
      recipientDomain: string;
      appDomain: string;
      isExternalDomain: boolean;
      isFreeProvider: boolean;
    };

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] as string
  );
}

function validateRecipient(
  email: unknown
): Extract<TestEmailResult, { status: 'invalid' }> | null {
  if (!email) {
    return {
      status: 'invalid',
      error: 'Email address is required',
      auditDescription: 'Test email failed: Email address is required',
    };
  }

  if (typeof email !== 'string') {
    return {
      status: 'invalid',
      error: 'Invalid email address format',
      auditDescription: 'Test email failed: Invalid email format',
    };
  }

  if (email.length > 254) {
    return {
      status: 'invalid',
      error: 'Email address is too long',
      auditDescription: 'Test email failed: Email address too long',
      auditData: { emailLength: email.length },
    };
  }

  if (!EMAIL_ADDRESS_PATTERN.test(email)) {
    return {
      status: 'invalid',
      error: 'Invalid email address format',
      auditDescription: 'Test email failed: Invalid email format',
    };
  }

  return null;
}

export class TestEmailService {
  constructor(private readonly dependencies: TestEmailDependencies) {}

  async send(email: unknown, requestedBy: string): Promise<TestEmailResult> {
    const invalid = validateRecipient(email);
    if (invalid) return invalid;

    const recipientEmail = email as string;
    const recipientDomain = recipientEmail.split('@')[1].toLowerCase();
    const deploymentUrl =
      this.dependencies.getDeploymentUrl() || 'http://localhost:3000';
    const appDomain = new URL(deploymentUrl).hostname.toLowerCase();
    const isExternalDomain =
      recipientDomain !== appDomain &&
      !recipientDomain.endsWith(`.${appDomain}`);
    const isFreeProvider = FREE_EMAIL_PROVIDERS.has(recipientDomain);
    const timestamp = this.dependencies.now().toISOString();
    const safeRequestedBy = escapeHtml(requestedBy);

    const subject = 'Test Email from Parako.ID';
    const text = `This is a test email from your Parako.ID configuration. If you received this email, your SMTP settings are working correctly.\n\nTimestamp: ${timestamp}\nRequested by: ${requestedBy}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Test Email from Parako.ID</h2>
          <p>This is a test email from your Parako.ID configuration. If you received this email, your SMTP settings are working correctly.</p>
          <p><strong>Timestamp:</strong> ${timestamp}</p>
          <p><strong>Requested by:</strong> ${safeRequestedBy}</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">This is an automated test email. Please do not reply.</p>
        </div>
      `;

    this.dependencies.initialize();
    await this.dependencies.sendEmail(recipientEmail, subject, text, html);

    return {
      status: 'sent',
      recipientEmail,
      recipientDomain,
      appDomain,
      isExternalDomain,
      isFreeProvider,
    };
  }
}
