/**
 * Result of an SMS send operation
 */
export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Phone number validation result
 */
export interface PhoneValidationResult {
  valid: boolean;
  formatted?: string; // E.164 format
  countryCode?: string;
  error?: string;
}

/**
 * Interface for SMS providers (Twilio, Nexmo/Vonage)
 */
export interface ISmsProvider {
  /**
   * Send an SMS message
   * @param to - Recipient phone number
   * @param message - Message content
   */
  sendSms(to: string, message: string): Promise<SmsResult>;

  /**
   * Validate and format a phone number
   * @param phone - Phone number to validate
   * @param defaultCountry - Default country code (e.g., 'US')
   */
  validatePhoneNumber(
    phone: string,
    defaultCountry?: string
  ): PhoneValidationResult;

  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Check if the provider is properly configured
   */
  isConfigured(): boolean;
}
