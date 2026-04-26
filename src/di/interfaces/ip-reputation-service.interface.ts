/**
 * IP reputation information from IPQualityScore or similar service
 */
export interface IPReputationResult {
  /** IP address that was checked */
  ip: string;
  /** Whether the lookup succeeded */
  success: boolean;
  /** Fraud score (0-100, higher = more suspicious) */
  fraudScore: number;
  /** Whether this IP is likely a VPN */
  isVPN: boolean;
  /** Whether this IP is likely a proxy */
  isProxy: boolean;
  /** Whether this IP is likely a Tor exit node */
  isTor: boolean;
  /** Whether this is a known crawler/bot IP */
  isCrawler: boolean;
  /** Whether this IP is on any blocklists */
  isBlocklisted: boolean;
  /** Whether this is a datacenter/hosting IP */
  isDatacenter: boolean;
  /** Whether this IP is using mobile data */
  isMobile: boolean;
  /** ISP name */
  isp?: string;
  /** ASN (Autonomous System Number) */
  asn?: number;
  /** Organization name */
  organization?: string;
  /** ISO 3166-1 alpha-2 country code */
  countryCode?: string;
  /** Recent abuse reports for this IP */
  recentAbuse?: boolean;
  /** Error message if lookup failed */
  error?: string;
  /** Timestamp when the reputation was retrieved */
  timestamp: number;
  /** Overall risk level based on all factors */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * IIPReputationService interface
 *
 * Provides IP reputation checking for VPN/proxy detection and fraud scoring
 * Uses IPQualityScore API for reputation data
 */
export interface IIPReputationService {
  /**
   * Check the reputation of an IP address
   * Results are cached for the configured TTL
   * @param ip - IP address to check
   * @returns IPReputationResult with reputation data
   */
  checkIPReputation(ip: string): Promise<IPReputationResult>;

  /**
   * Quick check if an IP is likely a VPN, proxy, or Tor
   * @param ip - IP address to check
   * @returns true if likely VPN/proxy/Tor
   */
  isLikelyVPN(ip: string): Promise<boolean>;

  /**
   * Get the fraud score for an IP address
   * @param ip - IP address to check
   * @returns Fraud score 0-100 (higher = more suspicious)
   */
  getFraudScore(ip: string): Promise<number>;

  /**
   * Check if an IP should be blocked based on configured threshold
   * @param ip - IP address to check
   * @returns true if the IP should be blocked
   */
  shouldBlock(ip: string): Promise<boolean>;

  /**
   * Check if IP reputation service is enabled and available
   * @returns true if the service can be used
   */
  isEnabled(): boolean;
}
