import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient, type MemberRole } from "@/lib/supabase";
import {
  getBoardMembership,
  hasAnyRole,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from "@/lib/server/api-security";

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type AuthorizedBoardMutation = {
  supabase: ServerSupabaseClient;
  user: User;
  role: MemberRole;
};

type AuthorizeBoardMutationResult =
  | { ok: true; data: AuthorizedBoardMutation }
  | { ok: false; response: NextResponse };

export async function authorizeBoardMutation(
  request: NextRequest,
  boardId: string,
  allowedRoles: MemberRole[] = ["owner", "editor"]
): Promise<AuthorizeBoardMutationResult> {
  const originError = validateMutationRequestOrigin(request);
  if (originError) {
    return { ok: false, response: originError };
  }

  const supabase = await createServerSupabaseClient();
  const { user, errorResponse } = await requireAuthenticatedUser(supabase);
  if (errorResponse || !user) {
    return {
      ok: false,
      response:
        errorResponse ??
        NextResponse.json(
          { error: { code: "UNAUTHENTICATED", message: "Login required" } },
          { status: 401 }
        ),
    };
  }

  const membership = await getBoardMembership(supabase, boardId, user.id);
  if (!membership || !hasAnyRole(membership.role, allowedRoles)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    data: {
      supabase,
      user,
      role: membership.role,
    },
  };
}
