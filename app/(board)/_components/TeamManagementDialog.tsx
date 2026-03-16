"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TeamInvite, TeamRole, TeamView } from "@/lib/supabase";

type TeamMemberItem = {
  team_id: string;
  profile_id: string;
  role: TeamRole;
  created_at: string;
  profile: {
    id: string;
    email: string | null;
    display_name: string | null;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
  };
};

type TeamInviteItem = Pick<TeamInvite, "id" | "email" | "email_normalized" | "role" | "expires_at" | "accepted_at" | "revoked_at" | "created_at">;

type Props = {
  initialTeamId?: string | null;
};

type LatestInviteInfo = {
  token: string | null;
  url: string | null;
};

function buildInviteUrl(inviteUrl?: string | null, invitePath?: string | null): string | null {
  if (invitePath && typeof window !== "undefined") {
    return new URL(invitePath, window.location.origin).toString();
  }

  if (inviteUrl && inviteUrl.startsWith("/") && typeof window !== "undefined") {
    return new URL(inviteUrl, window.location.origin).toString();
  }

  return inviteUrl ?? null;
}

const ADMIN_ROLES: TeamRole[] = ["owner", "admin"];

function displayName(member: TeamMemberItem): string {
  return member.profile.display_name || member.profile.full_name || member.profile.username || member.profile.email || member.profile.id;
}

function getInitials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function canManageTeam(role: TeamRole | null): boolean {
  return role ? ADMIN_ROLES.includes(role) : false;
}

