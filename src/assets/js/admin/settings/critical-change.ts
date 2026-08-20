export type SettingsConfirmationPrompt = (
  title: string,
  message: string,
  confirmText: string,
  cancelText: string
) => Promise<boolean>;

interface CriticalChangeCopy {
  section: string;
  title: string;
  warnings: string[];
}

function copyForAction(action: string): CriticalChangeCopy {
  if (action.includes('/settings/security/secrets')) {
    return {
      section: 'security-secrets',
      title: 'Security Secrets',
      warnings: [
        '• Changing JWT secrets will invalidate all existing tokens',
        '• Changing cookie secrets will log out all users',
        '• All users will need to re-authenticate',
      ],
    };
  }
  if (action.includes('/settings/security/mfa')) {
    return {
      section: 'security-mfa',
      title: 'MFA Configuration',
      warnings: [
        '• Disabling MFA methods may lock out users relying on them',
        '• WebAuthn changes affect passkey registration',
        '• Ensure you have tested the new configuration',
      ],
    };
  }
  if (action.includes('/settings/security/sessions')) {
    return {
      section: 'security-sessions',
      title: 'Session Configuration',
      warnings: [
        '• Session timeout changes affect active sessions',
        '• Binding changes may invalidate current sessions',
        '• Ensure you have tested the new configuration',
      ],
    };
  }
  if (action.includes('/settings/security/protection')) {
    return {
      section: 'security-protection',
      title: 'Protection Configuration',
      warnings: [
        '• Rate limiting changes take effect immediately',
        '• Device matching changes affect login verification',
        '• Ensure you have tested the new configuration',
      ],
    };
  }
  if (action.includes('/settings/security')) {
    return {
      section: 'security-authentication',
      title: 'Authentication Configuration',
      warnings: [
        '• Login method changes affect how users sign in',
        '• Password policy changes apply to new passwords only',
        '• Registration changes take effect immediately',
      ],
    };
  }
  if (action.includes('/settings/oidc')) {
    return {
      section: 'oidc',
      title: 'OIDC Configuration',
      warnings: [
        '• Changing the OIDC issuer will break all OIDC clients',
        '• Token TTL changes affect active tokens',
        '• JWKS changes require client updates',
        '• May require OIDC client reconfiguration',
      ],
    };
  }
  if (action.includes('/settings/integrations')) {
    return {
      section: 'integrations',
      title: 'Integrations Configuration',
      warnings: [
        '• Email configuration changes affect password resets',
        '• OAuth client changes may break social login',
        '• Test connections before saving',
      ],
    };
  }
  return { section: 'unknown', title: 'Configuration', warnings: [] };
}

function readServerWarnings(form: HTMLFormElement): string[] {
  const input = form.querySelector<HTMLInputElement>(
    'input[name="validation_warnings"]'
  );
  if (!input?.value) return [];

  try {
    const parsed: unknown = JSON.parse(input.value);
    return Array.isArray(parsed) &&
      parsed.every(warning => typeof warning === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export async function confirmCriticalSettingsChange(
  event: Event,
  prompt: SettingsConfirmationPrompt,
  onDecision?: (confirmed: boolean, section: string) => void
): Promise<boolean> {
  const form = (event.currentTarget ?? event.target) as HTMLFormElement;
  event.preventDefault();

  const copy = copyForAction(form.action || '');
  const serverWarnings = readServerWarnings(form);
  if (serverWarnings.length > 0) {
    copy.warnings.push('', 'Server Validation Warnings:');
    serverWarnings.forEach(warning => copy.warnings.push(`• ${warning}`));
  }

  const message =
    `You are about to save changes to ${copy.title}.\n\n` +
    'IMPORTANT: This action may have significant impact:\n\n' +
    copy.warnings.join('\n') +
    '\n\nAre you sure you want to proceed?';

  const confirmed = await prompt(
    `Confirm ${copy.title} Changes`,
    message,
    'Yes, Save Changes',
    'Cancel'
  );
  onDecision?.(confirmed, copy.section);

  if (confirmed) form.submit();
  return confirmed;
}
