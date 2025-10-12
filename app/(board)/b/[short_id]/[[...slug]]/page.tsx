import { notFound, permanentRedirect } from "next/navigation";

import KanbanBoardClient from "@/app/(board)/_components/KanbanBoardClient";
import { buildBoardUrl } from "@/lib/board-url";
import { fetchBoardInitialData, getBoardByShortId } from "@/lib/server/boards";

type PageParams = {
  short_id: string;
  slug?: string[];
};

type PageProps = {
  params: PageParams;
};

export const revalidate = 0;

export default async function BoardByShortIdPage({ params }: PageProps) {
  const { short_id, slug } = params;
  const board = await getBoardByShortId(short_id);

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
