import { notFound, permanentRedirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface PageProps {
  params: Promise<{
    short_id: string;
    slug?: string[];
  }>;
}

export default async function CardPage({ params }: PageProps) {
  const { short_id, slug } = await params;

  // Fetch card by short_id
  const { data: card, error } = await supabase
    .from('cards')
    .select('*')
    .eq('short_id', short_id)
    .single();

  if (error || !card) {
    notFound();
  }

  // Build expected slug from card title
  const expectedSlug = card.title
    ? card.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : '';

  // Build canonical path
  const canonicalPath = expectedSlug
    ? `/c/${short_id}/${expectedSlug}`
    : `/c/${short_id}`;

  // Check if current slug matches expected slug
  const currentSlug = slug?.join('/') || '';

  // If slugs don't match, 308 permanent redirect to canonical URL
  if (currentSlug !== expectedSlug) {
    permanentRedirect(canonicalPath);
  }

  // Redirect to board with card parameter
  // This will open the card in a modal on the kanban board
  const boardUrl = `/?board=${card.board_id}&card=${card.id}`;
  permanentRedirect(boardUrl);
}
