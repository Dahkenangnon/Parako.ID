export class PasswordCompromisedError extends Error {
  public readonly name = 'PasswordCompromisedError';

  constructor(public readonly breachCount: number) {
    const occurrences = breachCount === 1 ? 'data breach' : 'data breaches';
    super(
      `This password has appeared in ${breachCount} known ${occurrences} and cannot be used. Please choose a different password.`
    );
  }
}
