export interface IPReputationResult {
  ip: string;
  success: boolean;
  /** Fraud score (0-100, higher = more suspicious) */
  fraudScore: number;
  isVPN: boolean;
  isProxy: boolean;
  isTor: boolean;
  isCrawler: boolean;
  isBlocklisted: boolean;
  isDatacenter: boolean;
  isMobile: boolean;
  isp?: string;
  asn?: number;
  organization?: string;
  /** ISO 3166-1 alpha-2 country code */
  countryCode?: string;
  recentAbuse?: boolean;
  error?: string;
  timestamp: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/** Provides cached VPN, proxy, Tor, and fraud-risk signals for IP addresses. */
export interface IIPReputationService {
  checkIPReputation(ip: string): Promise<IPReputationResult>;

  isLikelyVPN(ip: string): Promise<boolean>;

  getFraudScore(ip: string): Promise<number>;

  shouldBlock(ip: string): Promise<boolean>;

  isEnabled(): boolean;
}
