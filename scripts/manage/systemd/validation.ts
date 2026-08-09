export const SERVICE_NAME_ERROR =
  'Service name must start with a letter/digit and contain only lowercase letters, digits, dots, hyphens, or underscores';

export function validateServiceName(input: string): true | string {
  if (!input) return 'Service name is required';
  return /^[a-z0-9][a-z0-9._-]*$/u.test(input) ? true : SERVICE_NAME_ERROR;
}

export function assertServiceName(input: string): void {
  const result = validateServiceName(input);
  if (result !== true) {
    throw new Error(result);
  }
}
