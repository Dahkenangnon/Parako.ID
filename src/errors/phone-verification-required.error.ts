/**
 * Internal control-flow error raised only after password verification. It
 * carries the minimum data the HTTP controller needs to deliver a challenge;
 * callers must never serialize it into a public response.
 */
export class PhoneVerificationRequiredError extends Error {
  public readonly name = 'PhoneVerificationRequiredError';

  constructor(
    public readonly userId: string,
    public readonly phoneNumber: string
  ) {
    super('Phone verification is required');
  }
}
