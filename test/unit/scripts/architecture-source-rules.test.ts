import { describe, expect, it } from 'vitest';

import { evaluateSourceModuleRules } from '../../../scripts/testing/check-architecture.js';

describe('architecture source rules', () => {
  it('rejects hidden Service construction and the legacy false CRUD Module', () => {
    const violations = evaluateSourceModuleRules([
      {
        path: 'src/controllers/example.controller.ts',
        source:
          'const operation = new HiddenService(); const date = new Date();',
      },
      {
        path: 'src/di/interfaces/base-service.interface.ts',
        source: 'export interface BaseService {}',
      },
    ]);

    expect(violations).toEqual([
      'Controller constructs Service Implementation directly: src/controllers/example.controller.ts -> HiddenService',
      'Legacy false CRUD Module is forbidden: src/di/interfaces/base-service.interface.ts',
    ]);
  });

  it('rejects nominal provider-specific social-login contracts', () => {
    expect(
      evaluateSourceModuleRules([
        {
          path: 'src/di/interfaces/google-social-login.interface.ts',
          source: 'export interface IGoogleSocialLogin {}',
        },
      ])
    ).toEqual([
      'Nominal provider-specific social-login Interface is forbidden: src/di/interfaces/google-social-login.interface.ts',
    ]);
  });

  it('requires shared taxonomy and browser behavior imports', () => {
    const violations = evaluateSourceModuleRules([
      {
        path: 'src/validators/auth/social.ts',
        source: 'export const providers = ["google"];',
      },
      {
        path: 'src/assets/js/admin/settings/branding.ts',
        source: 'class Branding { uploadIconFile() {} }',
      },
    ]);

    expect(violations).toHaveLength(3);
    expect(violations).toContain(
      'Duplicate browser Implementation is forbidden: src/assets/js/admin/settings/branding.ts -> uploadIconFile'
    );
    expect(violations).toContain(
      'Required shared import missing: src/validators/auth/social.ts -> CONFIGURABLE_SOCIAL_PROVIDER_IDS from ../../config/social-providers.js'
    );
    expect(violations).toContain(
      'Required shared import missing: src/assets/js/admin/settings/branding.ts -> requestConfirmation from ../../utils/confirmed-action.js'
    );
  });

  it('rejects locally redeclared external browser contracts', () => {
    expect(
      evaluateSourceModuleRules([
        {
          path: 'src/assets/js/page.ts',
          source:
            'interface LucideApi {} interface WindowWithLucide { lucide?: LucideApi }',
        },
      ])
    ).toEqual([
      'Browser external-global Interface must be declared centrally: src/assets/js/page.ts -> LucideApi',
      'Browser external-global Interface must be declared centrally: src/assets/js/page.ts -> WindowWithLucide',
    ]);
  });

  it('rejects legacy IIFEs in module-scoped authentication roots', () => {
    expect(
      evaluateSourceModuleRules([
        {
          path: 'src/assets/js/auth/login.ts',
          source: '(function () { class LoginManager {} })();',
        },
        {
          path: 'src/assets/js/auth/register.ts',
          source: 'export class RegisterManager {}',
        },
      ])
    ).toEqual([
      'Browser entry must use module scope instead of an IIFE: src/assets/js/auth/login.ts',
    ]);
  });

  it('requires module scope and the shared OTP controller in migrated roots', () => {
    expect(
      evaluateSourceModuleRules([
        {
          path: 'src/assets/js/auth/mfa-verify.ts',
          source: '(function () { class MfaManager {} })();',
        },
      ])
    ).toEqual([
      'Browser entry must use module scope instead of an IIFE: src/assets/js/auth/mfa-verify.ts',
      'Required shared import missing: src/assets/js/auth/mfa-verify.ts -> OtpInputController from ../utils/otp-input-controller.js',
    ]);
  });

  it('requires module scope and shared WebAuthn browser invariants in migrated roots', () => {
    const violations = evaluateSourceModuleRules([
      {
        path: 'src/assets/js/webauthn/authenticate.ts',
        source: '(function () { class WebAuthnAuthenticateManager {} })();',
      },
      {
        path: 'src/assets/js/webauthn/register.ts',
        source: 'export class WebAuthnRegisterManager {}',
      },
    ]);

    expect(violations).toHaveLength(9);
    expect(violations).toContain(
      'Browser entry must use module scope instead of an IIFE: src/assets/js/webauthn/authenticate.ts'
    );
    for (const modulePath of [
      'src/assets/js/webauthn/authenticate.ts',
      'src/assets/js/webauthn/register.ts',
    ]) {
      for (const name of [
        'decodeBase64Url',
        'encodeBase64Url',
        'isSafeSameOriginRedirect',
        'isWebAuthnSupported',
      ]) {
        expect(violations).toContain(
          `Required shared import missing: ${modulePath} -> ${name} from ../utils/webauthn-browser.js`
        );
      }
    }
  });

  it('rejects any assertions in DI composition roots', () => {
    expect(
      evaluateSourceModuleRules([
        {
          path: 'src/di/modules/example.module.ts',
          source: 'const service = dependency as any;',
        },
        {
          path: 'src/di/factories/example.factory.ts',
          source: 'const service = <any>dependency;',
        },
      ])
    ).toEqual([
      'DI composition root uses an any assertion: src/di/factories/example.factory.ts',
      'DI composition root uses an any assertion: src/di/modules/example.module.ts',
    ]);
  });

  it('accepts injected controller operations and shared behavior Modules', () => {
    const panelImports = `
      import {
        applyPanelTheme,
        setDropdownOpen,
        setMobileSidebarOpen,
        setSidebarExpanded,
        toggleDropdown as togglePanelDropdown
      } from '../utils/panel-layout.js';
    `;
    const confirmationImport =
      'import { requestConfirmation } from "../../utils/confirmed-action.js";';

    expect(
      evaluateSourceModuleRules([
        {
          path: 'src/controllers/example.controller.ts',
          source:
            'export class Controller { constructor(readonly operation: EmailVerificationService) {} }',
        },
        {
          path: 'src/validators/auth/social.ts',
          source:
            'import { CONFIGURABLE_SOCIAL_PROVIDER_IDS } from "../../config/social-providers.js";',
        },
        {
          path: 'src/assets/js/admin/layout.ts',
          source: panelImports,
        },
        {
          path: 'src/assets/js/account/layout.ts',
          source: panelImports,
        },
        {
          path: 'src/assets/js/admin/settings/branding.ts',
          source: confirmationImport,
        },
        {
          path: 'src/assets/js/admin/settings/common.ts',
          source: confirmationImport,
        },
      ])
    ).toEqual([]);
  });
  it('rejects DI contracts that import utility implementations', () => {
    expect(
      evaluateSourceModuleRules([
        {
          path: 'src/di/interfaces/example.interface.ts',
          source: "import type { HiddenType } from '../../utils/hidden.js';",
        },
      ])
    ).toEqual([
      'DI contract imports a utility Implementation: src/di/interfaces/example.interface.ts -> ../../utils/hidden.js',
    ]);
  });
});
