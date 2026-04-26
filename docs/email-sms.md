---
title: 'Email & SMS'
subtitle: 'SMTP email configuration, templates, and Twilio SMS integration'
category: 'Guides'
order: 4
---

## Email Configuration

Parako.ID uses SMTP to send transactional emails. Configure your SMTP server in the `integrations.email` section:

```jsonc
{
  "integrations": {
    "email": {
      "smtp_host": "smtp.example.com",
      "smtp_port": 587,
      "smtp_username": "noreply@example.com",
      "smtp_password": "${SMTP_PASSWORD}",
      "from": "noreply@example.com",
    },
  },
}
```

| Field           | Default | Description                                    |
| --------------- | ------- | ---------------------------------------------- |
| `smtp_host`     | —       | SMTP server hostname                           |
| `smtp_port`     | 587     | SMTP port (587 for STARTTLS, 465 for SSL)      |
| `smtp_username` | —       | SMTP authentication username                   |
| `smtp_password` | —       | SMTP password (use `${SMTP_PASSWORD}` env var) |
| `from`          | —       | Sender email address                           |

Set the `SMTP_PASSWORD` in your `.env` file — never put it directly in the config file.

### Supported SMTP Providers

Any SMTP-compatible service works. Common options:

| Provider              | Host                                | Port |
| --------------------- | ----------------------------------- | ---- |
| AWS SES               | `email-smtp.<region>.amazonaws.com` | 587  |
| SendGrid              | `smtp.sendgrid.net`                 | 587  |
| Mailgun               | `smtp.mailgun.org`                  | 587  |
| Postmark              | `smtp.postmarkapp.com`              | 587  |
| Gmail                 | `smtp.gmail.com`                    | 587  |
| Self-hosted (Postfix) | `localhost`                         | 25   |

## Email Templates

Parako.ID uses Nunjucks templates for email content. Emails are sent for these events:

| Email              | Trigger                                                               |
| ------------------ | --------------------------------------------------------------------- |
| Email verification | User registers with email verification enabled                        |
| Password reset     | User requests password reset                                          |
| Email OTP          | MFA code via email                                                    |
| New device alert   | Login from unrecognized device (when `notify_new_session` is enabled) |
| New session alert  | Login from new location                                               |

Email templates are styled with inline CSS for maximum compatibility across email clients.

## AWS SES

To use Amazon SES as your email provider:

1. Verify your sender domain or email address in the [SES console](https://console.aws.amazon.com/ses/)
2. Create SMTP credentials in **SMTP Settings**
3. If your account is in the SES sandbox, verify recipient email addresses for testing
4. Request production access to remove sandbox restrictions

```bash
# .env
SMTP_PASSWORD=your_ses_smtp_password
```

```jsonc
{
  "integrations": {
    "email": {
      "smtp_host": "email-smtp.us-east-1.amazonaws.com",
      "smtp_port": 587,
      "smtp_username": "YOUR_SES_SMTP_USERNAME",
      "smtp_password": "${SMTP_PASSWORD}",
      "from": "noreply@yourdomain.com",
    },
  },
}
```

## SMS via Twilio

Parako.ID integrates with Twilio for SMS-based MFA and account recovery. SMS is disabled by default.

To enable:

1. Create a [Twilio account](https://www.twilio.com/) and get a phone number
2. Configure Twilio credentials in `notifications.channels.sms`
3. Enable SMS MFA and/or SMS recovery

### Twilio Configuration

```jsonc
{
  "notifications": {
    "channels": {
      "sms": {
        "enabled": true,
        "provider": "twilio",
        "api_key": "YOUR_TWILIO_ACCOUNT_SID",
        "api_secret": "YOUR_TWILIO_AUTH_TOKEN",
        "from_number": "+1234567890",
      },
    },
  },
}
```

| Field         | Description                       |
| ------------- | --------------------------------- |
| `enabled`     | Enable the SMS channel            |
| `provider`    | SMS provider (currently `twilio`) |
| `api_key`     | Twilio Account SID                |
| `api_secret`  | Twilio Auth Token                 |
| `from_number` | Twilio phone number to send from  |

### Enabling SMS Features

Once Twilio is configured, enable SMS for MFA and/or account recovery:

```jsonc
{
  "security": {
    "authentication": {
      "multi_factor": {
        "sms": {
          "enabled": true,
        },
      },
      "recovery": {
        "sms": {
          "enabled": true,
        },
      },
    },
  },
}
```

SMS is used for:

- MFA verification codes during login
- Account recovery when primary credentials are lost

## Notification Channels

Configure which notification channels are available and their default behavior:

```jsonc
{
  "notifications": {
    "channels": {
      "email": { "enabled": true },
      "sms": { "enabled": false },
    },
    "defaults": {
      "security_alerts": true,
      "new_session_alerts": true,
      "allow_user_preferences": true,
    },
  },
}
```

| Field                    | Default | Description                                                     |
| ------------------------ | ------- | --------------------------------------------------------------- |
| `channels.email.enabled` | `true`  | Enable email notifications                                      |
| `channels.sms.enabled`   | `false` | Enable SMS notifications                                        |
| `security_alerts`        | `true`  | Send alerts for security events (password changes, MFA changes) |
| `new_session_alerts`     | `true`  | Send alerts for new login sessions                              |
| `allow_user_preferences` | `true`  | Allow users to customize their notification preferences         |

When `allow_user_preferences` is enabled, users can manage their notification settings from their account page.
