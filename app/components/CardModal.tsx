"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { Card, Board, Priority, ProfileSummary } from "@/lib/supabase";
import CommentsPanel from "@/app/(board)/_components/CommentsPanel";

const getProfileDisplayName = (profile: ProfileSummary): string => {
  if (profile.full_name && profile.full_name.trim().length > 0) {
    return profile.full_name.trim();
  }
  if (profile.email) {
    return profile.email;
  }
  return 'Unknown user';
};

const getProfileInitials = (profile: ProfileSummary): string => {
  const source = profile.full_name && profile.full_name.trim().length > 0 ? profile.full_name : profile.email ?? '';
  if (!source) return '?';

  const words = source
    .replace(/[^\p{L}\p{N}\s@.]/gu, ' ')
    .trim()
    .split(/\s+|@|\.|_/)
    .filter(Boolean);

  if (words.length === 0) return source.slice(0, 1).toUpperCase();

  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

  return initials || source.slice(0, 1).toUpperCase();
};

interface CardModalProps {
  card: Card;
  boards: Board[];
  profiles: ProfileSummary[];
  onSave: (
    id: string,
    title: string,
    description: string,
    tags?: string[],
    due_date?: string | null,
    priority?: Priority,
    assigneeId?: string | null,
    assigneeTouched?: boolean,
    assigneeDisplayName?: string | null
  ) => void;
  onDelete: (id: string) => void;
  onMoveToBoard: (cardId: string, targetBoardId: string) => void;
  onClose: () => void;
}

