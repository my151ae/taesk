import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProfileSummary } from "@/lib/supabase";
import { MENTION_REGEX } from "@/lib/mention-utils";
import { resolveProfileIdentity } from "@/lib/usernames";

export type CardAccessMeta = {
  boardId: string;
  cardMeta: {
    title: string | null;
    short_id: string | null;
    slug: string | null;
  };
};

export type CreateCommentInput = {
  body: string;
  mentions: string[];
  parentId: string | null;
};

export function parseCreateCommentBody(rawBody: unknown):
  | { ok: true; data: CreateCommentInput }
  | { ok: false; response: NextResponse } {
  const input = (rawBody ?? {}) as {
    body?: unknown;
    mentions?: unknown;
    parent_id?: unknown;
  };

  const commentBody = typeof input.body === "string" ? input.body : "";
  const parentId = typeof input.parent_id === "string" ? input.parent_id : null;
  const mentions = Array.isArray(input.mentions)
    ? input.mentions.filter((item): item is string => typeof item === "string")
    : [];

  if (!commentBody.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Comment body is required" } },
        { status: 400 }
      ),
    };
  }

  return {
    ok: true,
    data: {
      body: commentBody,
      mentions,
      parentId,
    },
  };
}

export function replaceMentionsForNotification(
  body: string,
  profilesById: Map<string, ProfileSummary>
): string {
  return body.replace(MENTION_REGEX, (_match, id: string) => {
    const profile = profilesById.get(id) ?? null;
    const identity = resolveProfileIdentity(profile, profile?.email ?? null);
    return identity.label.startsWith("@") ? identity.label : `@${identity.label}`;
  });
}

export async function assertCardMemberAccess(
  supabase: SupabaseClient,
  cardId: string,
  userId: string
): Promise<CardAccessMeta> {
  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("board_id, title, short_id, slug")
    .eq("id", cardId)
    .maybeSingle();

  if (cardError) {
    throw new Error("CARD_LOOKUP_FAILED");
  }

  if (!card) {
    throw new Error("CARD_NOT_FOUND");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", card.board_id)
    .eq("profile_id", userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error("MEMBERSHIP_LOOKUP_FAILED");
  }

  if (!membership) {
    throw new Error("FORBIDDEN");
  }

  return {
    boardId: card.board_id,
    cardMeta: {
      title: card.title ?? null,
      short_id: card.short_id ?? null,
      slug: card.slug ?? null,
    },
  };
}

export function accessErrorResponse(reason: string, label: string): NextResponse {
  if (reason === "CARD_NOT_FOUND") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Card not found" } },
      { status: 404 }
    );
  }
  if (reason === "FORBIDDEN") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
      { status: 403 }
    );
  }
  console.error(`[${label}] access check failed`);
  return NextResponse.json(
    { error: { code: "DB_ERROR", message: "Failed to verify permissions" } },
    { status: 500 }
  );
}

export async function validateMentionsForBoard(
  supabase: SupabaseClient,
  boardId: string,
  mentions: string[]
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!mentions.length) return { ok: true };

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidUUIDs = mentions.filter((id) => !uuidRegex.test(id));

  if (invalidUUIDs.length > 0) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid mention UUID format",
          },
          issues: invalidUUIDs.map((id) => ({
            field: "mentions",
            message: `Invalid UUID: ${id}`,
          })),
        },
        { status: 400 }
      ),
    };
  }

  const { data: boardMembers, error: membersError } = await supabase
    .from("board_members")
    .select("profile_id")
    .eq("board_id", boardId);

  if (membersError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "DB_ERROR", message: "Failed to validate mentions" } },
        { status: 500 }
      ),
    };
  }

  const memberIds = new Set(boardMembers?.map((m) => m.profile_id) || []);
  const invalidMentions = mentions.filter((id) => !memberIds.has(id));

  if (invalidMentions.length > 0) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Some mentioned users are not board members",
          },
          issues: invalidMentions.map((id) => ({
            field: "mentions",
            message: `User ${id} is not a board member`,
          })),
        },
        { status: 400 }
      ),
    };
  }

  return { ok: true };
}

export async function resolveSenderName(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .single();

  return senderProfile?.full_name || senderProfile?.email || "Unknown";
}

export async function resolveNotificationBody(
  supabase: SupabaseClient,
  body: string,
  mentions: string[]
): Promise<string> {
  if (!mentions.length) return body;
  const { data: mentionProfiles, error: mentionProfilesError } = await supabase
    .from("profiles")
    .select("id, username, display_name, full_name, avatar_url, email")
    .in("id", mentions);

  if (mentionProfilesError) {
    console.warn("[comments:post] failed to load mention profiles");
    return body;
  }
  if (!mentionProfiles || mentionProfiles.length === 0) return body;
  const profilesById = new Map(mentionProfiles.map((p) => [p.id, p]));
  return replaceMentionsForNotification(body, profilesById);
}

export async function resolveReplyAuthorId(
  supabase: SupabaseClient,
  parentId: string | null,
  cardId: string
): Promise<string | null> {
  if (!parentId) return null;
  const { data: parentComment, error: parentError } = await supabase
    .from("comments")
    .select("author_id")
    .eq("id", parentId)
    .eq("card_id", cardId)
    .maybeSingle();

  if (parentError) {
    console.warn("[comments:post] failed to fetch parent comment author");
    return null;
  }
  return parentComment?.author_id ?? null;
}
