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

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getEnvironmentApiToken(): string | undefined {
    const token = process.env.IPINFO_API_TOKEN?.trim();
    return token || undefined;
  }

  /**
   * Get API token from environment variable or config
   * Environment variable takes precedence over database config
   */
  private getConfiguredApiToken(
    config: ReturnType<IConfigManager['getConfig']>
  ): string | undefined {
    const configuredToken = config.integrations?.ipinfo?.api_token?.trim();
    return configuredToken || undefined;
  }

  /**
   * Check if geolocation service is enabled
   */
  public isEnabled(): boolean {
    if (this.getEnvironmentApiToken()) return true;

    try {
      const config = this.configManager.getConfig();
      return config.integrations?.ipinfo?.enabled ?? false;
    } catch (error) {
      this.logger.warn('Geolocation configuration unavailable', {
        error: this.errorMessage(error),
      });
      return false;
    }
  }

  private getLookupSettings(): {
    enabled: boolean;
    apiToken?: string;
    cacheTtlHours: number;
  } {
    const envToken = this.getEnvironmentApiToken();

    try {
      const config = this.configManager.getConfig();
      return {
        enabled: (config.integrations?.ipinfo?.enabled ?? false) || !!envToken,
        apiToken: envToken ?? this.getConfiguredApiToken(config),
        cacheTtlHours: config.integrations?.ipinfo?.cache_ttl_hours ?? 24,
      };
    } catch (error) {
      if (!envToken) throw error;

      this.logger.warn(
        'Geolocation configuration unavailable; using environment defaults',
        { error: this.errorMessage(error) }
      );
      return {
        enabled: true,
        apiToken: envToken,
        cacheTtlHours: 24,
      };
    }
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
  }

  private hasValidCoordinates(
    location: Pick<GeoLocation, 'latitude' | 'longitude'>
  ): location is { latitude: number; longitude: number } {
    const { latitude, longitude } = location;
    return (
      latitude !== undefined &&
      longitude !== undefined &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  private parseCoordinates(value: unknown): {
    latitude?: number;
    longitude?: number;
  } {
    if (typeof value !== 'string') return {};

    const parts = value.split(',');
    if (parts.length !== 2 || parts.some(part => !part.trim())) return {};

    const latitude = Number(parts[0]);
    const longitude = Number(parts[1]);
    const coordinates = { latitude, longitude };
    return this.hasValidCoordinates(coordinates) ? coordinates : {};
  }

  private positiveNumber(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) && value > 0
      ? value
      : fallback;
  }

  private getDefaultMaxSpeed(): number {
    try {
      const configured =
        this.configManager.getConfig().security?.protection?.device_matching
          ?.impossible_travel_max_speed_kmh;
      return this.positiveNumber(configured, 900);
    } catch (error) {
      this.logger.warn(
        'Impossible travel configuration unavailable; using defaults',
        { error: this.errorMessage(error) }
      );
      return 900;
    }
  }

  private getHighRiskCountries(): string[] {
    try {
      const configured =
        this.configManager.getConfig().security?.protection
          ?.high_risk_countries ?? [];
      return configured
        .filter((country): country is string => typeof country === 'string')
        .map(country => country.trim().toUpperCase())
        .filter(Boolean);
    } catch (error) {
      this.logger.warn('High-risk region configuration unavailable', {
        error: this.errorMessage(error),
      });
      return [];
    }
  }

  /**
   * Get geographic location for an IP address
   */
  public async getLocationFromIP(ip: string): Promise<GeoLocation> {
    const normalizedIP = ip.replace(/^::ffff:/, '');

    let settings: ReturnType<GeolocationService['getLookupSettings']>;
    try {
      settings = this.getLookupSettings();
    } catch (error) {
      this.logger.warn('Geolocation configuration unavailable', {
        error: this.errorMessage(error),
      });
      return this.createErrorResult(
        normalizedIP,
        'Geolocation service is disabled'
      );
    }

    if (!settings.enabled) {
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
      const url = new URL(
        `https://ipinfo.io/${encodeURIComponent(normalizedIP)}/json`
      );
      if (settings.apiToken) {
        url.searchParams.set('token', settings.apiToken);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.API_TIMEOUT);

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
          },
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`ipinfo.io API returned ${response.status}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const { latitude, longitude } = this.parseCoordinates(data.loc);
      const country = this.optionalString(data.country);

      const result: GeoLocation = {
        ip: normalizedIP,
        city: this.optionalString(data.city),
        region: this.optionalString(data.region),
        country,
        countryName: country, // ipinfo.io returns ISO code, not full name
        latitude,
        longitude,
        timezone: this.optionalString(data.timezone),
        org: this.optionalString(data.org),
        postal: this.optionalString(data.postal),
        success: true,
        timestamp: Date.now(),
      };

      this.cache.set(normalizedIP, {
        data: result,
        expiresAt: Date.now() + settings.cacheTtlHours * 60 * 60 * 1000,
      });

      this.logger.debug('Geolocation lookup successful', {
        ip: normalizedIP,
        country: result.country,
        city: result.city,
      });

      return result;
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn('Geolocation lookup failed', {
        ip: normalizedIP,
        error: message,
      });
      return this.createErrorResult(normalizedIP, message);
    }
  }

  /**
   * Calculate distance between two locations using Haversine formula
   */
  public calculateDistance(loc1: GeoLocation, loc2: GeoLocation): number {
    if (!this.hasValidCoordinates(loc1) || !this.hasValidCoordinates(loc2)) {
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
    const defaultMaxSpeed = this.getDefaultMaxSpeed();
    const maxSpeed = this.positiveNumber(maxSpeedKmh, defaultMaxSpeed);

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

    const normalizedTimeDiffMinutes =
      Number.isFinite(timeDiffMinutes) && timeDiffMinutes > 0
        ? timeDiffMinutes
        : 0;

    if (normalizedTimeDiffMinutes === 0) {
      const hasTravel = distanceKm > 0;
      return {
        isImpossible: hasTravel,
        distanceKm: Math.round(distanceKm * 10) / 10,
        timeDiffMinutes: 0,
        speedKmh: hasTravel ? Number.MAX_VALUE : 0,
        maxSpeedKmh: maxSpeed,
        riskLevel: hasTravel ? 'critical' : 'low',
        explanation: hasTravel
          ? 'Travel time must be greater than zero'
          : 'No travel detected',
      };
    }

    const timeDiffHours = normalizedTimeDiffMinutes / 60;
    const speedKmh = distanceKm / timeDiffHours;

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
      timeDiffMinutes: normalizedTimeDiffMinutes,
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

    const highRiskCountries = this.getHighRiskCountries();
    return highRiskCountries.includes(location.country.trim().toUpperCase());
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
