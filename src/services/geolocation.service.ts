import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type {
  IGeolocationService,
  GeoLocation,
  ImpossibleTravelResult,
} from '../di/interfaces/geolocation-service.interface.js';

/**
 * GeolocationService
 *
 * Provides IP geolocation and impossible travel detection
 * using ipinfo.io API with caching
 */
@injectable()
export class GeolocationService implements IGeolocationService {
  /** In-memory cache for geolocation results */
  private cache = new Map<string, { data: GeoLocation; expiresAt: number }>();

  /** API request timeout in milliseconds */
  private readonly API_TIMEOUT = 5000;

  /** Earth's radius in kilometers */
  private readonly EARTH_RADIUS_KM = 6371;

  constructor(
    @inject(TYPES.ConfigManager) private configManager: IConfigManager,
    @inject(TYPES.Logger) private logger: ILogger
  ) {}

  /**
   * Get API token from environment variable or config
   * Environment variable takes precedence over database config
   */
  private getApiToken(): string | undefined {
    const envToken = process.env.IPINFO_API_TOKEN;
    if (envToken && envToken.trim()) {
      return envToken.trim();
    }
    // Fall back to database config
    const config = this.configManager.getConfig();
    return config.integrations?.ipinfo?.api_token;
  }

  /**
   * Check if geolocation service is enabled
   */
  public isEnabled(): boolean {
    const config = this.configManager.getConfig();
    // Service is enabled if either:
    // 1. Explicitly enabled in config
    // 2. API token is set via environment variable (implicit enable)
    const configEnabled = config.integrations?.ipinfo?.enabled ?? false;
    const hasEnvToken = !!process.env.IPINFO_API_TOKEN?.trim();
    return configEnabled || hasEnvToken;
  }

  /**
   * Get geographic location for an IP address
   */
  public async getLocationFromIP(ip: string): Promise<GeoLocation> {
    const normalizedIP = ip.replace(/^::ffff:/, '');

    if (!this.isEnabled()) {
      return this.createErrorResult(
        normalizedIP,
        'Geolocation service is disabled'
      );
    }

    const cached = this.cache.get(normalizedIP);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug('Geolocation cache hit', { ip: normalizedIP });
      return cached.data;
    }

    try {
      const config = this.configManager.getConfig();
      const apiToken = this.getApiToken();
      const cacheTtlHours = config.integrations?.ipinfo?.cache_ttl_hours ?? 24;

      const url = apiToken
        ? `https://ipinfo.io/${normalizedIP}/json?token=${apiToken}`
        : `https://ipinfo.io/${normalizedIP}/json`;

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
        throw new Error(`ipinfo.io API returned ${response.status}`);
      }

      const data = await response.json();

      let latitude: number | undefined;
      let longitude: number | undefined;
      if (data.loc) {
        const [lat, lng] = data.loc.split(',');
        latitude = parseFloat(lat);
        longitude = parseFloat(lng);
      }

      const result: GeoLocation = {
        ip: normalizedIP,
        city: data.city,
        region: data.region,
        country: data.country,
        countryName: data.country, // ipinfo.io returns ISO code, not full name
        latitude,
        longitude,
        timezone: data.timezone,
        org: data.org,
        postal: data.postal,
        success: true,
        timestamp: Date.now(),
      };

      this.cache.set(normalizedIP, {
        data: result,
        expiresAt: Date.now() + cacheTtlHours * 60 * 60 * 1000,
      });

      this.logger.debug('Geolocation lookup successful', {
        ip: normalizedIP,
        country: result.country,
        city: result.city,
      });

      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.warn('Geolocation lookup failed', {
        ip: normalizedIP,
        error: err.message,
      });
      return this.createErrorResult(normalizedIP, err.message);
    }
  }

  /**
   * Calculate distance between two locations using Haversine formula
   */
  public calculateDistance(loc1: GeoLocation, loc2: GeoLocation): number {
    if (
      loc1.latitude === undefined ||
      loc1.longitude === undefined ||
      loc2.latitude === undefined ||
      loc2.longitude === undefined
    ) {
      return -1; // Cannot calculate without coordinates
    }

    const lat1Rad = this.toRadians(loc1.latitude);
    const lat2Rad = this.toRadians(loc2.latitude);
    const deltaLat = this.toRadians(loc2.latitude - loc1.latitude);
    const deltaLng = this.toRadians(loc2.longitude - loc1.longitude);

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1Rad) *
        Math.cos(lat2Rad) *
        Math.sin(deltaLng / 2) *
        Math.sin(deltaLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return this.EARTH_RADIUS_KM * c;
  }

  /**
   * Check for impossible travel between two locations
   */
  public checkImpossibleTravel(
    previousLocation: GeoLocation,
    currentLocation: GeoLocation,
    timeDiffMinutes: number,
    maxSpeedKmh?: number
  ): ImpossibleTravelResult {
    const config = this.configManager.getConfig();
    const defaultMaxSpeed =
      config.security?.protection?.device_matching
        ?.impossible_travel_max_speed_kmh ?? 900;
    const maxSpeed = maxSpeedKmh ?? defaultMaxSpeed;

    const distanceKm = this.calculateDistance(
      previousLocation,
      currentLocation
    );

    if (distanceKm < 0) {
      return {
        isImpossible: false,
        distanceKm: 0,
        timeDiffMinutes,
        speedKmh: 0,
        maxSpeedKmh: maxSpeed,
        riskLevel: 'low',
        explanation: 'Unable to calculate distance - missing coordinates',
      };
    }

    const timeDiffHours = timeDiffMinutes / 60;
    const speedKmh = timeDiffHours > 0 ? distanceKm / timeDiffHours : Infinity;

    const isImpossible = speedKmh > maxSpeed;

    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let explanation = '';

    if (isImpossible) {
      if (speedKmh > maxSpeed * 3) {
        riskLevel = 'critical';
        explanation = `Travel speed of ${Math.round(speedKmh)} km/h is physically impossible`;
      } else if (speedKmh > maxSpeed * 2) {
        riskLevel = 'high';
        explanation = `Travel speed of ${Math.round(speedKmh)} km/h exceeds maximum reasonable speed`;
      } else {
        riskLevel = 'medium';
        explanation = `Travel speed of ${Math.round(speedKmh)} km/h is suspicious`;
      }
    } else if (speedKmh > maxSpeed * 0.7) {
      riskLevel = 'low';
      explanation = `Travel speed of ${Math.round(speedKmh)} km/h is possible but fast`;
    } else {
      explanation = `Travel speed of ${Math.round(speedKmh)} km/h is reasonable`;
    }

    return {
      isImpossible,
      distanceKm: Math.round(distanceKm * 10) / 10,
      timeDiffMinutes,
      speedKmh: Math.round(speedKmh * 10) / 10,
      maxSpeedKmh: maxSpeed,
      riskLevel,
      explanation,
    };
  }

  /**
   * Check if a location is in a high-risk region
   */
  public isHighRiskRegion(location: GeoLocation): boolean {
    if (!location.country) return false;

    const config = this.configManager.getConfig();
    const highRiskCountries =
      config.security?.protection?.high_risk_countries ?? [];

    return highRiskCountries.includes(location.country.toUpperCase());
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Create an error result for failed lookups
   */
  private createErrorResult(ip: string, errorMessage: string): GeoLocation {
    return {
      ip,
      success: false,
      error: errorMessage,
      timestamp: Date.now(),
    };
  }
}
