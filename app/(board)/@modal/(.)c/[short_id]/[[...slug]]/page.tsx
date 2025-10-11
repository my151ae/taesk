import { getCardByShortId } from '@/lib/cards';
import { buildCanonicalPath } from '@/lib/slug';

import CardModalClient from './CardModalClient';

type PageParams = {
  params: Promise<{
    short_id: string;
    slug?: string[];
  }>;
};

export default async function CardModalPage({ params }: PageParams) {
  const { short_id } = await params;
  const card = await getCardByShortId(short_id);

  if (!card || !card.permitted) {
    return <CardModalClient card={null} canonicalPath={null} />;
  }

  const canonicalPath = buildCanonicalPath({
    shortId: card.shortId,
    idShort: card.idShort,
    slug: card.slug,
  });

  return <CardModalClient card={card} canonicalPath={canonicalPath} />;
}
