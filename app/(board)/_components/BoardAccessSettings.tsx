'use client';

import { useEffect, useState } from 'react';

import { featureFlags } from '@/lib/featureFlags';
import { type MemberRole, type ProfileSummary } from '@/lib/supabase';
import { getProfileInitial, resolveProfileIdentity } from '@/lib/usernames';

type BoardMemberWithProfile = {
  board_id: string;
  profile_id: string;
  role: MemberRole;
  created_at: string;
  profile: ProfileSummary;
};

type AvailableTeamMember = {
  profile_id: string;
  role: string;
  created_at: string;
  profile: ProfileSummary;
};

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
  const [availableMembers, setAvailableMembers] = useState<AvailableTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [memberRole, setMemberRole] = useState<MemberRole>('editor');
  const [invitingMember, setInvitingMember] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!featureFlags.boardPermissions) {
      return;
    }

    void loadMembers();
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
      const { members: fetchedMembers, available_members: fetchedAvailableMembers } = await response.json();
      setMembers(fetchedMembers ?? []);
      setAvailableMembers(fetchedAvailableMembers ?? []);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load board members',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMemberAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProfileId || !canManage) return;

    setInvitingMember(true);
    setNotice(null);
    try {
      if (members.some((member) => member.profile_id === selectedProfileId)) {
        throw new Error('そのユーザーは既にこのボードのメンバーです。');
      }

      const response = await fetch(`/api/boards/${boardId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: selectedProfileId,
          role: memberRole,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'メンバー追加に失敗しました'));
      }

      setSelectedProfileId('');
      setMemberRole('editor');
      setNotice({ type: 'success', message: 'Team メンバーに Board access を付与しました。' });
      await Promise.all([loadMembers(), notifyUpdated()]);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Board access の付与に失敗しました',
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
      setNotice({ type: 'success', message: 'Board access 権限を更新しました。' });
      await notifyUpdated();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Board access 権限の更新に失敗しました',
      });
    }
  };

  const handleRemoveMember = async (profileId: string) => {
    if (!canManage) return;
    if (!confirm('この Team メンバーの Board access を外しますか？')) return;

    setNotice(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/members/${profileId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'メンバー削除に失敗しました'));
      }
      setMembers((current) => current.filter((member) => member.profile_id !== profileId));
      setNotice({ type: 'success', message: 'Board access を削除しました。' });
      await notifyUpdated();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Board access の削除に失敗しました',
      });
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
            ? 'この Board にアクセスできる Team メンバーを管理します。'
            : 'この Board のアクセス状況です。管理は board owner のみ可能です。'}
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

      <div className="space-y-6">
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Members</h4>
              <p className="text-xs text-slate-500">現在この Board にアクセスできる Team メンバーです。</p>
            </div>
            {!loading && (
              <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                {members.length} members
              </span>
            )}
          </div>

          {canManage && (
            <form onSubmit={handleMemberAdd} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <select
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                disabled={invitingMember}
              >
                <option value="">Board に追加する Team メンバーを選択</option>
                {availableMembers.map((member) => {
                  const identity = resolveProfileIdentity(member.profile, member.profile.email ?? null);
                  const detail = identity.secondary && identity.secondary !== identity.label
                    ? ` (${identity.secondary})`
                    : '';
                  return (
                    <option key={member.profile_id} value={member.profile_id}>
                      {identity.label}{detail}
                    </option>
                  );
                })}
              </select>
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
                  disabled={invitingMember || !selectedProfileId}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {invitingMember ? 'Adding...' : 'Grant Access'}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                まだこの Board に追加されていない Team メンバーだけを選べます。
              </p>
            </form>
          )}

          {loading ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              Loading members...
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <div className="space-y-2">
              {members.map((member) => {
                const identity = resolveProfileIdentity(member.profile, member.profile?.email ?? null);
                const secondary = identity.secondary && identity.secondary !== identity.label
                  ? identity.secondary
                  : member.profile.email;

                return (
                  <div
                    key={member.profile_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700">
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
            </div>
          )}
        </section>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        外部メールアドレスの招待は Team Settings から行ってください。Board Settings では Team メンバーへの Board access 付与だけを扱います。
      </div>
    </div>
  );
}
