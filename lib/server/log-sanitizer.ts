type UnknownRecord = Record<string, unknown>;

export type SanitizedProviderError = {
  name: string;
  message: string;
  code: string | number | null;
  response: unknown;
  errors: unknown;
};

function mask(value: string, prefix = 3, suffix = 2): string {
  if (!value) return '';
  if (value.length <= prefix + suffix) return '*'.repeat(Math.max(value.length, 4));
  const suffixValue = suffix > 0 ? value.slice(-suffix) : '';
  return `${value.slice(0, prefix)}***${suffixValue}`;
}

export function maskToken(token?: string | null): string | null {
  if (!token) return null;
  return mask(token, 4, 3);
}

export function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${mask(local, 1, 0)}@${domain}`;
}

export function sanitizeProviderError(error: unknown): SanitizedProviderError | UnknownRecord {
  if (!(error instanceof Error)) {
    return { message: 'Unknown provider error' };
  }

  const maybe = error as Error & {
    code?: string | number;
    response?: { data?: unknown };
    errors?: unknown;
  };

  return {
    name: maybe.name,
    message: maybe.message,
    code: maybe.code ?? null,
    response: maybe.response?.data ?? null,
    errors: maybe.errors ?? null,
  };
}
