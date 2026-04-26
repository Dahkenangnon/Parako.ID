import { Request } from 'express';
import {
  ClientDeviceInfos,
  ClientDetails,
  DeviceMatchResult,
  DeviceMatchConfig,
} from '../../utils/client-info.js';

/**
 * Interface for client device info manager service
 * Defines the contract for client device information management operations
 */
export interface IClientDeviceInfoManager {
  /**
   * Extract device information from request body
   * Looks for the _deviceInfo field in POST body
   *
   * @param req - Express request object
   * @returns Parsed device information or null if not found/invalid
   */
  extractDeviceInfoFromRequest(req: Request): ClientDeviceInfos | null;

  /**
   * Check if device information is available in the request
   * @param req - Express request object
   * @returns true if device info is available, false otherwise
   */
  hasDeviceInfoInRequest(req: Request): boolean;

  /**
   * Get client information from request, automatically extracting device info
   * This is the recommended method to use in controllers
   *
   * @param req - Express request object
   * @returns Client details with device information
   */
  getClientInfoFromRequest(req: Request): ClientDetails;

  /**
   * Get client information from request and client payload
   *
   * @param req - Express request object
   * @param clientPayload - Device information from client side
   * @returns Client details with server-side generated fingerprint
   */
  getClientInfo(req: Request, clientPayload?: ClientDeviceInfos): ClientDetails;

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * @param str1 - First string
   * @param str2 - Second string
   * @returns Similarity score between 0 and 1
   */
  calculateStringSimilarity(str1: string, str2: string): number;

  /**
   * Calculate IP address similarity
   * @param ip1 - First IP address
   * @param ip2 - Second IP address
   * @returns Similarity score between 0 and 1
   */
  calculateIPSimilarity(ip1: string, ip2: string): number;

  /**
   * Check if IP is in suspicious ranges
   * @param ip - IP address to check
   * @param config - Device match configuration
   * @returns True if IP is suspicious
   */
  isSuspiciousIP(ip: string, config: DeviceMatchConfig): boolean;

  /**
   * Check if IP is in a given range
   * @param ip - IP address to check
   * @param range - IP range to check against
   * @returns True if IP is in range
   */
  isIPInRange(ip: string, range: string): boolean;

  /**
   * Calculate browser and OS similarity
   * @param device1 - First device details
   * @param device2 - Second device details
   * @returns Similarity score between 0 and 1
   */
  calculateBrowserOSSimilarity(
    device1: ClientDetails,
    device2: ClientDetails
  ): number;

  /**
   * Calculate overall device similarity score
   * @param newDevice - New device details
   * @param oldDevice - Old device details
   * @param config - Device match configuration
   * @returns Similarity score between 0 and 1
   */
  calculateDeviceSimilarity(
    newDevice: ClientDetails,
    oldDevice: ClientDetails,
    config: DeviceMatchConfig
  ): number;

  /**
   * Determine risk level based on various factors
   * @param newDevice - New device details
   * @param oldDevices - Array of old device details
   * @param config - Device match configuration
   * @returns Risk level
   */
  determineRiskLevel(
    newDevice: ClientDetails,
    oldDevices: ClientDetails[],
    config: DeviceMatchConfig
  ): 'low' | 'medium' | 'high' | 'critical';

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
    config?: DeviceMatchConfig
  ): DeviceMatchResult;

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
    config?: DeviceMatchConfig
  ): DeviceMatchResult;
}
