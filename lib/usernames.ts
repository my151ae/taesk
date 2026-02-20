import type { ProfileSummary } from '@/lib/supabase';

/** Username must be 3-20 characters, alphanumeric or underscore */
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

/** Normalized username (lowercase) pattern */
const NORMALIZED_USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

const RESERVED_USERNAMES = new Set(
  [
    'admin',
    'administrator',
    'root',
    'system',
    'support',
    'help',
    'api',
    'www',
    'null',
    'undefined',
    'taesk',
    'team',
    'owner',
  ].map((value) => value.toLowerCase())
);

export type UsernameAvailabilityReason = 'invalid_format' | 'reserved' | 'taken' | 'rate_limited';

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isUsernameFormatValid(username: string): boolean {
  const candidate = username.trim();
  return USERNAME_REGEX.test(candidate);
}

export function isNormalizedUsernameValid(username: string): boolean {
  return NORMALIZED_USERNAME_REGEX.test(username);
}

export function isReservedUsername(username: string): boolean {
  const normalized = normalizeUsername(username);
  return RESERVED_USERNAMES.has(normalized);
}

export function resolveProfileIdentity(
  profile?: ProfileSummary | null,
  fallbackEmail?: string | null
): {
  label: string;
  source: 'username' | 'display_name' | 'full_name' | 'email' | 'fallback';
  secondary?: string;
  username?: string | null;
} {
  const trimmedFallback = fallbackEmail?.trim();
  const normalizedProfile = profile ?? null;

  if (normalizedProfile?.username) {
    const username = normalizedProfile.username.trim();
    if (username.length > 0) {
      return {
        label: `@${username}`,
        source: 'username',
        secondary:
          normalizedProfile.display_name?.trim() ||
          normalizedProfile.full_name?.trim() ||
          normalizedProfile.email?.trim() ||
          trimmedFallback ||
          undefined,
        username,
      };
    }
  }

  if (normalizedProfile?.display_name && normalizedProfile.display_name.trim()) {
    return {
      label: normalizedProfile.display_name.trim(),
      source: 'display_name',
      secondary:
        normalizedProfile.full_name?.trim() ||
        normalizedProfile.email?.trim() ||
        trimmedFallback ||
        undefined,
      username: normalizedProfile?.username ?? null,
    };
  }

  if (normalizedProfile?.full_name && normalizedProfile.full_name.trim()) {
    return {
      label: normalizedProfile.full_name.trim(),
      source: 'full_name',
      secondary: normalizedProfile.email?.trim() || trimmedFallback || undefined,
      username: normalizedProfile?.username ?? null,
    };
  }

  if (normalizedProfile?.email && normalizedProfile.email.trim()) {
    return {
      label: normalizedProfile.email.trim(),
      source: 'email',
      secondary: undefined,
      username: normalizedProfile?.username ?? null,
    };
  }

  if (trimmedFallback) {
    return {
      label: trimmedFallback,
      source: 'fallback',
      secondary: undefined,
      username: normalizedProfile?.username ?? null,
    };
  }

  return {
    label: 'Unknown user',
    source: 'fallback',
    secondary: undefined,
    username: normalizedProfile?.username ?? null,
  };
}

export function resolveProfileDisplayName(
  profile?: ProfileSummary | null,
  fallbackEmail?: string | null
): string {
  const normalizedProfile = profile ?? null;
  const displayName = normalizedProfile?.display_name?.trim();
  if (displayName) return displayName;

  const fullName = normalizedProfile?.full_name?.trim();
  if (fullName) return fullName;

  const username = normalizedProfile?.username?.trim();
  if (username) return `@${username}`;

  const email = normalizedProfile?.email?.trim();
  if (email) return email;

  const fallback = fallbackEmail?.trim();
  if (fallback) return fallback;

  return "Unknown user";
}

export function getProfileInitial(
  profile?: ProfileSummary | null,
  fallbackEmail?: string | null
): string {
  const identity = resolveProfileIdentity(profile, fallbackEmail);
  const firstChar = identity.label.trim().charAt(0)
    || fallbackEmail?.trim().charAt(0)
    || 'U';
  return firstChar.toUpperCase();
}
