import crypto from 'crypto';
import type { IConfigManager } from '../../../di/interfaces/config-manager.interface.js';
import type { IViewResolver } from '../../../di/interfaces/view-resolver.interface.js';
import type { Client, KoaContextWithOIDC } from 'oidc-provider';
import { UAParser } from 'ua-parser-js';
import * as cheerio from 'cheerio';
import type { IOIDCUtils } from '../../../di/interfaces/oidc-utils.interface.js';

/**
 * Device Authorization Flow Configuration
 *
 * This module configures the OIDC device authorization flow with the following configurable options:
 *
 * - enabled: Enable/disable the device flow feature
 * - charset: Character set for device codes ('digits' for numeric, 'base-20' for alphanumeric)
 * - mask: Display mask for device codes (e.g., "***-*-***" for "123-4-567" format)
 *
 * Configuration is managed through the Parako.ID configuration system:
 * - features.oidc.device_flow.enabled
 * - features.oidc.device_flow.charset
 * - features.oidc.device_flow.mask
 */

/**
 * Factory function to create device flow configuration
 * @param configManager - Configuration manager instance
 * @param viewResolver - View resolver instance
 * @returns Device flow configuration object
 */
export default function DeviceFlow(
  configManager: IConfigManager,
  viewResolver: IViewResolver,
  oidcUtils: IOIDCUtils
) {
  const config = configManager.getConfig();

  // See https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#featuresdeviceflow
  return {
    // Configurable: Character set for device codes
    // - 'digits': Numeric codes only (0-9)
    // - 'base-20': Alphanumeric codes (0-9, A-J)
    charset: config.features.oidc.device_flow.charset,

    /**
     * Specifies a helper function that shall be invoked to extract device-specific information from device authorization endpoint requests. The extracted information becomes available during the end-user confirmation screen to assist users in verifying that the authorization request originated from a device in their possession.
     *  This enhances security by enabling users to confirm device identity before granting authorization.
     */
    deviceInfo: function deviceInfo(ctx: KoaContextWithOIDC) {
      const rawUA = ctx.get('user-agent') || '';
      const ip =
        ctx.ip ||
        ctx.get('x-forwarded-for') ||
        ctx.get('x-real-ip') ||
        'Unknown';
      const timestamp = new Date().toISOString();

      // Empty or very short UA → programmatic client (CLI, IoT, SDK)
      if (!rawUA || rawUA.length < 10) {
        return {
          ip,
          ua: rawUA || 'None',
          deviceType: 'CLI / Script',
          browser: 'None (programmatic)',
          browserVersion: '',
          os: 'Unknown',
          osVersion: '',
          timestamp,
          requestId: crypto.randomUUID(),
          location: 'Unknown Location',
          sessionId: ctx.session?.id || 'Unknown',
        };
      }

      // Use ua-parser-js for browser-based device detection
      const parser = new UAParser(rawUA);
      const result = parser.getResult();

      let deviceType: string;
      if (result.device.type) {
        deviceType = `${result.device.type.charAt(0).toUpperCase() + result.device.type.slice(1)}`;
      } else if (rawUA.includes('Smart TV') || rawUA.includes('TV')) {
        deviceType = 'Smart TV';
      } else if (/Printer|HP|Canon|Epson/i.test(rawUA)) {
        deviceType = 'Printer';
      } else if (/IoT|ESP|Arduino/i.test(rawUA)) {
        deviceType = 'IoT Device';
      } else if (result.os.name) {
        // Has an OS but no device type → desktop
        deviceType = 'Desktop';
      } else {
        deviceType = 'Unknown Device';
      }

      const browser = result.browser.name || 'Unknown Browser';
      const os = result.os.name || 'Unknown OS';
      const osVersion = result.os.version || '';

      return {
        ip,
        ua: rawUA,
        deviceType,
        browser,
        browserVersion: result.browser.version || '',
        os,
        osVersion,
        timestamp,
        requestId: crypto.randomUUID(),
        location: 'Unknown Location',
        sessionId: ctx.session?.id || 'Unknown',
      };
    },
    // Configurable: Enable/disable device flow feature
    enabled: config.features.oidc.device_flow.enabled,

    // Configurable: Display mask for device codes
    // Examples: "***-*-***" for "123-4-567", "****-****" for "1234-5678"
    mask: config.features.oidc.device_flow.mask,
    userCodeInputSource,
    userCodeConfirmSource,
    successSource,
  };

  /**
   * Helper function to format timestamp
   */
  function formatTime(timestamp: string): string {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Extract form elements from OIDC provider form string using cheerio (primary method)
   */
  function extractFormElements(form: string): {
    formId: string;
    formAction: string;
    xsrfToken: string;
    method: string;
  } {
    try {
      const $ = cheerio.load(form);

      const formElement = $('form').first();
      const formId = formElement.attr('id') || 'op.deviceInputForm';
      const formAction = formElement.attr('action') || '';
      const method = formElement.attr('method') || 'post';

      const xsrfToken = $('input[name="xsrf"]').attr('value') || '';

      return {
        formId,
        formAction,
        xsrfToken,
        method,
      };
    } catch (error) {
      console.error(
        'Error parsing form with cheerio, falling back to regex:',
        error
      );

      // Fallback to regex implementation if cheerio fails
      return extractFormElementsRegex(form);
    }
  }

  /**
   * Extract form elements from the OIDC provider's form HTML using regexes.
   *
   * Intentionally retained as the cheerio fallback path — see the catch
   * block above. Cheerio is the primary parser, but if it ever throws on
   * malformed HTML we fall through to this regex implementation so the
   * device flow keeps working instead of surfacing a 500.
   */
  function extractFormElementsRegex(form: string): {
    formId: string;
    formAction: string;
    xsrfToken: string;
    method: string;
  } {
    let formId = 'op.deviceInputForm'; // fallback
    const idMatch = form.match(/id="([^"]+)"/);
    if (idMatch) {
      formId = idMatch[1];
    }

    let formAction = '';
    const actionMatch = form.match(/action="([^"]+)"/);
    if (actionMatch) {
      formAction = actionMatch[1];
    }

    let xsrfToken = '';
    const xsrfMatch = form.match(/name="xsrf"\s+value="([^"]+)"/);
    if (xsrfMatch) {
      xsrfToken = xsrfMatch[1];
    }

    let method = 'post'; // fallback
    const methodMatch = form.match(/method="([^"]+)"/);
    if (methodMatch) {
      method = methodMatch[1];
    }

    return {
      formId,
      formAction,
      xsrfToken,
      method,
    };
  }

  async function successSource(ctx: KoaContextWithOIDC) {
    const clientName =
      ctx.oidc?.client?.clientName ||
      ctx.oidc?.client?.clientId ||
      'Application';
    const locale = oidcUtils.getLocale(ctx);

    await ctx.render(viewResolver.views.auth.oidc.device_flow_success, {
      clientName,
      locale,
      title: 'Authorization Successful',
    });
  }

  async function userCodeConfirmSource(
    ctx: KoaContextWithOIDC,
    form: string,
    client: Client,
    deviceInfo: any,
    userCode: string
  ) {
    const clientName = client.clientName || client.clientId || 'Application';
    const locale = oidcUtils.getLocale(ctx);

    await ctx.render(viewResolver.views.auth.oidc.device_flow_confirm_code, {
      form,
      clientName,
      deviceInfo,
      userCode,
      locale,
      title: 'Confirm Device',
      formatTime,
    });
  }

  async function userCodeInputSource(
    ctx: KoaContextWithOIDC,
    form: string,
    out: any,
    err: any
  ) {
    const locale = oidcUtils.getLocale(ctx);
    const mask = config.features.oidc.device_flow.mask;
    const charset = config.features.oidc.device_flow.charset;

    let error = null;
    let warning = null;
    let userCode = '';

    if (err && (err.userCode || err.name === 'NoCodeError')) {
      error = 'The code you entered is incorrect. Please try again.';
      userCode = err.userCode || '';
    } else if (err && err.name === 'AbortedError') {
      warning = 'The sign-in request was interrupted.';
    } else if (err) {
      error = 'There was an error processing your request. Please try again.';
    }

    const formElements = extractFormElements(form);

    await ctx.render(viewResolver.views.auth.oidc.device_flow_code_input, {
      form,
      error,
      warning,
      userCode,
      locale,
      title: 'Device Verification',
      formId: formElements.formId,
      formAction: formElements.formAction,
      formMethod: formElements.method,
      xsrfToken: formElements.xsrfToken,
      deviceCodeMask: mask,
      deviceCodeCharset: charset,
    });
  }
}
