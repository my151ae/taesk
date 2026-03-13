'use client';

import { useEffect, useMemo, useState } from 'react';

import { featureFlags } from '@/lib/featureFlags';
import { type BoardInvite, type MemberRole, type ProfileSummary } from '@/lib/supabase';
import { getProfileInitial, resolveProfileIdentity } from '@/lib/usernames';

type BoardMemberWithProfile = {
  board_id: string;
  profile_id: string;
  role: MemberRole;
  created_at: string;
  profile: ProfileSummary;
};

type BoardInviteItem = Pick<
  BoardInvite,
  'id' | 'email' | 'email_normalized' | 'role' | 'expires_at' | 'accepted_at' | 'revoked_at' | 'created_at'
>;

type Props = {
  boardId: string;
  canManage: boolean;
  onUpdated?: () => void | Promise<void>;
};

type Notice = {
  type: 'success' | 'error';
  message: string;
} | null;

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export default function BoardAccessSettings({ boardId, canManage, onUpdated }: Props) {
  const [members, setMembers] = useState<BoardMemberWithProfile[]>([]);
  const [invites, setInvites] = useState<BoardInviteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [memberRole, setMemberRole] = useState<MemberRole>('editor');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<MemberRole, 'owner'>>('editor');
  const [invitingMember, setInvitingMember] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  const pendingInvites = useMemo(
    () => invites.filter((invite) => !invite.accepted_at && !invite.revoked_at),
    [invites]
  );

  useEffect(() => {
    if (!featureFlags.boardPermissions) {
      return;
    }

    void Promise.all([loadMembers(), loadInvites()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, canManage]);

  const readErrorMessage = async (response: Response, fallbackMessage: string): Promise<string> => {
    try {
      const body = await response.json() as { error?: string | { message?: string } };
      if (typeof body.error === 'string' && body.error.trim()) {
        return body.error;
      }
      if (body.error && typeof body.error === 'object' && body.error.message) {
        return body.error.message;
      }
    } catch {
      // ignore parse errors
    }
    return fallbackMessage;
  };

  const notifyUpdated = async () => {
    if (onUpdated) {
      await onUpdated();
    }
  };

  const loadMembers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/boards/${boardId}/members`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load board members'));
      }
      const { members: fetchedMembers } = await response.json();
      setMembers(fetchedMembers ?? []);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load board members',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadInvites = async () => {
    setLoadingInvites(true);
    try {
      const response = await fetch(`/api/boards/${boardId}/invites`, { cache: 'no-store' });
      if (response.status === 403) {
        setInvites([]);
        return;
      }
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load board invites'));
      }
      const { invites: fetchedInvites } = await response.json();
      setInvites(fetchedInvites ?? []);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load board invites',
      });
    } finally {
      setLoadingInvites(false);
    }
  };

  const handleMemberAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const rawInput = inviteIdentifier.trim();
    if (!rawInput || !canManage) return;

    const isEmail = rawInput.includes('@') && !rawInput.startsWith('@');
    const params = new URLSearchParams();
    if (isEmail) {
      params.set('email', rawInput.toLowerCase());
    } else {
      params.set('query', rawInput.startsWith('@') ? rawInput.slice(1) : rawInput);
    }
    params.set('board_id', boardId);

    setInvitingMember(true);
    setNotice(null);
    try {
      const searchRes = await fetch(`/api/profiles/search?${params.toString()}`);
      if (!searchRes.ok) {
        throw new Error(await readErrorMessage(searchRes, 'ユーザー検索に失敗しました'));
      }

      const payload = await searchRes.json().catch(() => null);
      const profile = payload?.profile ?? payload?.profiles?.[0];
      if (!profile) {
        throw new Error('一致するユーザーが見つかりませんでした。');
      }

      if (members.some((member) => member.profile_id === profile.id)) {
        throw new Error('そのユーザーは既にこのボードのメンバーです。');
      }

      const response = await fetch(`/api/boards/${boardId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profile.id,
          role: memberRole,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'メンバー追加に失敗しました'));
      }

      setInviteIdentifier('');
      setMemberRole('editor');
      setNotice({ type: 'success', message: 'ボードメンバーを追加しました。' });
      await Promise.all([loadMembers(), notifyUpdated()]);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'メンバー追加に失敗しました',
      });
    } finally {
      setInvitingMember(false);
    }
  };

  const handleRoleChange = async (profileId: string, role: MemberRole) => {
    if (!canManage) return;
    setNotice(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/members/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '権限変更に失敗しました'));
      }
      setMembers((current) => current.map((member) => (
        member.profile_id === profileId ? { ...member, role } : member
      )));
      setNotice({ type: 'success', message: 'ボードメンバー権限を更新しました。' });
      await notifyUpdated();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : '権限変更に失敗しました',
      });
    }
  };

  const handleRemoveMember = async (profileId: string) => {
    if (!canManage) return;
    if (!confirm('このメンバーをボードから外しますか？')) return;

    setNotice(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/members/${profileId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'メンバー削除に失敗しました'));
      }
      setMembers((current) => current.filter((member) => member.profile_id !== profileId));
      setNotice({ type: 'success', message: 'ボードメンバーを削除しました。' });
      await notifyUpdated();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'メンバー削除に失敗しました',
      });
    }
  };

  const handleCreateInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || !inviteEmail.trim()) return;

    setCreatingInvite(true);
    setNotice(null);
    setInviteToken(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof body?.error === 'object' && body?.error?.message
            ? body.error.message
            : typeof body?.error === 'string'
              ? body.error
              : '招待の作成に失敗しました'
        );
      }

      setInviteEmail('');
      setInviteRole('editor');
      setInviteToken(typeof body?.invite_token === 'string' ? body.invite_token : null);
      setNotice({ type: 'success', message: '招待を作成しました。' });
      await loadInvites();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : '招待の作成に失敗しました',
      });
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!canManage) return;

    setRevokingInviteId(inviteId);
    setNotice(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/invites/${inviteId}/revoke`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '招待の取り消しに失敗しました'));
      }
      setNotice({ type: 'success', message: '招待を取り消しました。' });
      await loadInvites();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : '招待の取り消しに失敗しました',
      });
    } finally {
      setRevokingInviteId(null);
    }
  };

  if (!featureFlags.boardPermissions) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Board Access</h3>
        <p className="text-xs text-slate-500">
          {canManage
            ? 'このボードのメンバー管理とメール招待を行います。'
            : 'このボードのアクセス状況です。管理はボード owner のみ可能です。'}
        </p>
      </div>

      {notice && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${notice.type === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-rose-200 bg-rose-50 text-rose-700'
        }`}>
          {notice.message}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Members</h4>
            <p className="text-xs text-slate-500">現在このボードにアクセスできるユーザーです。</p>
          </div>

          {canManage && (
            <form onSubmit={handleMemberAdd} className="space-y-2 rounded-lg bg-slate-50 p-3">
              <input
                type="text"
                value={inviteIdentifier}
                onChange={(event) => setInviteIdentifier(event.target.value)}
                placeholder="メールアドレス または @username"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                disabled={invitingMember}
              />
              <div className="flex gap-2">
                <select
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.target.value as MemberRole)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  disabled={invitingMember}
                >
                  <option value="editor">Editor</option>
                  <option value="commenter">Commenter</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="submit"
                  disabled={invitingMember || !inviteIdentifier.trim()}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {invitingMember ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              Loading members...
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => {
                const identity = resolveProfileIdentity(member.profile, member.profile?.email ?? null);
                const secondary = identity.secondary && identity.secondary !== identity.label
                  ? identity.secondary
                  : member.profile.email;

                return (
                  <div
                    key={member.profile_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700">
                        {getProfileInitial(member.profile, member.profile?.email ?? null)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{identity.label}</div>
                        {secondary && (
                          <div className="truncate text-xs text-slate-500">{secondary}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={member.role}
                        onChange={(event) => handleRoleChange(member.profile_id, event.target.value as MemberRole)}
                        disabled={!canManage || member.role === 'owner'}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      {canManage && member.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member.profile_id)}
                          className="rounded-lg px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {members.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  No members yet
                </div>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Invites</h4>
            <p className="text-xs text-slate-500">メール招待の発行と pending invite の管理です。</p>
          </div>

          {canManage && (
            <form onSubmit={handleCreateInvite} className="space-y-2 rounded-lg bg-slate-50 p-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="invite@example.com"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                disabled={creatingInvite}
              />
              <div className="flex gap-2">
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as Exclude<MemberRole, 'owner'>)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  disabled={creatingInvite}
                >
                  <option value="editor">Editor</option>
                  <option value="commenter">Commenter</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="submit"
                  disabled={creatingInvite || !inviteEmail.trim()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {creatingInvite ? 'Sending...' : 'Create Invite'}
                </button>
              </div>
            </form>
          )}

          {inviteToken && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest invite token</div>
              <div className="mt-1 break-all font-mono text-xs text-slate-700">{inviteToken}</div>
            </div>
          )}

          {loadingInvites ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              Loading invites...
            </div>
          ) : (
            <div className="space-y-2">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{invite.email}</div>
                    <div className="text-xs text-slate-500">
                      {ROLE_LABELS[invite.role]} • expires {new Date(invite.expires_at).toLocaleString()}
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(invite.id)}
                      disabled={revokingInviteId === invite.id}
                      className="rounded-lg px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {revokingInviteId === invite.id ? 'Revoking...' : 'Revoke'}
                    </button>
                  )}
                </div>
              ))}
              {pendingInvites.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  No pending invites
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
