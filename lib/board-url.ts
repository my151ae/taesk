import { buildReadableTail, toSlugBase } from './slug';

type BoardLike = {
  short_id?: string | null;
  name: string;
  slug?: string | null;
  id_short?: number | null;
};

/**
 * Build the canonical path for a board (full URL with id_short-slug).
 * Falls back to regenerated slug if the stored slug is missing.
 * Returns empty string if short_id is not available.
 */
export function buildBoardUrl(board: BoardLike): string {
  if (!board.short_id) return '';

  const slug = board.slug ?? toSlugBase(board.name);
  const tail = buildReadableTail(board.id_short ?? undefined, slug);
  return `/b/${board.short_id}/${tail}`;
}

/**
 * Build the short URL for a board (without id_short-slug, for sharing).
 * This is the most resilient format that won't break even if title changes.
 * Returns empty string if short_id is not available.
 */
export function buildBoardShortUrl(board: Pick<BoardLike, 'short_id'>): string {
  if (!board.short_id) return '';
  return `/b/${board.short_id}`;
}
