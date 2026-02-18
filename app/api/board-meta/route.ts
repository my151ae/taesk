import { NextRequest, NextResponse } from "next/server";

import { buildBoardUrl } from "@/lib/board-url";
import { createServerSupabaseClient } from "@/lib/supabase";
import { withErrorHandling } from "@/lib/server/with-error-handling";

export const runtime = "edge";

const getHandler = async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const uuid = searchParams.get("uuid");

  if (!uuid) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "uuid required" } },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { data: membership } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", uuid)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found" } },
      { status: 404 }
    );
  }

  const { data: board, error: boardError } = await supabase
    .from("boards")
    .select("short_id, id_short, slug, name")
    .eq("id", uuid)
    .maybeSingle();

  if (boardError) {
    console.error("[api/board-meta] failed to fetch board");
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Failed to fetch board" } },
      { status: 500 }
    );
  }

  if (!board?.short_id || typeof board.id_short !== "number") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found" } },
      { status: 404 }
    );
  }

  const canonicalPath = buildBoardUrl(board);
  if (!canonicalPath) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    short_id: board.short_id,
    id_short: board.id_short,
    slug: board.slug,
    canonical_path: canonicalPath,
  });
};

export const GET = withErrorHandling(getHandler, "board-meta-get");
