import {
  KoaContextWithOIDC,
  Interaction as OidcInteraction,
  interactionPolicy,
} from 'oidc-provider';
import type { IConfigManager } from '../../di/interfaces/config-manager.interface.js';
import type { IUserService } from '../../di/interfaces/user-service.interface.js';
import type { ISessionManager } from '../../di/interfaces/session-manager.interface.js';
import type { ILogger } from '../../di/interfaces/logger.interface.js';

/**
 * Factory function to create interaction configuration
 * @param configManager - Configuration manager instance
 * @param userService - User service instance
 * @param sessionManager - Session manager instance
 * @param logger - Logger instance
 * @returns Interaction configuration object
 */
export default function Interaction(
  configManager: IConfigManager,
  userService: IUserService,
  sessionManager: ISessionManager,
  logger: ILogger
) {
  const config = configManager.getConfig();

  // Destructure helpers from the interactionPolicy API
  const { Prompt, Check, base: basePolicyFactory } = interactionPolicy;

  const basePolicy = basePolicyFactory();

  // ---------- SELECT_ACCOUNT PROMPT -------------

  const promptSelectAccount = new Prompt({
    name: 'select_account',
    requestable: true, // This prompt can be requested by clients
  });

  promptSelectAccount.checks.add(
    new Check(
      'select_account_prompt',
      'Account selection is required',
      async (ctx: KoaContextWithOIDC) => {
        const { params, session } = ctx.oidc;
        const prompt = (params?.prompt as string | undefined) ?? '';

        if (!prompt.includes('select_account')) {
          return Check.NO_NEED_TO_PROMPT;
        }

        // Use the same pattern as MFA - check if select_account is in amr
        const hasSelectAccount = (session?.amr || []).includes(
          'select_account'
        );

        if (hasSelectAccount) {
          return Check.NO_NEED_TO_PROMPT;
        }

        // Additional check: if we have a valid accountId and select_account is in the prompt,
        // but we don't have select_account in amr, it means we need to complete the selection
        // This prevents the infinite loop where the provider keeps creating new interactions
        if (
          session?.accountId &&
          prompt.includes('select_account') &&
          !hasSelectAccount
        ) {
          // This is a fallback to prevent infinite loops
          return Check.NO_NEED_TO_PROMPT;
        }

        const req = ctx.req as any;
        if (!req) {
          return Check.NO_NEED_TO_PROMPT;
        }

        const authenticatedUsers = sessionManager.getAuthenticatedUsers(req);
        if (!authenticatedUsers) {
          return Check.NO_NEED_TO_PROMPT;
        }

        const totalAccounts = 1 + (authenticatedUsers.others?.length || 0);

        if (totalAccounts < 2) {
          return Check.NO_NEED_TO_PROMPT;
        }

        return Check.REQUEST_PROMPT;
      }
    )
  );
  // ---------- MFA PROMPT -------------

  const promptMfa = new Prompt({
    name: 'mfa',
    requestable: false,
  });

  promptMfa.checks.add(
    new Check(
      'mfa_needed',
      'MFA is required but not yet satisfied',
      async (ctx: KoaContextWithOIDC) => {
        const mfaEnabled = config.security.authentication.multi_factor.enabled;

        if (!mfaEnabled) {
          logger.info('MFA check failed: MFA not enabled globally', {
            mfaEnabled,
          });
          return Check.NO_NEED_TO_PROMPT;
        }

        const { params, session } = ctx.oidc;
        const acrValues = (params?.acr_values as string | undefined) ?? '';
        const acrList = acrValues.split(' ');

        // Support both OTP (totp/email) and WebAuthn ACR values
        const wantsOtp = acrList.includes('urn:mfa:otp');
        const wantsWebAuthn = acrList.includes('urn:mfa:webauthn');
        const wantsMfa = wantsOtp || wantsWebAuthn;

        if (!wantsMfa) {
          return Check.NO_NEED_TO_PROMPT;
        }

        if (!session?.accountId) {
          return Check.NO_NEED_TO_PROMPT;
        }

        try {
          const userDoc = await userService.findByUsername(session.accountId);
          if (!userDoc?.mfa?.enabled || !userDoc.mfa.methods) {
            logger.info('MFA check failed: User MFA not enabled', {
              accountId: session.accountId,
              mfaEnabled: userDoc?.mfa?.enabled,
            });
            return Check.NO_NEED_TO_PROMPT;
          }

          const methods = userDoc.mfa.methods;
          const hasTotp = methods.totp?.enabled && methods.totp?.secret;
          const hasEmail = methods.email?.enabled;
          const hasWebAuthn =
            methods.webauthn?.enabled &&
            (methods.webauthn?.credentials?.length ?? 0) > 0;

          const hasRequestedOtpMethod = wantsOtp && (hasTotp || hasEmail);
          const hasRequestedWebAuthnMethod = wantsWebAuthn && hasWebAuthn;

          if (!hasRequestedOtpMethod && !hasRequestedWebAuthnMethod) {
            logger.info('MFA check failed: No matching MFA methods', {
              accountId: session.accountId,
              wantsOtp,
              wantsWebAuthn,
              hasTotp,
              hasEmail,
              hasWebAuthn,
            });
            return Check.NO_NEED_TO_PROMPT;
          }

          const amr = session.amr || [];
          const hasOtp = amr.includes('otp');
          const hasHwk = amr.includes('hwk'); // Hardware key for WebAuthn

          // If OTP requested and already satisfied
          if (wantsOtp && hasOtp && !wantsWebAuthn) {
            return Check.NO_NEED_TO_PROMPT;
          }

          if (wantsWebAuthn && hasHwk && !wantsOtp) {
            return Check.NO_NEED_TO_PROMPT;
          }

          // If both requested and both satisfied
          if (wantsOtp && wantsWebAuthn && hasOtp && hasHwk) {
            return Check.NO_NEED_TO_PROMPT;
          }

          // If either OTP or WebAuthn is satisfied when both are requested
          // (user can satisfy MFA with any available method)
          if (wantsOtp && wantsWebAuthn && (hasOtp || hasHwk)) {
            return Check.NO_NEED_TO_PROMPT;
          }

          logger.info('MFA policy check:', {
            acrValues,
            wantsOtp,
            wantsWebAuthn,
            hasTotp,
            hasEmail,
            hasWebAuthn,
            hasOtp,
            hasHwk,
            sessionAmr: amr,
            accountId: session.accountId,
            result: 'REQUEST_PROMPT',
          });

          // MFA needed
          return Check.REQUEST_PROMPT;
        } catch (error) {
          logger.error('Error checking user MFA status:', { error });
          return Check.NO_NEED_TO_PROMPT;
        }
      }
    )
  );

  // select_account should come before login and consent
  basePolicy.add(promptSelectAccount, 0); // Add at the beginning
  basePolicy.add(promptMfa, 1); // Add after select_account

  return {
    policy: basePolicy,

    /**
     * Generates the URL for the interaction endpoint
     */
    url(_ctx: KoaContextWithOIDC, interaction: OidcInteraction) {
      return `${config.oidc.path}/interaction/${interaction.uid}`;
    },
  };
}
