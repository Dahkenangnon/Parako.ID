import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type {
  IIPReputationService,
  IPReputationResult,
} from '../di/interfaces/ip-reputation-service.interface.js';

/**
 * IPReputationService
 *
 * Provides IP reputation checking for VPN/proxy detection and fraud scoring
 * using IPQualityScore API with caching
 */
@injectable()
export class IPReputationService implements IIPReputationService {
  /** In-memory cache for reputation results */
  private cache = new Map<
    string,
    { data: IPReputationResult; expiresAt: number }
  >();

  /** API request timeout in milliseconds */
  private readonly API_TIMEOUT = 5000;

  constructor(
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.Logger) private logger: ILogger
  ) {}

  /**
   * Get API key from environment variable or config
   * Environment variable takes precedence over database config
   */
  private getApiKey(): string | undefined {
    const envKey = process.env.IPQUALITYSCORE_API_KEY;
    if (envKey && envKey.trim()) {
      return envKey.trim();
    }
    // Fall back to database config
    const config = this.configManager.getConfig();
    return config.integrations?.ipqualityscore?.api_key;
  }

  /**
   * Check if IP reputation service is enabled
   */
  public isEnabled(): boolean {
    const config = this.configManager.getConfig();
    const apiKey = this.getApiKey();
    // Service is enabled if either:
    // 1. Explicitly enabled in config with API key
    // 2. API key is set via environment variable (implicit enable)
    const configEnabled = config.integrations?.ipqualityscore?.enabled === true;
    const hasEnvKey = !!process.env.IPQUALITYSCORE_API_KEY?.trim();
    return (configEnabled || hasEnvKey) && !!apiKey;
  }

  /**
   * Check the reputation of an IP address
   */
  public async checkIPReputation(ip: string): Promise<IPReputationResult> {
    const normalizedIP = ip.replace(/^::ffff:/, '');

    if (!this.isEnabled()) {
      return this.createDisabledResult(normalizedIP);
    }

    const cached = this.cache.get(normalizedIP);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug('IP reputation cache hit', { ip: normalizedIP });
      return cached.data;
    }

    try {
      const config = this.configManager.getConfig();
      const apiKey = this.getApiKey();
      const cacheTtlHours =
        config.integrations?.ipqualityscore?.cache_ttl_hours ?? 6;

      if (!apiKey) {
        return this.createErrorResult(normalizedIP, 'API key not configured');
      }

      // IPQualityScore API URL
      const url = `https://www.ipqualityscore.com/api/json/ip/${apiKey}/${normalizedIP}?strictness=1&allow_public_access_points=true&lighter_penalties=true`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.API_TIMEOUT);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`IPQualityScore API returned ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'IPQualityScore API request failed');
      }

      const fraudScore = data.fraud_score ?? 0;
      const result: IPReputationResult = {
        ip: normalizedIP,
        success: true,
        fraudScore,
        isVPN: data.vpn === true,
        isProxy: data.proxy === true,
        isTor: data.tor === true,
        isCrawler: data.is_crawler === true,
        isBlocklisted: data.recent_abuse === true || fraudScore >= 90,
        isDatacenter: data.host !== undefined && data.host !== '',
        isMobile: data.mobile === true,
        isp: data.ISP,
        asn: data.ASN,
        organization: data.organization,
        countryCode: data.country_code,
        recentAbuse: data.recent_abuse === true,
        timestamp: Date.now(),
        riskLevel: this.calculateRiskLevel(fraudScore, data),
      };

      this.cache.set(normalizedIP, {
        data: result,
        expiresAt: Date.now() + cacheTtlHours * 60 * 60 * 1000,
      });

      this.logger.debug('IP reputation lookup successful', {
        ip: normalizedIP,
        fraudScore,
        isVPN: result.isVPN,
        isProxy: result.isProxy,
        riskLevel: result.riskLevel,
      });

      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.warn('IP reputation lookup failed', {
        ip: normalizedIP,
        error: err.message,
      });
      return this.createErrorResult(normalizedIP, err.message);
    }
  }

  /**
   * Quick check if an IP is likely a VPN, proxy, or Tor
   */
  public async isLikelyVPN(ip: string): Promise<boolean> {
    const result = await this.checkIPReputation(ip);
    return result.isVPN || result.isProxy || result.isTor;
  }

  /**
   * Get the fraud score for an IP address
   */
  public async getFraudScore(ip: string): Promise<number> {
    const result = await this.checkIPReputation(ip);
    return result.fraudScore;
  }

  /**
   * Check if an IP should be blocked based on configured threshold
   */
  public async shouldBlock(ip: string): Promise<boolean> {
    const config = this.configManager.getConfig();
    const threshold =
      config.integrations?.ipqualityscore?.fraud_score_threshold ?? 75;

    const result = await this.checkIPReputation(ip);
    return result.fraudScore >= threshold || result.isBlocklisted;
  }

  /**
   * Calculate risk level based on fraud score and other factors
   */
  private calculateRiskLevel(
    fraudScore: number,
    data: Record<string, unknown>
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: Very high fraud score or known bad actors
    if (fraudScore >= 90 || data.recent_abuse === true) {
      return 'critical';
    }

    // High: High fraud score or confirmed VPN/Tor
    if (fraudScore >= 75 || data.tor === true) {
      return 'high';
    }

    // Medium: Moderate fraud score or VPN/proxy
    if (fraudScore >= 50 || data.vpn === true || data.proxy === true) {
      return 'medium';
    }

    // Low: Clean or low fraud score
    return 'low';
  }

  /**
   * Create a result for when service is disabled
   */
  private createDisabledResult(ip: string): IPReputationResult {
    return {
      ip,
      success: false,
      fraudScore: 0,
      isVPN: false,
      isProxy: false,
      isTor: false,
      isCrawler: false,
      isBlocklisted: false,
      isDatacenter: false,
      isMobile: false,
      error: 'IP reputation service is disabled',
      timestamp: Date.now(),
      riskLevel: 'low',
    };
  }

  /**
   * Create an error result for failed lookups
   */
  private createErrorResult(
    ip: string,
    errorMessage: string
  ): IPReputationResult {
    return {
      ip,
      success: false,
      fraudScore: 0,
      isVPN: false,
      isProxy: false,
      isTor: false,
      isCrawler: false,
      isBlocklisted: false,
      isDatacenter: false,
      isMobile: false,
      error: errorMessage,
      timestamp: Date.now(),
      riskLevel: 'low',
    };
  }
}
