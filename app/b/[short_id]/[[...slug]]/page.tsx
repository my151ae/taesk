import { notFound, redirect } from 'next/navigation';
import TimelineBoardPage from "@/app/(board)/_components/timeline/TimelineBoardPage";
import { getBoardByShortId } from "@/lib/server/boards";
import { buildBoardUrl } from "@/lib/board-url";

export const runtime = "nodejs";
export const revalidate = 0;

type Params = {
    short_id: string;
    slug?: string[];
};

export default async function BoardPage({ params }: { params: Params }) {
    const { short_id } = params;

    // Fetch board by short_id
    const board = await getBoardByShortId(short_id);

    if (!board) {
        notFound();
    }

    // Build the canonical URL
    const canonicalUrl = buildBoardUrl(board);

    // Get the current URL path
    const currentSlug = params.slug ? params.slug.join('/') : '';
    const currentPath = currentSlug ? `/b/${short_id}/${currentSlug}` : `/b/${short_id}`;

    // Redirect to canonical URL if the current path doesn't match
    if (canonicalUrl && currentPath !== canonicalUrl) {
        redirect(canonicalUrl);
    }

    return <TimelineBoardPage initialBoard={board} />;
}
