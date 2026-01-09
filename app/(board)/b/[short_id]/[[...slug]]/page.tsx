import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";

import TimelineBoardPage from "@/app/(board)/_components/timeline/TimelineBoardPage";
import { buildBoardUrl } from "@/lib/board-url";
import { getBoardByShortId } from "@/lib/server/boards";

type PageParams = {
  short_id: string;
  slug?: string[];
};

type PageProps = {
  params: Promise<PageParams>;
};

export const revalidate = 0;
export const runtime = "nodejs";

const getBoardByShortIdCached = cache(async (shortId: string) => {
  return getBoardByShortId(shortId);
});

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { short_id, slug } = await params;
  const board = await getBoardByShortIdCached(short_id);

  if (!board) {
    return {};
  }

  const canonical = buildBoardUrl(board);
  const encodedCanonical = canonical ? encodeURI(canonical) : undefined;
  if (encodedCanonical) {
    const current = ["/b", short_id, ...(slug ?? [])].join("/");
    // Normalize both for comparison to handle NFC/NFD mismatch (common on macOS)
    const normalizedCurrent = decodeURIComponent(current).normalize('NFC');
    const normalizedCanonical = canonical.normalize('NFC');

    if (normalizedCurrent !== normalizedCanonical) {
      permanentRedirect(encodedCanonical);
    }
  }

  const title = board.name ? `${board.name} | Taesk` : "Taesk";
  const description = board.description ?? undefined;

  return {
    title,
    description,
    alternates: encodedCanonical ? { canonical: encodedCanonical } : undefined,
    openGraph: {
      title,
      description,
      url: encodedCanonical,
    },
  };
}

import { createServerSupabaseClient } from "@/lib/supabase";

export default async function BoardByShortIdPage({ params }: PageProps) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    permanentRedirect("/login");
  }

  const { short_id, slug } = await params;
  const board = await getBoardByShortIdCached(short_id);

  if (!board) {
    notFound();
  }

  const canonical = buildBoardUrl(board);
  if (!canonical) {
    notFound();
  }
  const current = ["/b", short_id, ...(slug ?? [])].join("/");
  // Normalize both for comparison
  const normalizedCurrent = decodeURIComponent(current).normalize('NFC');
  const normalizedCanonical = canonical.normalize('NFC');

  if (normalizedCurrent !== normalizedCanonical) {
    permanentRedirect(encodeURI(canonical));
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-50"><div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-sky-500 animate-spin" /></div>}>
      <TimelineBoardPage initialBoard={board} />
    </Suspense>
  );
}
