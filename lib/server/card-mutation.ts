import { NextResponse } from "next/server";

type DbLikeError = {
  code?: string;
  message?: string;
};

type MutationResult<T> = {
  data: T | null;
  error: DbLikeError | null;
};

type MutationRunner<T> = (payload: Record<string, unknown>) => Promise<MutationResult<T>>;

const CARD_COLUMN_MIGRATIONS: Record<string, string> = {
  checklist: "20251129090000_add_checklist_to_cards.sql",
  content: "20251220090000_add_card_content.sql",
  started_at: "20260309120000_add_started_at_to_cards.sql",
};

export function isMissingColumnError(error: unknown, column: string): boolean {
  const target = error as DbLikeError | null;
  if (!target) return false;
  return (
    target.code === "42703" ||
    (typeof target.message === "string" && target.message.includes(column))
  );
}

export function stripUndefinedValues(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) {
      delete next[key];
    }
  });
  return next;
}

export async function runCardMutationWithFallback<T>(
  runMutation: MutationRunner<T>,
  initialPayload: Record<string, unknown>,
  fallbackColumns: string[]
): Promise<{ data: T | null; error: DbLikeError | null; payload: Record<string, unknown> }> {
  let payload = { ...initialPayload };
  let result = await runMutation(payload);

  for (const column of fallbackColumns) {
    if (!(column in payload)) continue;
    if (!isMissingColumnError(result.error, column)) continue;
    const nextPayload = { ...payload };
    delete nextPayload[column];
    payload = nextPayload;
    result = await runMutation(payload);
  }

  return { data: result.data, error: result.error, payload };
}

export function missingCardColumnResponse(column: string): NextResponse | null {
  const migration = CARD_COLUMN_MIGRATIONS[column];
  if (!migration) return null;
  return NextResponse.json(
    {
      error: {
        code: `MISSING_${column.toUpperCase()}_COLUMN`,
        message: `${capitalize(column)} column is missing. Apply migration ${migration}`,
      },
    },
    { status: 500 }
  );
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
