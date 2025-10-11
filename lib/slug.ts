/**
 * Utilities for generating canonical card slugs and URLs.
 * These helpers are shared between server-side routing logic
 * and client-side interactions that need to reference stored values.
 */

/**
 * Normalize a title into a URL-safe slug. Falls back to encodeURIComponent
 * when the normalized string becomes empty (e.g. Japanese-only titles).
 */
export function toSlugBase(title: string): string {
  const base = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\- ]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/\-+/g, '-');

  return base || encodeURIComponent(title);
}

/**
 * Compose the human-friendly tail segment (`<idShort>-<slug>` or just slug).
 */
export function buildReadableTail(idShort: number | null | undefined, slug: string): string {
  return idShort ? `${idShort}-${slug}` : slug;
}

/**
 * Build the canonical path for a card from short id, optional idShort, and slug.
 */
export function buildCanonicalPath(card: { shortId: string; idShort?: number | null; slug: string }): string {
  return `/c/${card.shortId}/${buildReadableTail(card.idShort ?? undefined, card.slug)}`;
}
