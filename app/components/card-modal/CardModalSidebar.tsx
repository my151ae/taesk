"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import type { Board, Priority, ProfileSummary } from "@/lib/supabase";
import CommentsPanel from "@/app/(board)/_components/CommentsPanel";
import { GoogleSyncToggle } from "@/app/(board)/_components/GoogleSyncToggle";

type CardModalSidebarProps = {
  sidebarWidth: number;
  tagInput: string;
  tags: string[];
  onTagInputChange: (value: string) => void;
  onTagInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveTag: (tag: string) => void;
  priority: Priority;
  onPriorityChange: (priority: Priority) => void;
  boards: Board[];
  targetBoardId: string;
  onTargetBoardChange: (boardId: string) => void;
  cardShortId: string | null;
  cardId: string;
  boardId: string;
  profiles: ProfileSummary[];
  googleSync?: {
    cardId: string;
    connected: boolean;
    canWrite: boolean;
    status?: "active" | "unlinked" | "deleted";
    onStatusChange?: (status: "active" | "unlinked" | "deleted") => void;
  };
};

export default function CardModalSidebar({
  sidebarWidth,
  tagInput,
  tags,
  onTagInputChange,
  onTagInputKeyDown,
  onRemoveTag,
  priority,
  onPriorityChange,
  boards,
  targetBoardId,
  onTargetBoardChange,
  cardShortId,
  cardId,
  boardId,
  profiles,
  googleSync,
}: CardModalSidebarProps) {
  const handleCopyLink = () => {
    if (!cardShortId || typeof window === "undefined") return;
    const shortUrl = `${window.location.origin}/c/${cardShortId}`;
    navigator.clipboard.writeText(shortUrl);
  };

  return (
    <div
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      className="border-t sm:border-t-0 sm:border-l border-slate-100 dark:border-gray-700 overflow-y-auto flex flex-col shrink-0 min-h-0 w-full sm:w-[var(--sidebar-width)]"
    >
      <div className="p-6 space-y-5 border-b border-slate-100 dark:border-gray-700/50 bg-slate-50/30 dark:bg-gray-800/20">
        {/* Tags Section */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">
            Tags
          </label>
          <div className="flex flex-wrap gap-1.5 items-center">
            <div className="relative flex-1 min-w-[140px]">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => onTagInputChange(e.target.value)}
                onKeyDown={onTagInputKeyDown}
                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent placeholder:text-slate-400"
                placeholder="+ Add tag..."
              />
            </div>
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-1 bg-white dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 rounded-md text-[10px] font-medium border border-slate-100 dark:border-sky-800"
              >
                {tag}
                <button
                  onClick={() => onRemoveTag(tag)}
                  className="text-sky-400 hover:text-sky-600"
                  aria-label={`Remove tag ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Priority - Compact row */}
        <div className="flex items-center justify-between pt-1">
          <label className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => onPriorityChange(e.target.value as Priority)}
            className="bg-transparent text-xs font-medium text-slate-600 dark:text-gray-300 focus:outline-none cursor-pointer"
          >
            <option value="low">🟢 Low</option>
            <option value="medium">🟡 Medium</option>
            <option value="high">🔴 High</option>
          </select>
        </div>

        {/* Advanced (Board & Links) */}
        <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-gray-700/50 mt-2">
          {boards.length > 1 && (
            <div className="flex-1 min-w-0">
              <select
                value={targetBoardId}
                onChange={(e) => onTargetBoardChange(e.target.value)}
                className="w-full bg-transparent text-[10px] font-medium text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-none cursor-pointer truncate"
              >
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    Board: {board.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {cardShortId && (
            <button
              type="button"
              onClick={handleCopyLink}
              className="text-[10px] font-medium text-sky-500 hover:text-sky-600 dark:text-sky-400 whitespace-nowrap"
            >
              🔗 Copy Link
            </button>
          )}
        </div>
        {googleSync && (
          <div className="pt-3 border-t border-slate-100 dark:border-gray-700/50">
            <GoogleSyncToggle
              cardId={googleSync.cardId}
              initialStatus={googleSync.status}
              connected={googleSync.connected}
              canWrite={googleSync.canWrite}
              onStatusChange={googleSync.onStatusChange}
            />
          </div>
        )}
      </div>

      {/* Comments Area */}
      <div className="flex-1 min-h-0 flex flex-col p-6 pt-4">
        <h3 className="text-xs font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-4">
          Comments
        </h3>
        <div className="flex-1 min-h-0">
          <CommentsPanel
            cardId={cardId}
            boardId={boardId}
            initialProfiles={profiles}
          />
        </div>
      </div>
    </div>
  );
}
