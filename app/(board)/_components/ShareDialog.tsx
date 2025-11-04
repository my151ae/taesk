'use client';

import { useState, useEffect } from 'react';
import { featureFlags } from '@/lib/featureFlags';
import { MemberRole, ProfileSummary } from '@/lib/supabase';
import { resolveProfileIdentity, getProfileInitial } from '@/lib/usernames';

interface ShareDialogProps {
  boardId: string;
  onClose: () => void;
  onMemberAdded?: () => void | Promise<void>;
}

interface BoardMemberWithProfile {
  board_id: string;
  profile_id: string;
  role: MemberRole;
  created_at: string;
  profile: ProfileSummary;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export default function ShareDialog({ boardId, onClose, onMemberAdded }: ShareDialogProps) {
  const [members, setMembers] = useState<BoardMemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('editor');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (featureFlags.boardPermissions) {
      loadMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/boards/${boardId}/members`);
      if (response.ok) {
        const { members: fetchedMembers } = await response.json();
        setMembers(fetchedMembers);
      }
    } catch (error) {
      console.error('Error loading members:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = inviteIdentifier.trim();
    if (!rawInput) return;

    const isEmail = rawInput.includes('@') && !rawInput.startsWith('@');
    const params = new URLSearchParams();

    if (isEmail) {
      params.set('email', rawInput.toLowerCase());
    } else {
      const queryValue = rawInput.startsWith('@') ? rawInput.slice(1) : rawInput;
      params.set('query', queryValue);
    }

    setInviting(true);
    try {
      // 1. Search for existing user via identifier
      const searchRes = await fetch(`/api/profiles/search?${params.toString()}`);

      if (!searchRes.ok) {
        if (searchRes.status === 404) {
          alert('一致するユーザーが見つかりませんでした。入力したメールアドレスまたはユーザー名を確認してください。');
        } else {
          alert('ユーザー検索に失敗しました');
        }
        return;
      }

      const payload = await searchRes.json().catch(() => null);
      const profile = payload?.profile ?? payload?.profiles?.[0];

      if (!profile) {
        alert('一致するユーザーが見つかりませんでした。');
        return;
      }

      const identity = resolveProfileIdentity(profile, profile.email);

      // 2. Check if already a member
      if (members.some((m) => m.profile_id === profile.id)) {
        alert(`${identity.label} は既にメンバーです。`);
        return;
      }

      // 3. Add as board member
      const addRes = await fetch(`/api/boards/${boardId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profile.id,
          role: inviteRole,
        }),
      });

      if (!addRes.ok) {
        alert('メンバー追加に失敗しました');
        return;
      }

      // 4. Success - reload members and reset form
      alert(`${identity.label} をボードに追加しました！`);
      setInviteIdentifier('');
      setInviteRole('editor');
      await loadMembers();

      // 5. Notify parent to reload board members
      if (onMemberAdded) {
        await onMemberAdded();
      }
    } catch (error) {
      console.error('Error inviting member:', error);
      alert('メンバー追加に失敗しました');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (profileId: string, newRole: MemberRole) => {
    try {
      const response = await fetch(`/api/boards/${boardId}/members/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (response.ok) {
        setMembers(
          members.map((m) =>
            m.profile_id === profileId ? { ...m, role: newRole } : m
          )
        );
      } else {
        alert('Failed to update role');
      }
    } catch (error) {
      console.error('Error updating role:', error);
      alert('Failed to update role');
    }
  };

  const handleRemove = async (profileId: string) => {
    if (!confirm('Remove this member from the board?')) return;

    try {
      const response = await fetch(`/api/boards/${boardId}/members/${profileId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setMembers(members.filter((m) => m.profile_id !== profileId));
      } else {
        alert('Failed to remove member');
      }
    } catch (error) {
      console.error('Error removing member:', error);
      alert('Failed to remove member');
    }
  };

  if (!featureFlags.boardPermissions) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-labelledby="share-dialog-title" className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 id="share-dialog-title" className="text-xl font-semibold">Share Board</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6">
          {/* Invite new member */}
          <div>
            <h3 className="text-sm font-medium mb-2">メンバーを追加</h3>
            <form onSubmit={handleInvite} className="flex gap-2">
              <input
                type="text"
                value={inviteIdentifier}
                onChange={(e) => setInviteIdentifier(e.target.value)}
                placeholder="メールアドレス または @username"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={inviting}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as MemberRole)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={inviting}
              >
                <option value="editor">Editor</option>
                <option value="commenter">Commenter</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteIdentifier.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                追加
              </button>
            </form>
          </div>

          {/* Member list */}
          <div>
            <h3 className="text-sm font-medium mb-2">Members ({members.length})</h3>
            {loading ? (
              <div className="text-center py-4 text-gray-500">Loading...</div>
            ) : members.length === 0 ? (
              <div className="text-center py-4 text-gray-500">No members yet</div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => {
                  const identity = resolveProfileIdentity(member.profile, member.profile?.email ?? null);
                  const avatarInitial = getProfileInitial(member.profile, member.profile?.email ?? null);
                  const secondaryCandidate = identity.secondary && identity.secondary !== identity.label
                    ? identity.secondary
                    : (member.profile?.email && member.profile.email !== identity.label ? member.profile.email : null);

                  return (
                    <div
                      key={member.profile_id}
                      className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-medium">
                          {avatarInitial}
                        </div>
                        <div>
                          <div className="font-medium">{identity.label}</div>
                          {secondaryCandidate && (
                            <div className="text-sm text-gray-500 dark:text-gray-400">{secondaryCandidate}</div>
                          )}
                        </div>
                      </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.profile_id, e.target.value as MemberRole)}
                        className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={member.role === 'owner'}
                      >
                        <option value="owner">Owner</option>
                        <option value="editor">Editor</option>
                        <option value="commenter">Commenter</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      {member.role !== 'owner' && (
                        <button
                          onClick={() => handleRemove(member.profile_id)}
                          className="px-3 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-sm"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
