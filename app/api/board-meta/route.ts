import { NextResponse } from "next/server";

import { buildBoardUrl } from "@/lib/board-url";
import { getBoardById } from "@/lib/server/boards";

export const runtime = "edge";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const uuid = searchParams.get("uuid");

  if (!uuid) {
    return NextResponse.json({ error: "uuid required" }, { status: 400 });
  }

  try {
    const board = await getBoardById(uuid);
    if (!board?.short_id || typeof board.id_short !== "number") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const canonicalPath = buildBoardUrl(board);
    if (!canonicalPath) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({
      short_id: board.short_id,
      id_short: board.id_short,
      slug: board.slug,
      canonical_path: canonicalPath,
    });
  } catch (error) {
    console.error("[api/board-meta] unexpected error:", error);
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
