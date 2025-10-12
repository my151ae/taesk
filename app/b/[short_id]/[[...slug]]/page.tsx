import { notFound, redirect } from 'next/navigation';
import { getBoardByShortId } from '@/lib/board-utils';
import { buildReadableTail, toSlugBase } from '@/lib/slug';

type PageProps = {
  params: Promise<{
    short_id: string;
    slug?: string[];
  }>;
};

export default async function BoardPage({ params }: PageProps) {
  const { short_id, slug } = await params;

  // Get board by short_id
  const board = await getBoardByShortId(short_id);

  if (!board) {
    notFound();
  }

  // Build the expected slug
  const slugValue = board.slug ?? toSlugBase(board.name);
  const expected = buildReadableTail(board.id_short ?? undefined, slugValue);

  // Build canonical path
  const canonical = `/b/${short_id}/${expected}`;

  // Get current path
  const current = slug?.join('/') || '';

  // If slug doesn't match, redirect to canonical URL
  if (current !== expected) {
    redirect(canonical);
  }

  // Redirect to the main board page with board query parameter
  // This maintains compatibility with the existing app structure
  redirect(`/?board=${board.id}`);
}
