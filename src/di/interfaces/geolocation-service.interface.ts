/**
 * Geographic location information for an IP address
 */
export interface GeoLocation {
  /** IP address */
  ip: string;
  /** City name */
  city?: string;
  /** Region/state name */
  region?: string;
  /** ISO 3166-1 alpha-2 country code */
  country?: string;
  /** Country name */
  countryName?: string;
  /** Latitude coordinate */
  latitude?: number;
  /** Longitude coordinate */
  longitude?: number;
  /** Timezone string (e.g., 'America/New_York') */
  timezone?: string;
  /** ISP/organization name */
  org?: string;
  /** Postal/zip code */
  postal?: string;
  /** Whether the lookup succeeded */
  success: boolean;
  /** Error message if lookup failed */
  error?: string;
  /** Timestamp when the location was retrieved */
  timestamp: number;
}

/**
 * Result of an impossible travel check
 */
export interface ImpossibleTravelResult {
  /** Whether impossible travel was detected */
  isImpossible: boolean;
  /** Distance between locations in kilometers */
  distanceKm: number;
  /** Time difference between logins in minutes */
  timeDiffMinutes: number;
  /** Calculated speed in km/h */
  speedKmh: number;
  /** Maximum allowed speed in km/h */
  maxSpeedKmh: number;
  /** Risk level: 'low' | 'medium' | 'high' | 'critical' */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Human-readable explanation */
  explanation: string;
}

/**
 * IGeolocationService interface
 *
 * Provides IP geolocation and impossible travel detection
 * Uses ipinfo.io API for geolocation data
 */
export interface IGeolocationService {
  /**
   * Get geographic location for an IP address
   * Results are cached for the configured TTL
   * @param ip - IP address to look up
   * @returns GeoLocation object with location data
   */
  getLocationFromIP(ip: string): Promise<GeoLocation>;

  /**
   * Calculate distance between two geographic locations using Haversine formula
   * @param loc1 - First location
   * @param loc2 - Second location
   * @returns Distance in kilometers
   */
  calculateDistance(loc1: GeoLocation, loc2: GeoLocation): number;

  /**
   * Check for impossible travel between two locations
   * Determines if a user could have physically traveled between two points
   * in the given time frame
   * @param previousLocation - Location of previous login
   * @param currentLocation - Location of current login
   * @param timeDiffMinutes - Time difference between logins in minutes
   * @param maxSpeedKmh - Maximum reasonable travel speed (default: 900 km/h for planes)
   * @returns ImpossibleTravelResult with analysis
   */
  checkImpossibleTravel(
    previousLocation: GeoLocation,
    currentLocation: GeoLocation,
    timeDiffMinutes: number,
    maxSpeedKmh?: number
  ): ImpossibleTravelResult;

  /**
   * Check if a location is in a high-risk region
   * Uses the configured high_risk_countries list
   * @param location - Location to check
   * @returns true if the location is considered high-risk
   */
  isHighRiskRegion(location: GeoLocation): boolean;

  /**
   * Check if geolocation service is enabled and available
   * @returns true if the service can be used
   */
  isEnabled(): boolean;
}
