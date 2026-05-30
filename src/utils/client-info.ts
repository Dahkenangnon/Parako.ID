import { Request } from 'express';
import { UAParser } from 'ua-parser-js';
import crypto from 'node:crypto';
import { injectable, inject } from 'inversify';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IClientDeviceInfoManager } from '../di/interfaces/client-device-info-manager.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';

/**
 * Client device infos sent from client side.
 */
export type ClientDeviceInfos = {
  visitor_id: string;
  visitor_id_source?: 'fingerprintjs' | 'fallback';
  components?: Record<string, unknown>;
  user_agent?: string;
  platform?: string;
  language?: string;
  languages?: readonly string[];
  timezone?: string;
  screen?: {
    width: number;
    height: number;
    pixel_ratio: number;
  };
  hardware_concurrency?: number;
  memory?: number | null;
};

/**
 * Client details saved in database at each login success.
 */
export type ClientDetails = {
  username?: string;
  ip: string;
  user_agent: string;
  browser: { name?: string; version?: string };
  os: { name?: string; version?: string };
  device: { type?: string; vendor?: string; model?: string };
  language?: string;
  timezone_guess?: string;

  /**
   * Server-side generated fingerprint.
   */
  fingerprint: string; // Server-side generated

  /**
   * FingerprintJS visitorId is sent to the server at each login success.
   */
  fingerprint_js_id?: string; // From FingerprintJS
};

/**
 * Device match evaluation result with detailed analysis
 */
export type DeviceMatchResult = {
  /** True if this is a completely new device */
  is_new_device: boolean;
  /** True if this device requires 2FA verification */
  requires_2fa: boolean;
  /** True if this is a suspicious login attempt */
  is_suspicious: boolean;
  /** Confidence score (0-100) for the match */
  confidence_score: number;
  /** Detailed reason for the evaluation */
  reason: string;
  /** Matched device if found */
  matched_device?: ClientDetails;
  /** Risk level: 'low', 'medium', 'high', 'critical' */
  risk_level: 'low' | 'medium' | 'high' | 'critical';
};

/**
 * Configuration for device matching thresholds
 */
export type DeviceMatchConfig = {
  /** Minimum confidence score to consider a device as "known" */
  min_confidence_score: number;
  /** IP address similarity threshold (0-1) */
  ip_similarity_threshold: number;
  /** User agent similarity threshold (0-1) */
  user_agent_similarity_threshold: number;
  /** Browser/OS similarity threshold (0-1) */
  browser_os_similarity_threshold: number;
  /** Fingerprint similarity threshold (0-1) */
  fingerprint_similarity_threshold: number;
  /** Maximum time difference in hours for suspicious activity */
  max_time_difference_hours: number;
  /** Countries/regions considered suspicious */
  suspicious_regions: string[];
  /** Known VPN/Proxy IP ranges */
  vpn_proxy_ranges: string[];
};

const DEFAULT_CONFIG: DeviceMatchConfig = {
  min_confidence_score: 70,
  ip_similarity_threshold: 0.8,
  user_agent_similarity_threshold: 0.7,
  browser_os_similarity_threshold: 0.8,
  fingerprint_similarity_threshold: 0.9,
  max_time_difference_hours: 24,
  suspicious_regions: ['XX', 'YY'], // Add actual suspicious country codes
  vpn_proxy_ranges: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'], // Private IP ranges
};

