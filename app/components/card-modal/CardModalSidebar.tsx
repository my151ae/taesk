"use client";

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CardContentHistoryMeta, ProfileSummary } from "@/lib/supabase";
import CommentsPanel from "@/app/(board)/_components/CommentsPanel";

type SidebarTab = "comments" | "history";

type CardModalSidebarProps = {
  sidebarWidth: number;
  cardId: string;
  boardId: string;
  profiles: ProfileSummary[];
  tags: string[];
  availableTags: string[];
  tagInput: string;
  onTagInputChange: (value: string) => void;
  onTagInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onRemoveTag: (tag: string) => void;
  activeTab: SidebarTab | null;
  onTabChange: (tab: SidebarTab) => void;
  showCompletedLines: boolean;
  onShowCompletedLinesChange: (next: boolean) => void;
  historyItems: CardContentHistoryMeta[];
  historyLoading: boolean;
  historyError: string | null;
  selectedHistoryId: string | null;
  onSelectHistory: (historyId: string) => void;
};

export default function CardModalSidebar({
  sidebarWidth,
  cardId,
  boardId,
  profiles,
  tags,
  availableTags,
  tagInput,
  onTagInputChange,
  onTagInputKeyDown,
  onRemoveTag,
  activeTab,
  onTabChange,
  showCompletedLines,
  onShowCompletedLinesChange,
  historyItems,
  historyLoading,
  historyError,
  selectedHistoryId,
  onSelectHistory,
}: CardModalSidebarProps) {
  const tagSuggestionListId = `card-modal-tag-suggestions-${cardId}`;
  const selectableTags = availableTags.filter((tag) => !tags.includes(tag));

  return (
    <div
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      className="flex-1 min-h-0 border-t sm:border-t-0 sm:border-l border-slate-100 dark:border-gray-700 overflow-y-auto flex flex-col shrink-0 w-full sm:flex-none sm:w-[var(--sidebar-width)]"
    >
      <div className="flex-1 min-h-0 flex flex-col px-6 pb-6 pt-3">
        <div className="space-y-5">
          <section className="space-y-2" data-testid="card-modal-tags-panel">
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-[180px] max-w-full shrink-0">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => onTagInputChange(e.target.value)}
                  onKeyDown={onTagInputKeyDown}
                  list={tagSuggestionListId}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700 placeholder:text-slate-400"
                  placeholder="TAGS Add or Select"
                />
                <datalist id={tagSuggestionListId}>
                  {selectableTags.map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
                </datalist>
              </div>
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 shadow-sm dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => onRemoveTag(tag)}
                    className="text-sky-500 hover:text-sky-700"
                    aria-label={`Remove tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </section>

          <section className="space-y-2" data-testid="card-modal-completed-lines-panel">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={showCompletedLines}
                onChange={(event) => onShowCompletedLinesChange(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                data-testid="card-modal-show-completed-lines"
              />
              <span>完了行を表示</span>
            </label>
          </section>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onTabChange("comments")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${activeTab === "comments"
                ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                : "text-slate-500 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
            >
              Comments
            </button>
            <button
              type="button"
              onClick={() => onTabChange("history")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${activeTab === "history"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                : "text-slate-500 hover:bg-slate-100 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
            >
              履歴
            </button>
          </div>
        </div>

        {activeTab === "comments" ? (
          <div className="flex-1 min-h-0">
            <CommentsPanel
              cardId={cardId}
              boardId={boardId}
              initialProfiles={profiles}
            />
          </div>
        ) : activeTab === "history" ? (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {historyLoading && (
              <p className="text-xs text-slate-500">履歴を読み込み中...</p>
            )}
            {historyError && (
              <p className="text-xs text-red-600">{historyError}</p>
            )}
            {!historyLoading && !historyError && historyItems.length === 0 && (
              <p className="text-xs text-slate-500">履歴はまだありません。</p>
            )}
            {historyItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectHistory(item.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${selectedHistoryId === item.id
                  ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20"
                  : "border-slate-200 hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                  }`}
              >
                <p className="text-[11px] font-semibold text-slate-700 dark:text-gray-200">
                  {new Date(item.created_at).toLocaleString("ja-JP")}
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-gray-400">
                  {item.excerpt || "(本文なし)"}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-slate-400 dark:text-gray-500">
            Comments または 履歴を選択
          </div>
        )}
      </div>
    </div>
  );
}