export function CardModal({
  card,
  boards,
  onSave,
  onDelete,
  profiles,
  onMoveToBoard,
  onClose,
}: CardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [tags, setTags] = useState<string[]>(card.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [dueDate, setDueDate] = useState(card.due_date || '');
  const [priority, setPriority] = useState<Priority>(card.priority || 'medium');
  const [assigneeId, setAssigneeId] = useState(card.assignee_id || '');
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [legacyAssignee, setLegacyAssignee] = useState(card.assignee_id ? null : (card.assigned_to ?? null));
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const [targetBoardId, setTargetBoardId] = useState(card.board_id);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'comments'>('details');

  const dialogRef = useRef<HTMLDivElement>(null);
  const cardIdRef = useRef(card.id);
  const onCloseRef = useRef(onClose);

  const filteredProfiles = useMemo(() => {
    const query = assigneeSearch.trim().toLowerCase();
    const base = !query
      ? profiles
      : profiles.filter((profile) => {
        const name = profile.full_name?.toLowerCase() ?? '';
        const email = profile.email?.toLowerCase() ?? '';
        return name.includes(query) || email.includes(query);
      });

    if (assigneeId) {
      const selected = profiles.find((profile) => profile.id === assigneeId);
      if (selected && !base.some((profile) => profile.id === selected.id)) {
        return [...base, selected];
      }
    }

    return base;
  }, [profiles, assigneeSearch, assigneeId]);

  const selectedAssignee = useMemo(() => {
    if (!assigneeId) return null;
    return profiles.find((profile) => profile.id === assigneeId) ?? null;
  }, [profiles, assigneeId]);

  // onClose ref を最新に保つ
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // card prop が変わったときの処理（ただし編集中は無視）
  useEffect(() => {
    // card.id が変わった場合（別のカードを開いた）、または編集していない場合のみ更新
    if (card.id !== cardIdRef.current) {
      cardIdRef.current = card.id;
      setTitle(card.title);
      setDescription(card.description);
      setTags(card.tags || []);
      setDueDate(card.due_date || '');
      setPriority(card.priority || 'medium');
      setAssigneeId(card.assignee_id || '');
      setLegacyAssignee(card.assignee_id ? null : (card.assigned_to ?? null));
      setAssigneeSearch('');
      setAssigneeTouched(false);
      setTargetBoardId(card.board_id);
      setIsDirty(false);
    } else if (!isDirty) {
      // 同じカードで編集していない場合のみ、外部の変更を反映
      setTitle(card.title);
      setDescription(card.description);
      setTags(card.tags || []);
      setDueDate(card.due_date || '');
      setPriority(card.priority || 'medium');
      setAssigneeId(card.assignee_id || '');
      setLegacyAssignee(card.assignee_id ? null : (card.assigned_to ?? null));
      setAssigneeTouched(false);
      setTargetBoardId(card.board_id);
    }
  }, [card, isDirty]);

  // Escape key to close + focus trap
  useEffect(() => {
    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

    const focusFirstElement = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const autoFocusTarget = dialog.querySelector<HTMLElement>('[data-autofocus]');
      if (autoFocusTarget) {
        autoFocusTarget.focus();
        return;
      }
      const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelector);
      (focusable[0] ?? dialog).focus();
    };

    const trapFocus = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute("disabled"),
      );

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const isShift = event.shiftKey;

      if (!current) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (!isShift && current === last) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (isShift && current === first) {
        event.preventDefault();
        last.focus();
        return;
      }
    };

    document.addEventListener("keydown", trapFocus);
    focusFirstElement();

    return () => {
      document.removeEventListener("keydown", trapFocus);
    };
  }, []); // 空配列でマウント時のみ実行

  const handleSave = () => {
    const selectedDisplayName = selectedAssignee ? getProfileDisplayName(selectedAssignee) : null;
    const displayNameFallback = selectedDisplayName ?? (legacyAssignee ?? null);

    onSave(
      card.id,
      title,
      description,
      tags,
      dueDate || null,
      priority,
      assigneeId || null,
      assigneeTouched,
      displayNameFallback
    );

    if (targetBoardId !== card.board_id) {
      onMoveToBoard(card.id, targetBoardId);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleDelete = () => {
    if (confirm('Delete this card?')) {
      onDelete(card.id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        data-testid="card-modal-overlay"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex justify-between items-start mb-4">
          <h2 id="modal-title" className="text-2xl font-bold text-slate-800 dark:text-gray-100">
            Edit Card
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none"
            aria-label="Close modal"
            data-autofocus
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-slate-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
              activeTab === 'details'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200'
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('comments')}
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
              activeTab === 'comments'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200'
            }`}
          >
            Comments
          </button>
        </div>

        {/* Modal Body */}
        {activeTab === 'details' ? (
        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setIsDirty(true);
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              placeholder="Card title"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setIsDirty(true);
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent resize-none"
              placeholder="Add a description..."
              rows={4}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Tags
            </label>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              placeholder="Press Enter to add tag"
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 rounded-md text-xs"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-200"
                      aria-label={`Remove tag ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Due Date */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate ? new Date(dueDate).toISOString().split('T')[0] : ''}
              onChange={(e) => setDueDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
            >
              <option value="low">🟢 Low</option>
              <option value="medium">🟡 Medium</option>
              <option value="high">🔴 High</option>
            </select>
          </div>

          {/* Assignee */}
          <div>
            <label htmlFor="assignee-select" className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Assignee
            </label>
            {legacyAssignee ? (
              <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                旧形式で登録された担当者: {legacyAssignee}（新しい担当者を選択すると更新されます）
              </p>
            ) : null}
            <div className="space-y-2">
              <input
                id="assignee-search"
                type="text"
                value={assigneeSearch}
                onChange={(e) => setAssigneeSearch(e.target.value)}
                placeholder="Search by name or email"
                aria-label="Assignee search"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              />
              <select
                id="assignee-select"
                value={assigneeId}
                onChange={(e) => {
                  setAssigneeId(e.target.value);
                  setLegacyAssignee(null);
                  setIsDirty(true);
                  setAssigneeTouched(true);
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              >
                <option value="">未割り当て</option>
                {filteredProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {getProfileDisplayName(profile)}
                  </option>
                ))}
              </select>
            </div>
            {selectedAssignee ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
                {selectedAssignee.avatar_url ? (
                  <Image
                    src={selectedAssignee.avatar_url}
                    alt={getProfileDisplayName(selectedAssignee)}
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600 font-semibold dark:bg-gray-700 dark:text-gray-200">
                    {getProfileInitials(selectedAssignee)}
                  </span>
                )}
                <span>{getProfileDisplayName(selectedAssignee)}</span>
                {selectedAssignee.email ? (
                  <span className="text-slate-400 dark:text-gray-500">({selectedAssignee.email})</span>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Move to Board */}
          {boards.length > 1 && (
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                Move to Board
              </label>
              <select
                value={targetBoardId}
                onChange={(e) => setTargetBoardId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              >
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name} {board.id === card.board_id ? '(current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Copy Links */}
          {card.short_id && (
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                Share Link
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const shortUrl = `${window.location.origin}/c/${card.short_id}`;
                    navigator.clipboard.writeText(shortUrl);
                  }}
                  className="flex-1 px-3 py-1.5 bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-200 rounded-lg text-xs hover:bg-slate-200 dark:hover:bg-gray-600 transition-colors"
                >
                  📋 Copy Short Link
                </button>
                {card.id_short && card.slug && (
                  <button
                    type="button"
                    onClick={() => {
                      const readableUrl = `${window.location.origin}/c/${card.short_id}/${card.id_short}-${card.slug}`;
                      navigator.clipboard.writeText(readableUrl);
                    }}
                    className="flex-1 px-3 py-1.5 bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-200 rounded-lg text-xs hover:bg-slate-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    📋 Copy Full Link
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        ) : (
          <div className="min-h-[400px]">
            <CommentsPanel cardId={card.id} boardId={card.board_id} />
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex gap-2 mt-6 pt-4 border-t border-slate-200 dark:border-gray-700">
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-sky-500 text-white rounded-lg text-sm hover:bg-sky-600 transition-colors font-medium"
          >
            Save
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors font-medium"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-gray-600 text-slate-700 dark:text-gray-200 rounded-lg text-sm hover:bg-slate-300 dark:hover:bg-gray-500 transition-colors font-medium ml-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
