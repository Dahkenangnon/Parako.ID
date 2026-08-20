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

  fingerprint: string;

  /**
   * FingerprintJS visitorId is sent to the server at each login success.
   */
  fingerprint_js_id?: string;
};

/**
 * Device match evaluation result with detailed analysis
 */
export type DeviceMatchResult = {
  is_new_device: boolean;
  requires_2fa: boolean;
  is_suspicious: boolean;
  /** Confidence score (0-100) for the match */
  confidence_score: number;
  reason: string;
  matched_device?: ClientDetails;
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
  suspicious_regions: string[];
  vpn_proxy_ranges: string[];
};
