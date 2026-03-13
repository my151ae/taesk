import "server-only";

import type { User } from "@supabase/supabase-js";

import { generateShortId } from "@/lib/card-utils";
import { toSlugBase } from "@/lib/slug";
import { createServiceRoleSupabaseClient } from "@/lib/server/supabaseAdmin";

type EnsureResult = {
  teamId: string;
  boardId: string;
};

function deriveDisplayName(user: User): string {
  const metadataName =
    (typeof user.user_metadata?.display_name === "string" && user.user_metadata.display_name.trim()) ||
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim());

  if (metadataName) {
    return metadataName;
  }

  const emailLocalPart = user.email?.split("@")[0]?.trim();
  if (emailLocalPart) {
    return emailLocalPart;
  }

  return "My";
}

function buildPersonalTeamName(user: User): string {
  return `${deriveDisplayName(user)} Team`;
}

function buildPersonalBoardName(user: User): string {
  return `${deriveDisplayName(user)} Board`;
}

async function ensureProfile(user: User) {
  const admin = createServiceRoleSupabaseClient();
  const payload = {
    id: user.id,
    email: user.email ?? null,
    full_name:
      (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
      (typeof user.user_metadata?.display_name === "string" && user.user_metadata.display_name.trim()) ||
      "",
    avatar_url:
      (typeof user.user_metadata?.avatar_url === "string" && user.user_metadata.avatar_url) || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("profiles").upsert(payload, { onConflict: "id" });
  if (error) {
    throw new Error(`Failed to ensure profile: ${error.message}`);
  }
}

async function ensureUniqueTeamSlug(baseName: string, profileId: string): Promise<string> {
  const admin = createServiceRoleSupabaseClient();
  const baseSlug = toSlugBase(baseName) || `team-${profileId.slice(0, 8)}`;
  let candidate = baseSlug;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { data, error } = await admin
      .from("teams")
      .select("id")
      .eq("slug", candidate)
      .limit(1);

    if (error) {
      throw new Error(`Failed to check team slug: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return candidate;
    }

    candidate = `${baseSlug}-${attempt + 2}`;
  }

  throw new Error("Failed to generate default team slug");
}

async function ensureUniqueBoardShortId(): Promise<string> {
  const admin = createServiceRoleSupabaseClient();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const shortId = generateShortId();
    const { data, error } = await admin
      .from("boards")
      .select("id")
      .eq("short_id", shortId)
      .limit(1);

    if (error) {
      throw new Error(`Failed to check board short_id: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return shortId;
    }
  }

  throw new Error("Failed to generate personal board short_id");
}

async function getNextBoardIdShort(): Promise<number> {
  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("boards")
    .select("id_short")
    .order("id_short", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to resolve next board id_short: ${error.message}`);
  }

  const current = data?.[0]?.id_short;
  return typeof current === "number" ? current + 1 : 1;
}

async function ensurePersonalTeam(user: User): Promise<string> {
  const admin = createServiceRoleSupabaseClient();

  const { data: existing, error: lookupError } = await admin
    .from("teams")
    .select("id")
    .eq("personal_for_profile_id", user.id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to lookup default team: ${lookupError.message}`);
  }

  if (existing?.id) {
    return existing.id;
  }

  const slug = await ensureUniqueTeamSlug(buildPersonalTeamName(user), user.id);
  const { data: created, error: createError } = await admin
    .from("teams")
    .insert({
      name: buildPersonalTeamName(user),
      slug,
      team_type: "personal",
      allow_member_create_board: true,
      personal_for_profile_id: user.id,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (createError || !created?.id) {
    if (createError?.code === "23505") {
      const { data: raced } = await admin
        .from("teams")
        .select("id")
        .eq("personal_for_profile_id", user.id)
        .maybeSingle();
      if (raced?.id) {
        return raced.id;
      }
    }
    throw new Error(`Failed to create default team: ${createError?.message ?? "unknown error"}`);
  }

  return created.id;
}

async function ensurePersonalTeamOwner(teamId: string, profileId: string) {
  const admin = createServiceRoleSupabaseClient();
  const { error } = await admin
    .from("team_members")
    .upsert(
      {
        team_id: teamId,
        profile_id: profileId,
        role: "owner",
      },
      { onConflict: "team_id,profile_id", ignoreDuplicates: false }
    );

  if (error) {
    throw new Error(`Failed to ensure default team owner: ${error.message}`);
  }
}

async function ensurePersonalBoard(teamId: string, user: User): Promise<string> {
  const admin = createServiceRoleSupabaseClient();

  const { data: existing, error: lookupError } = await admin
    .from("boards")
    .select("id")
    .eq("team_id", teamId)
    .eq("is_personal", true)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to lookup personal board: ${lookupError.message}`);
  }

  if (existing?.id) {
    return existing.id;
  }

  const shortId = await ensureUniqueBoardShortId();
  const idShort = await getNextBoardIdShort();
  const name = buildPersonalBoardName(user);
  const { data: created, error: createError } = await admin
    .from("boards")
    .insert({
      team_id: teamId,
      name,
      user_id: user.id,
      short_id: shortId,
      id_short: idShort,
      slug: toSlugBase(name),
      is_personal: true,
    })
    .select("id")
    .single();

  if (createError || !created?.id) {
    if (createError?.code === "23505") {
      const { data: raced } = await admin
        .from("boards")
        .select("id")
        .eq("team_id", teamId)
        .eq("is_personal", true)
        .maybeSingle();
      if (raced?.id) {
        return raced.id;
      }
    }
    throw new Error(`Failed to create personal board: ${createError?.message ?? "unknown error"}`);
  }

  return created.id;
}

async function ensurePersonalBoardOwner(boardId: string, profileId: string) {
  const admin = createServiceRoleSupabaseClient();
  const { error } = await admin
    .from("board_members")
    .upsert(
      {
        board_id: boardId,
        profile_id: profileId,
        role: "owner",
      },
      { onConflict: "board_id,profile_id", ignoreDuplicates: false }
    );

  if (error) {
    throw new Error(`Failed to ensure personal board owner: ${error.message}`);
  }
}

export async function ensureDefaultTeamAndBoard(user: User): Promise<EnsureResult> {
  await ensureProfile(user);

  const teamId = await ensurePersonalTeam(user);
  await ensurePersonalTeamOwner(teamId, user.id);

  const boardId = await ensurePersonalBoard(teamId, user);
  await ensurePersonalBoardOwner(boardId, user.id);

  return { teamId, boardId };
}

export async function ensurePersonalWorkspaceAndBoard(user: User): Promise<EnsureResult> {
  return ensureDefaultTeamAndBoard(user);
}
