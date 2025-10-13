import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";

import KanbanBoardClient from "@/app/(board)/_components/KanbanBoardClient";
import { buildBoardUrl } from "@/lib/board-url";
import { fetchBoardInitialData, getBoardByShortId } from "@/lib/server/boards";

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
  if (canonical) {
    const current = ["/b", short_id, ...(slug ?? [])].join("/");
    if (current !== canonical) {
      permanentRedirect(canonical);
    }
  }

  const title = board.name ? `${board.name} | Taesk` : "Taesk";
  const description = board.description ?? undefined;

  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title,
      description,
      url: canonical ?? undefined,
    },
  };
}

export default async function BoardByShortIdPage({ params }: PageProps) {
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

  if (current !== canonical) {
    permanentRedirect(canonical);
  }

  const initialData = await fetchBoardInitialData(board.id);

  return <KanbanBoardClient initialBoard={board} initialData={initialData} />;
}
