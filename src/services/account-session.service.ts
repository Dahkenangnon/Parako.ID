export interface AccountSessionServiceDependencies {
  findExpressSessionsForUser(username: string): Promise<unknown[]>;
  revokeExpressSession(sessionId: string): Promise<boolean>;
  warn(message: string): void;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export class AccountSessionService {
  constructor(
    private readonly dependencies: AccountSessionServiceDependencies
  ) {}

  async revokeOtherExpressSessions(
    username: string,
    currentSessionId: string | undefined
  ): Promise<number> {
    const sessions =
      await this.dependencies.findExpressSessionsForUser(username);
    let revokedCount = 0;

    for (const session of sessions) {
      const sessionId = asRecord(session)?._id;
      if (!isNonEmptyString(sessionId)) {
        this.dependencies.warn(
          'Skipping malformed Express session during bulk revocation'
        );
        continue;
      }

      if (
        sessionId !== currentSessionId &&
        (await this.dependencies.revokeExpressSession(sessionId))
      ) {
        revokedCount++;
      }
    }

    return revokedCount;
  }
}
