import { buildCanonicalPath, toSlugBase } from './slug';

type CardLike = {
  shortId: string;
  title: string;
  slug?: string | null;
  idShort?: number | null;
};

/**
 * Build the canonical path for a card. Falls back to regenerated slug if the
 * stored slug is missing to keep legacy rows working.
 */
export function buildCardUrl(card: CardLike): string {
  const slug = card.slug ?? toSlugBase(card.title);
  return buildCanonicalPath({ shortId: card.shortId, idShort: card.idShort ?? undefined, slug });
}