@injectable()
export default class ClientDeviceInfoManager implements IClientDeviceInfoManager {
  constructor(
    @inject(TYPES.SessionManager) private sessionManager: ISessionManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ConfigManager) private configManager: IConfigManager
  ) {}
  /**
   * Extract device information from request body.
   * Looks for the _deviceInfo field in POST body.
   *
   * @param req - Express request object
   * @returns Parsed device information or null if not found/invalid
   */
  extractDeviceInfoFromRequest(req: Request): ClientDeviceInfos | null {
    const startTime = Date.now();

    try {
      // Guard: ensure session has a CSRF token (implies valid session)
      const csrfToken = this.sessionManager.get<string>(req, 'csrfToken');
      if (!csrfToken) {
        this.logger.debug(
          'No CSRF token found in session for device info extraction',
          {
            sessionId: req.session?.id,
            ip: req.ip,
          }
        );
        return null;
      }

      // Static field name — CSRF protection is handled by the _csrf token
      const deviceFieldName = '_deviceInfo';
      let deviceData = null;

      if (!req.body || typeof req.body !== 'object') {
        return null;
      }

      if (deviceFieldName in req.body) {
        deviceData = req.body[deviceFieldName];
      } else {
        return null;
      }

      if (!deviceData) {
        this.logger.debug('No device info field found in request body', {
          fieldName: deviceFieldName,
          sessionId: req.session?.id,
          ip: req.ip,
        });
        return null;
      }

      if (typeof deviceData !== 'string' || deviceData.length === 0) {
        this.logger.warn('Invalid device data format in request', {
          fieldName: deviceFieldName,
          dataType: typeof deviceData,
          dataLength: deviceData?.length || 0,
          sessionId: req.session?.id,
          ip: req.ip,
        });
        return null;
      }

      let parsedData: ClientDeviceInfos;
      let encodingUsed: 'json' | 'base64' = 'json';

      try {
        parsedData = JSON.parse(deviceData);
      } catch (jsonError) {
        try {
          const decodedData = Buffer.from(deviceData, 'base64').toString(
            'utf-8'
          );
          parsedData = JSON.parse(decodedData);
          encodingUsed = 'base64';
        } catch (base64Error) {
          this.logger.warn('Failed to parse device data from request', {
            fieldName: deviceFieldName,
            dataLength: deviceData.length,
            jsonError:
              jsonError instanceof Error ? jsonError.message : 'Unknown',
            base64Error:
              base64Error instanceof Error ? base64Error.message : 'Unknown',
            sessionId: req.session?.id,
            ip: req.ip,
          });
          return null;
        }
      }

      const validationResult = this.validateDeviceInfo(parsedData);
      if (!validationResult.isValid) {
        this.logger.warn('Invalid device info structure', {
          fieldName: deviceFieldName,
          validationErrors: validationResult.errors,
          sessionId: req.session?.id,
          ip: req.ip,
        });
        return null;
      }

      this.logger.debug('Device info extracted successfully', {
        visitorId: parsedData.visitor_id,
        visitorIdSource: parsedData.visitor_id_source,
        encoding: encodingUsed,
        dataSize: deviceData.length,
        sessionId: req.session?.id,
        ip: req.ip,
        duration: Date.now() - startTime,
      });

      return parsedData;
    } catch (error) {
      this.logger.error(
        'Unexpected error extracting device info from request',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          sessionId: req.session?.id,
          ip: req.ip,
          duration: Date.now() - startTime,
        }
      );
      return null;
    }
  }

  /**
   * Validate device information structure
   * @param deviceInfo - Device information to validate
   * @returns Validation result with errors if any
   */
  private validateDeviceInfo(deviceInfo: any): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!deviceInfo || typeof deviceInfo !== 'object') {
      errors.push('Device info must be an object');
      return { isValid: false, errors };
    }

    if (
      !deviceInfo.visitor_id ||
      typeof deviceInfo.visitor_id !== 'string' ||
      deviceInfo.visitor_id.trim().length === 0
    ) {
      errors.push('visitorId is required and must be a non-empty string');
    } else if (deviceInfo.visitor_id.length > 100) {
      errors.push('visitorId must be 100 characters or less');
    }

    if (deviceInfo.visitor_id_source !== undefined) {
      if (
        !['fingerprintjs', 'fallback'].includes(deviceInfo.visitor_id_source)
      ) {
        errors.push(
          'visitorIdSource must be either "fingerprintjs" or "fallback"'
        );
      }
    }

    if (
      deviceInfo.user_agent !== undefined &&
      typeof deviceInfo.user_agent !== 'string'
    ) {
      errors.push('userAgent must be a string if provided');
    } else if (deviceInfo.user_agent && deviceInfo.user_agent.length > 500) {
      errors.push('userAgent must be 500 characters or less');
    }

    if (
      deviceInfo.platform !== undefined &&
      typeof deviceInfo.platform !== 'string'
    ) {
      errors.push('platform must be a string if provided');
    } else if (deviceInfo.platform && deviceInfo.platform.length > 100) {
      errors.push('platform must be 100 characters or less');
    }

    if (
      deviceInfo.language !== undefined &&
      typeof deviceInfo.language !== 'string'
    ) {
      errors.push('language must be a string if provided');
    } else if (deviceInfo.language && deviceInfo.language.length > 10) {
      errors.push('language must be 10 characters or less');
    }

    if (
      deviceInfo.timezone !== undefined &&
      typeof deviceInfo.timezone !== 'string'
    ) {
      errors.push('timezone must be a string if provided');
    } else if (deviceInfo.timezone && deviceInfo.timezone.length > 50) {
      errors.push('timezone must be 50 characters or less');
    }

    if (deviceInfo.screen !== undefined) {
      if (!deviceInfo.screen || typeof deviceInfo.screen !== 'object') {
        errors.push('screen must be an object if provided');
      } else {
        const { width, height, pixel_ratio: pixelRatio } = deviceInfo.screen;
        if (
          width !== undefined &&
          (typeof width !== 'number' || width < 0 || width > 10000)
        ) {
          errors.push('screen.width must be a number between 0 and 10000');
        }
        if (
          height !== undefined &&
          (typeof height !== 'number' || height < 0 || height > 10000)
        ) {
          errors.push('screen.height must be a number between 0 and 10000');
        }
        if (
          pixelRatio !== undefined &&
          (typeof pixelRatio !== 'number' || pixelRatio < 0 || pixelRatio > 10)
        ) {
          errors.push('screen.pixel_ratio must be a number between 0 and 10');
        }
      }
    }

    if (
      deviceInfo.hardware_concurrency !== undefined &&
      (typeof deviceInfo.hardware_concurrency !== 'number' ||
        deviceInfo.hardware_concurrency < 0 ||
        deviceInfo.hardware_concurrency > 128)
    ) {
      errors.push('hardwareConcurrency must be a number between 0 and 128');
    }

    if (
      deviceInfo.memory !== undefined &&
      deviceInfo.memory !== null &&
      (typeof deviceInfo.memory !== 'number' ||
        deviceInfo.memory < 0 ||
        deviceInfo.memory > 1024)
    ) {
      errors.push('memory must be a number between 0 and 1024 or null');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Check if device information is available in the request
   * @param req - Express request object
   * @returns true if device info is available, false otherwise
   */
  hasDeviceInfoInRequest(req: Request): boolean {
    try {
      const csrfToken = this.sessionManager.get<string>(req, 'csrfToken');
      if (!csrfToken) {
        return false;
      }

      const deviceFieldName = '_deviceInfo';
      return !!(req.body && req.body[deviceFieldName]);
    } catch (error) {
      this.logger.debug('Error checking for device info in request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId: req.session?.id,
        ip: req.ip,
      });
      return false;
    }
  }

  /**
   * Get client information from request, automatically extracting device info
   * This is the recommended method to use in controllers
   *
   * @param req - Express request object
   * @returns Client details with device information
   */
  getClientInfoFromRequest(req: Request): ClientDetails {
    const startTime = Date.now();

    try {
      const deviceInfo = this.extractDeviceInfoFromRequest(req);

      // Fall back to empty device info if extraction fails
      const clientPayload = deviceInfo || { visitor_id: '' };

      const clientDetails = this.getClientInfo(req, clientPayload);

      this.logger.debug('Client info generated from request', {
        hasDeviceInfo: !!deviceInfo,
        visitorId: clientDetails.fingerprint_js_id,
        visitorIdSource: deviceInfo?.visitor_id_source,
        ip: clientDetails.ip,
        userAgent: clientDetails.user_agent,
        browser: clientDetails.browser.name,
        os: clientDetails.os.name,
        sessionId: req.session?.id,
        duration: Date.now() - startTime,
      });

      return clientDetails;
    } catch (error) {
      this.logger.error('Error generating client info from request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        sessionId: req.session?.id,
        ip: req.ip,
        duration: Date.now() - startTime,
      });

      return this.getClientInfo(req, { visitor_id: '' });
    }
  }

  /**
   * Get client information from request and client payload
   *
   * @param req - Express request object
   * @param clientPayload - Device information from client side
   * @returns Client details with server-side generated fingerprint
   */
  getClientInfo(
    req: Request,
    clientPayload: ClientDeviceInfos = {
      visitor_id: '',
    }
  ): ClientDetails {
    const startTime = Date.now();

    try {
      const ip = this.extractClientIP(req);

      const userAgent = req.headers['user-agent'] || 'Unknown';

      const language =
        req.headers['accept-language']?.split(',')[0]?.trim() || 'en';

      const parser = new UAParser(userAgent);
      const result = parser.getResult();

      const sanitizedPayload = this.sanitizeClientPayload(clientPayload);

      // Note: IP is intentionally excluded so the same device on different networks
      // produces the same fingerprint. IP is stored separately for security checks.
      const fingerprint = this.generateServerFingerprint({
        user_agent: userAgent,
        platform: sanitizedPayload.platform,
        timezone: sanitizedPayload.timezone,
        screen: sanitizedPayload.screen,
        hardware_concurrency: sanitizedPayload.hardware_concurrency,
        memory: sanitizedPayload.memory,
      });

      const clientDetails: ClientDetails = {
        ip,
        user_agent: userAgent,
        browser: {
          name: result.browser.name || undefined,
          version: result.browser.version || undefined,
        },
        os: {
          name: result.os.name || undefined,
          version: result.os.version || undefined,
        },
        device: {
          // Default to 'desktop' if device type cannot be determined
          type: result.device.type || 'desktop',
          vendor: result.device.vendor || undefined,
          model: result.device.model || undefined,
        },
        language,
        // Don't fallback to language for timezone - it's not reliable
        timezone_guess: sanitizedPayload.timezone || undefined,
        fingerprint,
        fingerprint_js_id: sanitizedPayload.visitor_id || undefined,
      };

      this.logger.debug('Client info generated', {
        ip: clientDetails.ip,
        userAgent: clientDetails.user_agent,
        browser: clientDetails.browser.name,
        os: clientDetails.os.name,
        device: clientDetails.device.type,
        language: clientDetails.language,
        fingerprint: `${clientDetails.fingerprint.substring(0, 8)}...`,
        fingerprintJsId: clientDetails.fingerprint_js_id,
        sessionId: req.session?.id,
        duration: Date.now() - startTime,
      });

      return clientDetails;
    } catch (error) {
      this.logger.error('Error generating client info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        sessionId: req.session?.id,
        ip: req.ip,
        duration: Date.now() - startTime,
      });

      return {
        ip: req.ip || 'unknown',
        user_agent: req.headers['user-agent'] || 'Unknown',
        browser: {},
        os: {},
        device: {},
        language: 'en',
        timezone_guess: 'UTC',
        fingerprint: crypto.createHash('sha256').update('error').digest('hex'),
        fingerprint_js_id: clientPayload.visitor_id || undefined,
      };
    }
  }

  /**
   * Extract client IP address with validation against trusted proxies
   * Only trusts X-Forwarded-For and X-Real-IP headers from configured trusted proxies
   * @param req - Express request object
   * @returns Client IP address
   */
  private extractClientIP(req: Request): string {
    const directIP = req.socket.remoteAddress || req.ip || 'unknown';

    // Get trusted proxy configuration
    const trustedProxies =
      this.configManager.getConfig().security?.protection?.trusted_proxies ||
      [];

    // Helper function to check if direct IP is from a trusted proxy
    const isFromTrustedProxy = (): boolean => {
      if (trustedProxies.length === 0) {
        // Trust the proxy setting from Express. After the schema migration
        // `trust proxy` is a hop count (integer ≥ 0) — any positive value
        // means we trust at least one proxy. We accept legacy boolean `true`
        // for backwards compatibility with older configurations that haven't
        // been migrated yet (see src/utils/settings.helper.ts).
        const trustProxy = req.app.get('trust proxy');
        if (trustProxy === true) return true;
        if (typeof trustProxy === 'number') return trustProxy > 0;
        return false;
      }

      for (const proxyRange of trustedProxies) {
        if (this.isIPInRange(directIP, proxyRange)) {
          return true;
        }
      }
      return false;
    };

    // Only trust forwarded headers if request is from a trusted proxy
    if (isFromTrustedProxy()) {
      const forwardedFor = req.headers['x-forwarded-for'];
      if (forwardedFor) {
        // X-Forwarded-For can contain multiple IPs, take the first one (original client)
        const firstIP = forwardedFor.toString().split(',')[0].trim();
        if (firstIP && firstIP !== 'unknown') {
          return firstIP;
        }
      }

      const realIP = req.headers['x-real-ip'];
      if (realIP && realIP !== 'unknown') {
        return realIP.toString().trim();
      }
    } else if (req.headers['x-forwarded-for'] || req.headers['x-real-ip']) {
      this.logger.warn('Ignoring forwarded IP headers from untrusted source', {
        directIP,
        forwardedFor: req.headers['x-forwarded-for'],
        realIP: req.headers['x-real-ip'],
        trustedProxiesConfigured: trustedProxies.length,
      });
    }

    // Fall back to direct connection IP
    return directIP;
  }

  /**
   * Check if an IP address is within a CIDR range or matches exactly
   * @param ip - IP address to check
   * @param range - CIDR range (e.g., '10.0.0.0/8') or single IP
   * @returns true if IP is in range
   */
  isIPInRange(ip: string, range: string): boolean {
    const normalizedIP = ip.replace(/^::ffff:/, '');

    // If range doesn't have CIDR notation, it's an exact match
    if (!range.includes('/')) {
      return normalizedIP === range;
    }

    const [rangeIP, prefixStr] = range.split('/');
    const prefix = parseInt(prefixStr, 10);

    const ipNum = this.ipToNumber(normalizedIP);
    const rangeNum = this.ipToNumber(rangeIP);

    if (ipNum === null || rangeNum === null) {
      // If conversion fails, fall back to string comparison
      return normalizedIP === rangeIP;
    }

    const mask = ~(0xffffffff >>> prefix);
    return (ipNum & mask) === (rangeNum & mask);
  }

  /**
   * Convert IPv4 address string to number
   * @param ip - IPv4 address string (e.g., '192.168.1.1')
   * @returns 32-bit number representation or null if invalid
   */
  private ipToNumber(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;

    let num = 0;
    for (const part of parts) {
      const octet = parseInt(part, 10);
      if (isNaN(octet) || octet < 0 || octet > 255) return null;
      num = (num << 8) | octet;
    }
    return num >>> 0; // Convert to unsigned 32-bit
  }

  /**
   * Sanitize and validate client payload data
   * @param payload - Raw client payload
   * @returns Sanitized client payload
   */
  private sanitizeClientPayload(payload: ClientDeviceInfos): ClientDeviceInfos {
    return {
      visitor_id: payload.visitor_id?.trim() || '',
      visitor_id_source: payload.visitor_id_source,
      user_agent: payload.user_agent?.trim(),
      platform: payload.platform?.trim(),
      language: payload.language?.trim(),
      languages: payload.languages,
      timezone: payload.timezone?.trim(),
      screen: payload.screen
        ? {
            width: Math.max(0, Math.min(10000, payload.screen.width || 0)),
            height: Math.max(0, Math.min(10000, payload.screen.height || 0)),
            pixel_ratio: Math.max(
              0,
              Math.min(10, payload.screen.pixel_ratio || 1)
            ),
          }
        : undefined,
      hardware_concurrency: payload.hardware_concurrency
        ? Math.max(0, Math.min(128, payload.hardware_concurrency))
        : undefined,
      memory: payload.memory
        ? Math.max(0, Math.min(1024, payload.memory))
        : null,
      components: payload.components,
    };
  }

  /**
   * Generate server-side fingerprint using device-specific data only.
   *
   * Note: IP address is intentionally excluded from the fingerprint so that
   * the same device produces the same fingerprint regardless of network.
   * IP-based security checks should be performed separately.
   *
   * @param data - Device-specific data to include in fingerprint
   * @returns SHA-256 hash fingerprint
   */
  private generateServerFingerprint(data: {
    user_agent: string;
    platform?: string;
    timezone?: string;
    screen?: { width: number; height: number; pixel_ratio: number };
    hardware_concurrency?: number;
    memory?: number | null;
  }): string {
    const fingerprintData = [
      data.user_agent,
      data.platform || '',
      data.timezone || '',
      data.screen?.width || 0,
      data.screen?.height || 0,
      data.screen?.pixel_ratio || 1,
      data.hardware_concurrency || 0,
      data.memory || 0,
    ].join('|');

    return crypto.createHash('sha256').update(fingerprintData).digest('hex');
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   */
  calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const matrix: number[][] = [];
    const len1 = str1.length;
    const len2 = str2.length;

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    return maxLength === 0 ? 1 : (maxLength - distance) / maxLength;
  }

  /**
   * Calculate IP address similarity
   */
  calculateIPSimilarity(ip1: string, ip2: string): number {
    if (!ip1 || !ip2) return 0;
    if (ip1 === ip2) return 1;

    const parts1 = ip1.split('.');
    const parts2 = ip2.split('.');

    if (parts1.length !== 4 || parts2.length !== 4) return 0;

    let matchingOctets = 0;
    for (let i = 0; i < 4; i++) {
      if (parts1[i] === parts2[i]) {
        matchingOctets++;
      }
    }

    return matchingOctets / 4;
  }

  /**
   * Check if IP is in suspicious ranges
   */
  isSuspiciousIP(ip: string, config: DeviceMatchConfig): boolean {
    for (const range of config.vpn_proxy_ranges) {
      if (this.isIPInRange(ip, range)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Calculate browser and OS similarity
   */
  calculateBrowserOSSimilarity(
    device1: ClientDetails,
    device2: ClientDetails
  ): number {
    let score = 0;
    let totalChecks = 0;

    if (device1.browser.name && device2.browser.name) {
      score += this.calculateStringSimilarity(
        device1.browser.name,
        device2.browser.name
      );
      totalChecks++;
    }

    // OS similarity
    if (device1.os.name && device2.os.name) {
      score += this.calculateStringSimilarity(device1.os.name, device2.os.name);
      totalChecks++;
    }

    if (device1.device.type && device2.device.type) {
      score += this.calculateStringSimilarity(
        device1.device.type,
        device2.device.type
      );
      totalChecks++;
    }

    return totalChecks > 0 ? score / totalChecks : 0;
  }

  /**
   * Calculate overall device similarity score
   */
  calculateDeviceSimilarity(
    newDevice: ClientDetails,
    oldDevice: ClientDetails,
    _config: DeviceMatchConfig
  ): number {
    let totalScore = 0;
    let totalWeight = 0;

    // Fingerprint similarity (highest weight)
    if (newDevice.fingerprint && oldDevice.fingerprint) {
      const fingerprintSimilarity =
        newDevice.fingerprint === oldDevice.fingerprint ? 1 : 0;
      totalScore += fingerprintSimilarity * 0.4;
      totalWeight += 0.4;
    }

    // FingerprintJS ID similarity
    if (newDevice.fingerprint_js_id && oldDevice.fingerprint_js_id) {
      const fingerprintJsSimilarity =
        newDevice.fingerprint_js_id === oldDevice.fingerprint_js_id ? 1 : 0;
      totalScore += fingerprintJsSimilarity * 0.3;
      totalWeight += 0.3;
    }

    // IP similarity
    const ipSimilarity = this.calculateIPSimilarity(newDevice.ip, oldDevice.ip);
    totalScore += ipSimilarity * 0.15;
    totalWeight += 0.15;

    const userAgentSimilarity = this.calculateStringSimilarity(
      newDevice.user_agent,
      oldDevice.user_agent
    );
    totalScore += userAgentSimilarity * 0.1;
    totalWeight += 0.1;

    // Browser/OS similarity
    const browserOSSimilarity = this.calculateBrowserOSSimilarity(
      newDevice,
      oldDevice
    );
    totalScore += browserOSSimilarity * 0.05;
    totalWeight += 0.05;

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Determine risk level based on device-level factors.
   *
   * Note: Additional risk factors (IP reputation, VPN detection, impossible travel,
   * high-risk regions) are handled separately in the login handler via
   * GeolocationService and IPReputationService.
   *
   * This method focuses on device-specific risk signals:
   * - Suspicious IP patterns (private ranges, known bad ranges)
   * - First-time login (no device history)
   * - Timezone changes (potential location change indicator)
   * - Rapid device switching (many unique devices)
   */
  determineRiskLevel(
    newDevice: ClientDetails,
    oldDevices: ClientDetails[],
    _config: DeviceMatchConfig
  ): 'low' | 'medium' | 'high' | 'critical' {
    let riskScore = 0;

    if (this.isSuspiciousIP(newDevice.ip, _config)) {
      riskScore += 30;
    }

    // First login - no device history
    if (oldDevices.length === 0) {
      riskScore += 20;
    }

    if (newDevice.timezone_guess && oldDevices.length > 0) {
      const recentTimezones = new Set(
        oldDevices
          .slice(0, 5)
          .map(d => d.timezone_guess)
          .filter(Boolean)
      );
      if (
        recentTimezones.size > 0 &&
        !recentTimezones.has(newDevice.timezone_guess)
      ) {
        // Timezone changed from all recent devices - potential location change
        riskScore += 15;
      }
    }

    if (oldDevices.length >= 5) {
      const uniqueFingerprints = new Set(
        oldDevices.slice(0, 10).map(d => d.fingerprint)
      );
      if (uniqueFingerprints.size >= 8) {
        // Many different devices in recent history - unusual pattern
        riskScore += 20;
      }
    }

    const knownFingerprints = new Set(oldDevices.map(d => d.fingerprint));
    if (!knownFingerprints.has(newDevice.fingerprint)) {
      riskScore += 10;
    }

    if (riskScore >= 60) {
      return 'critical';
    } else if (riskScore >= 40) {
      return 'high';
    } else if (riskScore >= 20) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Evaluate device match directly from request
   * Convenience method that extracts device info and evaluates against old devices
   * @param req - Express request object
   * @param oldDevices - The old device details history from db
   * @param config - Optional configuration for matching thresholds
   * @returns Detailed evaluation result with security recommendations
   */
  evaluateDeviceMatchFromRequest(
    req: Request,
    oldDevices: ClientDetails[],
    config: DeviceMatchConfig = DEFAULT_CONFIG
  ): DeviceMatchResult {
    const startTime = Date.now();

    try {
      const newDevice = this.getClientInfoFromRequest(req);
      const result = this.evaluateDeviceMatch(newDevice, oldDevices, config);

      this.logger.debug('Device match evaluation completed', {
        is_new_device: result.is_new_device,
        requires_2fa: result.requires_2fa,
        is_suspicious: result.is_suspicious,
        confidence_score: result.confidence_score,
        risk_level: result.risk_level,
        reason: result.reason,
        has_matched_device: !!result.matched_device,
        old_devices_count: oldDevices.length,
        session_id: req.session?.id,
        ip: req.ip,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.logger.error('Error evaluating device match from request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        sessionId: req.session?.id,
        ip: req.ip,
        duration: Date.now() - startTime,
      });

      return {
        is_new_device: true,
        requires_2fa: true,
        is_suspicious: false,
        confidence_score: 0,
        reason:
          'Error occurred during device evaluation - defaulting to new device',
        risk_level: 'medium',
      };
    }
  }

  /**
   * Evaluate if the new device is a new device or an existing one.
   * @param newDevice - The new device details.
   * @param oldDevices - The old device details history from db. NB: It can be empty array at first login.
   * @param config - Optional configuration for matching thresholds
   * @returns Detailed evaluation result with security recommendations
   */
  evaluateDeviceMatch(
    newDevice: ClientDetails,
    oldDevices: ClientDetails[],
    config: DeviceMatchConfig = DEFAULT_CONFIG
  ): DeviceMatchResult {
    if (oldDevices.length === 0) {
      return {
        is_new_device: true,
        requires_2fa: true,
        is_suspicious: false,
        confidence_score: 0,
        reason: 'First login - no previous devices found',
        risk_level: 'medium',
      };
    }

    let bestMatch: ClientDetails | undefined;
    let bestScore = 0;

    for (const oldDevice of oldDevices) {
      const similarityScore = this.calculateDeviceSimilarity(
        newDevice,
        oldDevice,
        config
      );
      if (similarityScore > bestScore) {
        bestScore = similarityScore;
        bestMatch = oldDevice;
      }
    }

    const riskLevel = this.determineRiskLevel(newDevice, oldDevices, config);
    const isNewDevice = bestScore < config.min_confidence_score / 100;
    const requires2FA =
      isNewDevice || riskLevel === 'high' || riskLevel === 'critical';
    const isSuspicious = riskLevel === 'high' || riskLevel === 'critical';

    let reason = '';
    if (isNewDevice) {
      reason = `New device detected (confidence: ${Math.round(bestScore * 100)}%)`;
    } else if (isSuspicious) {
      reason = `Suspicious activity detected (${riskLevel} risk level)`;
    } else {
      reason = `Known device matched (confidence: ${Math.round(bestScore * 100)}%)`;
    }

    return {
      is_new_device: isNewDevice,
      requires_2fa: requires2FA,
      is_suspicious: isSuspicious,
      confidence_score: Math.round(bestScore * 100),
      reason,
      matched_device: bestMatch,
      risk_level: riskLevel,
    };
  }
}
