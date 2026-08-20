import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IBootstrapEnvironment } from '../di/interfaces/bootstrap-environment.interface.js';
import type {
  IIPReputationService,
  IPReputationResult,
} from '../di/interfaces/ip-reputation-service.interface.js';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * IPReputationService
 *
 * Provides IP reputation checking for VPN/proxy detection and fraud scoring
 * using IPQualityScore API with caching
 */
@injectable()
export class IPReputationService implements IIPReputationService {
  private cache = new Map<
    string,
    { data: IPReputationResult; expiresAt: number }
  >();

  private readonly API_TIMEOUT_MS = 5000;

  constructor(
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.BootstrapEnvironment)
    private readonly bootstrapEnvironment: IBootstrapEnvironment
  ) {}

  /**
   * Get API key from environment variable or config
   * Environment variable takes precedence over database config
   */
  private getEnvironmentApiKey(): string | undefined {
    return this.bootstrapEnvironment.ipQualityScoreApiKey;
  }

  private getApiKey(
    config: ReturnType<IConfigManager['getConfig']>
  ): string | undefined {
    return (
      this.getEnvironmentApiKey() ||
      config.integrations?.ipqualityscore?.api_key?.trim() ||
      undefined
    );
  }

  public isEnabled(): boolean {
    // An environment key implicitly enables the integration and must remain
    // usable even while the persisted configuration provider is unavailable.
    if (this.getEnvironmentApiKey()) {
      return true;
    }

    try {
      const config = this.configManager.getConfig();
      const apiKey = this.getApiKey(config);
      return config.integrations?.ipqualityscore?.enabled === true && !!apiKey;
    } catch (error) {
      this.logger.warn('IP reputation configuration unavailable', {
        error: errorMessage(error),
      });
      return false;
    }
  }

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
      const apiKey = this.getApiKey(config);
      const cacheTtlHours =
        config.integrations?.ipqualityscore?.cache_ttl_hours ?? 6;

      if (!apiKey) {
        return this.createErrorResult(normalizedIP, 'API key not configured');
      }

      // IPQualityScore API URL
      const url = `https://www.ipqualityscore.com/api/json/ip/${encodeURIComponent(apiKey)}/${encodeURIComponent(normalizedIP)}?strictness=1&allow_public_access_points=true&lighter_penalties=true`;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.API_TIMEOUT_MS
      );

      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
          },
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`IPQualityScore API returned ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'IPQualityScore API request failed');
      }

      const fraudScore = this.normalizeFraudScore(data.fraud_score);
      const result: IPReputationResult = {
        ip: normalizedIP,
        success: true,
        fraudScore,
        isVPN: data.vpn === true,
        isProxy: data.proxy === true,
        isTor: data.tor === true,
        isCrawler: data.is_crawler === true,
        isBlocklisted: data.recent_abuse === true || fraudScore >= 90,
        isDatacenter:
          typeof data.host === 'string' && data.host.trim().length > 0,
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
      const message = errorMessage(error);
      this.logger.warn('IP reputation lookup failed', {
        ip: normalizedIP,
        error: message,
      });
      return this.createErrorResult(normalizedIP, message);
    }
  }

  public async isLikelyVPN(ip: string): Promise<boolean> {
    const result = await this.checkIPReputation(ip);
    return result.isVPN || result.isProxy || result.isTor;
  }

  public async getFraudScore(ip: string): Promise<number> {
    const result = await this.checkIPReputation(ip);
    return result.fraudScore;
  }

  public async shouldBlock(ip: string): Promise<boolean> {
    const config = this.configManager.getConfig();
    const threshold =
      config.integrations?.ipqualityscore?.fraud_score_threshold ?? 75;

    const result = await this.checkIPReputation(ip);
    return result.fraudScore >= threshold || result.isBlocklisted;
  }

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

  private normalizeFraudScore(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }
    return Math.min(100, Math.max(0, value));
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
