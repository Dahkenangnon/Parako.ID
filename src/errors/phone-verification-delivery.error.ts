/**
 * Signals that a replacement phone challenge could not be delivered.
 *
 * The original opaque token remains valid after the service compensates the
 * failed rotation, so browser controllers can keep the user on a recoverable
 * verification page without exposing persisted challenge hashes.
 */
export class PhoneVerificationDeliveryError extends Error {
  public readonly verificationToken: string;

  constructor(verificationToken: string, options?: ErrorOptions) {
    super('Phone verification code could not be delivered', options);
    this.name = 'PhoneVerificationDeliveryError';
    this.verificationToken = verificationToken;
  }
}
