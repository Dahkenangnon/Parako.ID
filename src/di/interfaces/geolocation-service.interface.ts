export interface GeoLocation {
  ip: string;
  city?: string;
  region?: string;
  /** ISO 3166-1 alpha-2 country code */
  country?: string;
  countryName?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  org?: string;
  postal?: string;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface ImpossibleTravelResult {
  isImpossible: boolean;
  distanceKm: number;
  timeDiffMinutes: number;
  speedKmh: number;
  maxSpeedKmh: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
}

/** Provides cached IP geolocation and impossible-travel detection. */
export interface IGeolocationService {
  getLocationFromIP(ip: string): Promise<GeoLocation>;

  /** Returns the Haversine distance in kilometers. */
  calculateDistance(loc1: GeoLocation, loc2: GeoLocation): number;

  /** `maxSpeedKmh` defaults to the configured maximum travel speed. */
  checkImpossibleTravel(
    previousLocation: GeoLocation,
    currentLocation: GeoLocation,
    timeDiffMinutes: number,
    maxSpeedKmh?: number
  ): ImpossibleTravelResult;

  /** Evaluates the configured `high_risk_countries` list. */
  isHighRiskRegion(location: GeoLocation): boolean;

  isEnabled(): boolean;
}
