interface ConsentDocument {
  getElementById(id: string): HTMLElement | null;
}

/** Prevent replaying a one-time OIDC consent interaction. */
export function installConsentSubmissionGuard(root: ConsentDocument): void {
  const form = root.getElementById('consent-form') as HTMLFormElement | null;
  const submitButton = root.getElementById(
    'consent-submit-btn'
  ) as HTMLButtonElement | null;

  if (!form || !submitButton) return;

  let submitted = false;
  form.addEventListener('submit', event => {
    if (submitted) {
      event.preventDefault();
      return;
    }

    submitted = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Continuing…';
  });
}

if (typeof document !== 'undefined') {
  installConsentSubmissionGuard(document);
}