export default function TeamManagementDialog({ initialTeamId }: Props) {
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedTeam, setSelectedTeam] = useState<TeamView | null>(null);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [invites, setInvites] = useState<TeamInviteItem[]>([]);
  const [membersForbidden, setMembersForbidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [allowMemberCreateBoard, setAllowMemberCreateBoard] = useState(false);

  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamSlug, setNewTeamSlug] = useState("");
  const [newTeamAllowCreate, setNewTeamAllowCreate] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "guest">("member");
  const [latestInvite, setLatestInvite] = useState<LatestInviteInfo | null>(null);

  const actorRole = selectedTeam?.role ?? null;
  const isTeamAdmin = canManageTeam(actorRole);

  const resetNotice = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    resetNotice();
    try {
      const res = await fetch("/api/teams", { cache: "no-store" });
      const body = (await res.json()) as { teams?: TeamView[]; error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message || "Failed to load teams");
      }
      const nextTeams = body.teams || [];
      setTeams(nextTeams);
      setSelectedTeamId((currentSelectedTeamId) => {
        if (currentSelectedTeamId && nextTeams.some((team) => team.id === currentSelectedTeamId)) {
          return currentSelectedTeamId;
        }
        if (initialTeamId && nextTeams.some((team) => team.id === initialTeamId)) {
          return initialTeamId;
        }
        return nextTeams[0]?.id || "";
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [initialTeamId, resetNotice]);

  const fetchSelectedTeam = useCallback(async (teamId: string) => {
    if (!teamId) {
      setSelectedTeam(null);
      setMembers([]);
      setInvites([]);
      return;
    }

    resetNotice();
    setLoading(true);
    try {
      const detailRes = await fetch(`/api/teams/${teamId}`, { cache: "no-store" });
      const detailBody = (await detailRes.json()) as { team?: TeamView; error?: { message?: string } };
      if (!detailRes.ok || !detailBody.team) {
        throw new Error(detailBody.error?.message || "Failed to load team detail");
      }
      setSelectedTeam(detailBody.team);
      setName(detailBody.team.name);
      setSlug(detailBody.team.slug || "");
      setAllowMemberCreateBoard(Boolean(detailBody.team.allow_member_create_board));

      const membersRes = await fetch(`/api/teams/${teamId}/members`, { cache: "no-store" });
      if (membersRes.status === 403) {
        setMembersForbidden(true);
        setMembers([]);
      } else {
        const membersBody = (await membersRes.json()) as { members?: TeamMemberItem[]; error?: { message?: string } };
        if (!membersRes.ok) {
          throw new Error(membersBody.error?.message || "Failed to load team members");
        }
        setMembersForbidden(false);
        setMembers(membersBody.members || []);
      }

      const invitesRes = await fetch(`/api/teams/${teamId}/invites`, { cache: "no-store" });
      if (invitesRes.status === 403) {
        setInvites([]);
      } else {
        const invitesBody = (await invitesRes.json()) as { invites?: TeamInviteItem[]; error?: { message?: string } };
        if (!invitesRes.ok) {
          throw new Error(invitesBody.error?.message || "Failed to load team invites");
        }
        setInvites(invitesBody.invites || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, [resetNotice]);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  useEffect(() => {
    if (!selectedTeamId) return;
    void fetchSelectedTeam(selectedTeamId);
  }, [selectedTeamId, fetchSelectedTeam]);

  const pendingInvites = useMemo(
    () => invites.filter((invite) => !invite.accepted_at && !invite.revoked_at),
    [invites]
  );

  const orderedTeams = useMemo(() => {
    const priorityTeamId = initialTeamId ?? "";
    return [...teams].sort((a, b) => {
      if (a.id === priorityTeamId && b.id !== priorityTeamId) return -1;
      if (b.id === priorityTeamId && a.id !== priorityTeamId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [initialTeamId, teams]);

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return;
    setSaving(true);
    resetNotice();
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTeamName.trim(),
          slug: newTeamSlug.trim() || undefined,
          allow_member_create_board: newTeamAllowCreate,
        }),
      });
      const body = (await res.json()) as { team?: TeamView; error?: { message?: string } };
      if (!res.ok || !body.team) {
        throw new Error(body.error?.message || "Failed to create team");
      }
      setMessage("Team created");
      setNewTeamName("");
      setNewTeamSlug("");
      setNewTeamAllowCreate(false);
      await fetchTeams();
      setSelectedTeamId(body.team.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create team");
    } finally {
      setSaving(false);
    }
  }, [fetchTeams, newTeamAllowCreate, newTeamName, newTeamSlug, resetNotice]);

  const handleSaveTeamSettings = useCallback(async () => {
    if (!selectedTeamId) return;
    setSaving(true);
    resetNotice();
    try {
      const res = await fetch(`/api/teams/${selectedTeamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          allow_member_create_board: allowMemberCreateBoard,
        }),
      });
      const body = (await res.json()) as { team?: TeamView; error?: { message?: string } };
      if (!res.ok || !body.team) {
        throw new Error(body.error?.message || "Failed to update team");
      }
      setMessage("Team settings updated");
      await fetchTeams();
      await fetchSelectedTeam(selectedTeamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update team");
    } finally {
      setSaving(false);
    }
  }, [allowMemberCreateBoard, fetchSelectedTeam, fetchTeams, name, resetNotice, selectedTeamId, slug]);

  const handleChangeMemberRole = useCallback(async (profileId: string, role: TeamRole) => {
    if (!selectedTeamId) return;
    setSaving(true);
    resetNotice();
    try {
      const res = await fetch(`/api/teams/${selectedTeamId}/members/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message || "Failed to update member role");
      }
      setMessage("Member role updated");
      await fetchSelectedTeam(selectedTeamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update member role");
    } finally {
      setSaving(false);
    }
  }, [fetchSelectedTeam, resetNotice, selectedTeamId]);

  const handleRemoveMember = useCallback(async (profileId: string) => {
    if (!selectedTeamId) return;
    setSaving(true);
    resetNotice();
    try {
      const res = await fetch(`/api/teams/${selectedTeamId}/members/${profileId}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message || "Failed to remove member");
      }
      setMessage("Member removed");
      await fetchSelectedTeam(selectedTeamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member");
    } finally {
      setSaving(false);
    }
  }, [fetchSelectedTeam, resetNotice, selectedTeamId]);

  const createOrRefreshInvite = useCallback(async (
    email: string,
    role: "admin" | "member" | "guest",
    successMessage: string
  ) => {
    if (!selectedTeamId) return;

    const res = await fetch(`/api/teams/${selectedTeamId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        role,
      }),
    });
    const body = (await res.json()) as {
      invite_token?: string;
      invite_url?: string;
      invite_path?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(body.error?.message || "Failed to create invite");
    }

    setLatestInvite({
      token: body.invite_token || null,
      url: buildInviteUrl(body.invite_url, body.invite_path),
    });
    setMessage(successMessage);
    await fetchSelectedTeam(selectedTeamId);
  }, [fetchSelectedTeam, selectedTeamId]);

  const handleCreateInvite = useCallback(async () => {
    if (!selectedTeamId || !inviteEmail.trim()) return;
    setSaving(true);
    resetNotice();
    try {
      await createOrRefreshInvite(inviteEmail.trim(), inviteRole, "Invite created");
      setInviteEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setSaving(false);
    }
  }, [createOrRefreshInvite, inviteEmail, inviteRole, resetNotice, selectedTeamId]);

  const handleReissueInvite = useCallback(async (invite: TeamInviteItem) => {
    setSaving(true);
    resetNotice();
    try {
      await createOrRefreshInvite(
        invite.email,
        invite.role,
        "Invite link reissued"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reissue invite");
    } finally {
      setSaving(false);
    }
  }, [createOrRefreshInvite, resetNotice]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!latestInvite?.url) return;

    try {
      await navigator.clipboard.writeText(latestInvite.url);
      setMessage("Invite link copied");
      setError(null);
    } catch {
      setError("Failed to copy invite link");
    }
  }, [latestInvite?.url]);

  const handleRevokeInvite = useCallback(async (inviteId: string) => {
    if (!selectedTeamId) return;
    setSaving(true);
    resetNotice();
    try {
      const res = await fetch(`/api/teams/${selectedTeamId}/invites/${inviteId}/revoke`, { method: "POST" });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message || "Failed to revoke invite");
      }
      setMessage("Invite revoked");
      await fetchSelectedTeam(selectedTeamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke invite");
    } finally {
      setSaving(false);
    }
  }, [fetchSelectedTeam, resetNotice, selectedTeamId]);

  return (
    <div className="grid gap-4 md:grid-cols-[260px,1fr]">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <h3 className="text-sm font-semibold text-slate-800">Teams</h3>
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {orderedTeams.map((team) => (
            <button
              key={team.id}
              onClick={() => setSelectedTeamId(team.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                team.id === selectedTeamId ? "bg-sky-100 text-sky-900" : "bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{team.name}</div>
                  <div className="text-xs text-slate-500">{team.role}</div>
                </div>
                {team.id === initialTeamId ? (
                  <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                    Current
                  </span>
                ) : null}
              </div>
            </button>
          ))}
          {teams.length === 0 && <p className="text-xs text-slate-500">No teams</p>}
        </div>

        <div className="space-y-2 border-t border-slate-200 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Create Team</p>
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Team name"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={newTeamSlug}
            onChange={(e) => setNewTeamSlug(e.target.value)}
            placeholder="Slug (optional)"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={newTeamAllowCreate}
              onChange={(e) => setNewTeamAllowCreate(e.target.checked)}
            />
            members can create boards
          </label>
          <button
            onClick={handleCreateTeam}
            disabled={saving || !newTeamName.trim()}
            className="w-full rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Create Team
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">Team Settings</h3>
        {loading && <p className="text-sm text-slate-500">Loading...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}

        {selectedTeam ? (
          <>
            <div className="border-t border-slate-200 pt-4">
              <h4 className="mb-2 text-sm font-semibold text-slate-800">Members</h4>
              {membersForbidden ? (
                <p className="text-sm text-slate-500">Guest role cannot view team members.</p>
              ) : (
                <div className="space-y-2">
                  {members.map((member) => (
                    <div key={member.profile_id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
                        {getInitials(displayName(member))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{displayName(member)}</p>
                        <p className="truncate text-xs text-slate-500">{member.profile.email || member.profile_id}</p>
                      </div>
                      <select
                        value={member.role}
                        onChange={(e) => void handleChangeMemberRole(member.profile_id, e.target.value as TeamRole)}
                        disabled={!isTeamAdmin || saving}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="owner">owner</option>
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="guest">guest</option>
                      </select>
                      <button
                        onClick={() => void handleRemoveMember(member.profile_id)}
                        disabled={!isTeamAdmin || saving}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {members.length === 0 && <p className="text-sm text-slate-500">No members.</p>}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="mb-2 text-sm font-semibold text-slate-800">Invites</h4>
              <div className="mb-3 grid gap-2 md:grid-cols-[1fr,120px,auto]">
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                  disabled={!isTeamAdmin || saving}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member" | "guest")}
                  disabled={!isTeamAdmin || saving}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="guest">guest</option>
                </select>
                <button
                  onClick={handleCreateInvite}
                  disabled={!isTeamAdmin || saving || !inviteEmail.trim()}
                  className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Invite
                </button>
              </div>

              {latestInvite?.url && (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-medium">Invite link</p>
                  <p className="mt-1 break-all">{latestInvite.url}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyInviteLink()}
                      className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-amber-900"
                    >
                      Copy link
                    </button>
                    {latestInvite.token && (
                      <details className="text-amber-900">
                        <summary className="cursor-pointer font-medium">Token</summary>
                        <p className="mt-1 break-all">{latestInvite.token}</p>
                      </details>
                    )}
                  </div>
                </div>
              )}

              <p className="mb-3 text-xs text-slate-500">
                セキュリティ上、発行済みリンクは一覧から再表示できません。再度共有する場合は pending invite の「Reissue link」を使って新しいリンクを発行してください。
              </p>

              <div className="space-y-2">
                {pendingInvites.map((invite) => (
                  <div key={invite.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">{invite.email}</p>
                      <p className="text-xs text-slate-500">role={invite.role} / expires={new Date(invite.expires_at).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleReissueInvite(invite)}
                        disabled={!isTeamAdmin || saving}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                      >
                        Reissue link
                      </button>
                      <button
                        onClick={() => void handleRevokeInvite(invite.id)}
                        disabled={!isTeamAdmin || saving}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
                {pendingInvites.length === 0 && <p className="text-sm text-slate-500">No pending invites.</p>}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="mb-3 text-sm font-semibold text-slate-800">Team Options</h4>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    disabled={!isTeamAdmin || saving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Slug</label>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    disabled={!isTeamAdmin || saving}
                  />
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={allowMemberCreateBoard}
                  onChange={(e) => setAllowMemberCreateBoard(e.target.checked)}
                  disabled={!isTeamAdmin || saving}
                />
                members can create boards
              </label>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleSaveTeamSettings}
                  disabled={!isTeamAdmin || saving}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Save Team Settings
                </button>
              </div>
            </div>
          </>
        ) : (
          !loading && <p className="text-sm text-slate-500">Select a team.</p>
        )}
      </section>
    </div>
  );
}
