import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { readFile } from "fs/promises";
import {
  createUniqueBoardShortId,
  getNextBoardIdShort,
  slugifyBoardName,
} from "@/lib/board-utils";

export const TEST_USER_EMAIL = process.env.E2E_TEST_EMAIL ?? "e2e-test@taesk.app";
export const MAIN_TEST_BOARD_ID = "00000000-0000-0000-0000-000000000001";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase admin credentials for timeline fixtures");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export type TimelineBoardContext = {
  boardId: string;
  boardShortId: string;
  boardIdShort: number;
  boardSlug: string;
  listId: string;
  canonicalPath: string;
  boardName: string;
};

export const isoDateJst = (): string => {
  const now = Date.now();
  const jst = new Date(now + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = `${jst.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${jst.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const shiftIsoDateJst = (offsetDays: number): string => {
  const now = Date.now();
  const jst = new Date(now + 9 * 60 * 60 * 1000);
  const shifted = new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + offsetDays)
  );
  const year = shifted.getUTCFullYear();
  const month = `${shifted.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${shifted.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const resolveTestUserId = async (): Promise<string> => {
  const storageStatePath =
    process.env.PLAYWRIGHT_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
  const raw = await readFile(storageStatePath, "utf-8");
  const parsed = JSON.parse(raw) as {
    origins?: Array<{
      localStorage?: Array<{ name?: string; value?: string }>;
    }>;
  };

  const authTokenValue = parsed.origins
    ?.flatMap((origin) => origin.localStorage ?? [])
    .find(
      (entry) =>
        typeof entry.name === "string" && entry.name.includes("auth-token")
    )?.value;

  if (!authTokenValue) {
    throw new Error(
      `Failed to resolve auth token from storage state: ${storageStatePath}`
    );
  }

  const authToken = JSON.parse(authTokenValue) as {
    user?: { id?: string; email?: string };
  };
  const userId = authToken.user?.id;
  const userEmail = authToken.user?.email;

  if (!userId) {
    throw new Error(
      `Failed to resolve authenticated user id from storage state: ${storageStatePath}`
    );
  }

  if (userEmail && userEmail !== TEST_USER_EMAIL) {
    console.warn(
      `[timeline.spec] auth user email mismatch. expected=${TEST_USER_EMAIL} actual=${userEmail}`
    );
  }

  return userId;
};

export async function ensureBoardFixtures(
  testUserId: string
): Promise<TimelineBoardContext> {
  const { data: seedBoard, error: seedBoardError } = await supabaseAdmin
    .from("boards")
    .select("team_id")
    .eq("id", MAIN_TEST_BOARD_ID)
    .maybeSingle();
  if (seedBoardError || !seedBoard?.team_id) {
    throw new Error(
      `Failed to resolve test team_id: ${seedBoardError?.message ?? "missing team_id"}`
    );
  }

  const now = new Date().toISOString();
  const boardId = crypto.randomUUID();
  const boardName = `Timeline Test Board ${Date.now()}`;
  const boardShortId = await createUniqueBoardShortId();
  const boardIdShort = await getNextBoardIdShort();
  const boardSlug = slugifyBoardName(boardName);
  const listId = crypto.randomUUID();

  await supabaseAdmin.from("boards").insert({
    id: boardId,
    team_id: seedBoard.team_id,
    name: boardName,
    description: "Board used for timeline specs",
    is_test_board: true,
    user_id: testUserId,
    short_id: boardShortId,
    id_short: boardIdShort,
    slug: boardSlug,
    created_at: now,
    updated_at: now,
  });

  await supabaseAdmin.from("board_members").insert({
    board_id: boardId,
    profile_id: testUserId,
    role: "owner",
    created_at: now,
  });

  await supabaseAdmin.from("lists").insert({
    id: listId,
    title: "Timeline Tasks",
    position: 1000,
    board_id: boardId,
    user_id: testUserId,
    created_at: now,
    updated_at: now,
  });

  const canonicalTail = boardSlug ? `${boardIdShort}-${boardSlug}` : `${boardIdShort}`;
  const canonicalPath = boardSlug
    ? `/b/${boardShortId}/${canonicalTail}`
    : `/b/${boardShortId}`;

  return {
    boardId,
    boardShortId,
    boardIdShort,
    boardSlug,
    listId,
    canonicalPath,
    boardName,
  };
}

export async function supportsDueColumns(): Promise<boolean> {
  const { error } = await supabaseAdmin.from("cards").select("due_bucket").limit(1);
  if (!error) return true;
  return !error.message?.includes("due_bucket");
}
