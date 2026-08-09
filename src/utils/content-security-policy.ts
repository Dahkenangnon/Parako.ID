const FORM_ACTION_DIRECTIVE = /(^|;)(\s*)form-action\s+([^;]*)/i;

/**
 * Extend an existing CSP form-action directive with a validated web redirect
 * origin. OIDC provider interaction details are the source of redirectUri, so
 * the value has already been matched against the client's registered URIs.
 */
export function allowFormActionRedirectOrigin(
  policy: string,
  redirectUri: unknown
): string {
  if (typeof redirectUri !== 'string') return policy;

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    return policy;
  }

  if (redirectUrl.protocol !== 'https:' && redirectUrl.protocol !== 'http:') {
    return policy;
  }

  const redirectOrigin = redirectUrl.origin;
  return policy.replace(
    FORM_ACTION_DIRECTIVE,
    (directive, prefix: string, whitespace: string, sources: string) => {
      const currentSources = sources.trim().split(/\s+/);
      if (currentSources.includes(redirectOrigin)) return directive;

      return `${prefix}${whitespace}form-action ${sources.trim()} ${redirectOrigin}`;
    }
  );
}
