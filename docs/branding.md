---
title: 'Branding'
subtitle: 'Customize logos, colors, fonts, view templates, and localization'
category: 'Guides'
order: 5
---

## Branding Configuration

Customize the look and feel of your Parako.ID instance in the `branding` configuration section:

```jsonc
{
  "branding": {
    "companyName": "Your Organization",
    "logo": "/images/logo-light.svg",
    "logoDark": "/images/logo-dark.png",
    "logoIcon": "/images/icon.png",
    "logoIconDark": "/images/icon-dark.png",
    "favicon": "/images/favicon.ico",
  },
}
```

| Field          | Description                                         |
| -------------- | --------------------------------------------------- |
| `companyName`  | Organization name displayed in the UI and emails    |
| `logo`         | Main logo (light mode) — path or URL                |
| `logoDark`     | Logo for dark mode (optional, falls back to `logo`) |
| `logoIcon`     | Small icon for collapsed sidebar (optional)         |
| `logoIconDark` | Dark mode icon (optional)                           |
| `favicon`      | Browser tab icon (optional)                         |

### Fonts

Override the default font families:

```jsonc
{
  "branding": {
    "fonts": {
      "sans": "Inter, system-ui, sans-serif",
      "heading": "Cal Sans, Inter, sans-serif",
      "mono": "JetBrains Mono, monospace",
    },
  },
}
```

## Theme Colors

Parako.ID uses a comprehensive color token system with separate light and dark palettes. All values are CSS color strings (hex, RGB, HSL).

```jsonc
{
  "branding": {
    "colors": {
      "light": {
        "primary": "#1a73e8",
        "primaryForeground": "#ffffff",
        "secondary": "#f1f5f9",
        "secondaryForeground": "#0f172a",
        "accent": "#f1f5f9",
        "accentForeground": "#0f172a",
        "destructive": "#ef4444",
        "destructiveForeground": "#ffffff",
        "success": "#22c55e",
        "successForeground": "#ffffff",
        "warning": "#f59e0b",
        "warningForeground": "#ffffff",
        "info": "#3b82f6",
        "infoForeground": "#ffffff",
        "background": "#ffffff",
        "foreground": "#0f172a",
        "card": "#ffffff",
        "cardForeground": "#0f172a",
        "popover": "#ffffff",
        "popoverForeground": "#0f172a",
        "muted": "#f1f5f9",
        "mutedForeground": "#64748b",
        "border": "#e2e8f0",
        "input": "#e2e8f0",
        "ring": "#1a73e8",
      },
      "dark": {
        "primary": "#3b82f6",
        "primaryForeground": "#ffffff",
        "background": "#0f172a",
        "foreground": "#f8fafc",
      },
    },
  },
}
```

The dark palette follows the same structure as light. Any token not specified in the dark palette falls back to the light value.

### Sidebar Colors

Additional tokens for the admin panel sidebar:

| Token                      | Description            |
| -------------------------- | ---------------------- |
| `sidebar`                  | Sidebar background     |
| `sidebarForeground`        | Sidebar text           |
| `sidebarPrimary`           | Active item background |
| `sidebarPrimaryForeground` | Active item text       |
| `sidebarAccent`            | Hover item background  |
| `sidebarAccentForeground`  | Hover item text        |
| `sidebarBorder`            | Sidebar border         |
| `sidebarRing`              | Sidebar focus ring     |

## Custom View Templates

Override any of Parako.ID's Nunjucks view templates with your own versions.

### Enabling Customization

```jsonc
{
  "branding": {
    "ui": {
      "customization": {
        "enabled": true,
        "rootPath": "runtime/views",
      },
    },
  },
}
```

| Field      | Description                                |
| ---------- | ------------------------------------------ |
| `enabled`  | Enable custom view overrides               |
| `rootPath` | Directory containing your custom templates |

### Overridable Views

Place your custom template files in the `rootPath` directory, matching the original file structure:

| Category | Views                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth     | `login`, `register`, `forgot_password`, `reset_password`, `email_verification`, `verify_email`, `email_verification_success`, `account_select`, `continue`, `multi_factor`, `mfa_verify`, `mfa_resend`, `logout`, `social_password_setup`, `social_contact_info`, `account_recovery`, `recovery_backup_codes`, `recovery_secondary_email`, `recovery_verify_code`, `setup_mfa`, `social_callback` |
| OIDC     | `consent`, `device_flow_code_input`, `device_flow_confirm_code`, `device_flow_success`, `error`, `login`, `logout_success`, `logout`, `mfa`                                                                                                                                                                                                                                                       |
| Account  | `my_account`, `settings`, `apps`, `sessions`, `recovery_codes`, `recovery_setup`                                                                                                                                                                                                                                                                                                                  |
| Error    | `unauthorized`, `forbidden`, `notfound`, `server_error`, `rate_limit`                                                                                                                                                                                                                                                                                                                             |
| Email    | `mail`                                                                                                                                                                                                                                                                                                                                                                                            |
| Home     | `index`                                                                                                                                                                                                                                                                                                                                                                                           |

Only override the views you want to change. Unoverridden views use the built-in templates.

### Example: Custom Login Page

Create `custom-views/auth/login.njk`:

```html
{% extends "layouts/auth.njk" %} {% block content %}
<div class="custom-login">
  <h2>Welcome to {{ branding.companyName }}</h2>
  <form method="POST" action="{{ routes.authFull.login }}">
    <input type="hidden" name="_csrf" value="{{ csrfToken }}" />
    <input type="email" name="email" placeholder="Email" required />
    <input type="password" name="password" placeholder="Password" required />
    <button type="submit">Sign In</button>
  </form>
</div>
{% endblock %}
```

## Per-Tenant Branding

In multi-tenant mode, each tenant can override the global branding configuration with tenant-specific values.

Override via the admin panel (as `_platforms` superadmin) or the Management API:

```bash
curl -X PUT https://your-parako.example.com/api/v1/tenants/acme/config/branding \
  -H "Authorization: Bearer API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Acme Corp",
    "logo": "/uploads/acme-logo.png",
    "colors": {
      "light": {
        "primary": "#e11d48"
      }
    }
  }'
```

Tenant branding is merged with the global configuration — specify only the fields you want to override.

See [Multi-Tenancy](multi-tenancy.md) for details on tenant configuration management.

## Internationalization

Parako.ID supports 10 locales out of the box:

| Code | Language   |
| ---- | ---------- |
| `en` | English    |
| `fr` | French     |
| `es` | Spanish    |
| `pt` | Portuguese |
| `de` | German     |
| `it` | Italian    |
| `ru` | Russian    |
| `zh` | Chinese    |
| `ja` | Japanese   |
| `ko` | Korean     |

Configure the default and available locales:

```jsonc
{
  "application": {
    "locales": {
      "default": "en",
      "available": ["en", "fr", "es", "pt", "de", "it", "ru", "zh", "ja", "ko"],
    },
  },
}
```

The user's locale preference is stored in a cookie and can be changed from the login page or account settings. Remove locales from the `available` array to hide them from the locale selector.
