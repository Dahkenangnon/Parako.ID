/** Compute the public display name consistently across persistence adapters. */
export function computeUserName(
  givenName: string | null | undefined,
  familyName: string | null | undefined,
  customIdentifier1: string | null | undefined,
  storedName: string | null | undefined
): string | undefined {
  const given = givenName?.trim() || '';
  const family = familyName?.trim() || '';
  if (given && family) return `${given} ${family}`;
  if (given) return given;
  if (family) return family;
  return storedName?.trim() || customIdentifier1?.trim() || undefined;
}
