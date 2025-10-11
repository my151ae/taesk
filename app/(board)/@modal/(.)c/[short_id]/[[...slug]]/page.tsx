import { getCardByShortId } from '@/lib/cards';
import { buildCanonicalPath } from '@/lib/slug';
import { createClient } from '@/lib/supabase';

import CardModalClient from './CardModalClient';

export const runtime = 'nodejs';

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
    return <CardModalClient card={null} canonicalPath={null} boards={[]} />;
  }

  const canonicalPath = buildCanonicalPath({
    shortId: card.shortId,
    idShort: card.idShort,
    slug: card.slug,
  });

  // Fetch boards on server side to avoid client-side request
  const supabase = createClient();
  const { data: boards } = await supabase
    .from('boards')
    .select('*')
    .order('created_at', { ascending: true });

  return (
    <CardModalClient
      card={card}
      canonicalPath={canonicalPath}
      boards={boards || []}
    />
  );
}
