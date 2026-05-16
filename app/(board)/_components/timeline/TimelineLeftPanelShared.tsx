"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import { buildTimelineCardFloatingLabel, buildTimelineCardStatusItems, buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import type { IncrementalPanelSectionKey } from "@/app/(board)/_components/timeline/sidebar-section-types";
import type { ShortcutSection } from "@/app/(board)/_components/timeline/shortcut-bar-registry";
import type { TimelineSearchResultItem, TimelineTagSummary } from "@/app/(board)/_hooks/useTimelineFiltering";
import type { TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";
import type { TrashCardItem } from "@/lib/api-types/timeline";

export const SIDEBAR_INCREMENT_PAGE_SIZE = 20;

type SharedSelectionProps = {
  selectedCardIds: ReadonlySet<string>;
  selectionLeadCardId: string | null;
  onShiftSelect: (args: {
    cardId: string;
    laneId: string;
    activeCardId: string | null;
    activeLaneId: string | null;
  }) => void;
  onClearSelection: () => void;
  onActivateCard: (cardId: string, laneId: string) => void;
  activeCardId: string | null;
  activeLaneId: string | null;
};

type SharedCardActions = SharedSelectionProps & {
  openCardModal: (shortId: string | null, source: string) => void;
  onOpenOverdueTimelineCard?: (item: TimelineOverdueItem) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
  onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
};

type IncrementalVisibilityProps = {
  visibleCount: number;
  onVisibleCountChange: (nextCount: number) => void;
};

const COMPLETED_MONTH_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
});

const COMPLETED_TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const COMPLETED_UNDATED_GROUP_KEY = "__undated__";
export const COMPLETED_UNDATED_GROUP_LABEL = "完了日時なし";
export const TAGS_EMPTY_MESSAGE = "タグを選ぶと、このパネル内に一致カードを表示します";
export const TAGS_NO_RESULTS_MESSAGE = "選択中のタグに一致するカードはありません";

export type CompletedResultsGroup = {
  key: string;
  label: string;
  count: number;
  results: readonly TimelineSearchResultItem[];
  kind: "month" | "undated";
};

export function getTagsSectionViewState({
  selectedTags,
  resultCount,
}: {
  selectedTags: readonly string[];
  resultCount: number;
}) {
  const hasSelection = selectedTags.length > 0;

  return {
    hasSelection,
    showTagList: !hasSelection,
    headerText: hasSelection ? `${selectedTags.length} 件選択中` : "タグで絞り込めます",
    helperMessage: hasSelection
      ? resultCount === 0
        ? TAGS_NO_RESULTS_MESSAGE
        : null
      : TAGS_EMPTY_MESSAGE,
  };
}

export function buildCompletedMonthKeyJst(checkedAt: string | null) {
  if (!checkedAt) return null;
  const parts = COMPLETED_MONTH_FORMATTER.formatToParts(new Date(checkedAt));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) return null;
  return `${year}/${month}`;
}

export function buildCurrentCompletedMonthKeyJst(referenceDate: Date | string = new Date()) {
  const date = typeof referenceDate === "string" ? new Date(referenceDate) : referenceDate;
  const parts = COMPLETED_MONTH_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) return null;
  return `${year}/${month}`;
}

export function buildCompletedTimeText(checkedAt: string | null) {
  if (!checkedAt) return COMPLETED_UNDATED_GROUP_LABEL;
  return `完了 ${COMPLETED_TIME_FORMATTER.format(new Date(checkedAt))}`;
}

export function buildCompletedResultsGroups(results: readonly TimelineSearchResultItem[]): CompletedResultsGroup[] {
  const groups: CompletedResultsGroup[] = [];

  results.forEach((result) => {
    const monthKey = buildCompletedMonthKeyJst(result.item.checked_at);
    const key = monthKey ?? COMPLETED_UNDATED_GROUP_KEY;
    const label = monthKey ?? COMPLETED_UNDATED_GROUP_LABEL;
    const currentGroup = groups[groups.length - 1];

    if (currentGroup?.key === key) {
      const nextResults = [...currentGroup.results, result];
      groups[groups.length - 1] = {
        ...currentGroup,
        count: nextResults.length,
        results: nextResults,
      };
      return;
    }

    groups.push({
      key,
      label,
      count: 1,
      results: [result],
      kind: key === COMPLETED_UNDATED_GROUP_KEY ? "undated" : "month",
    });
  });

  return groups;
}

export function buildCompletedGroupsResetKey(currentMonthKey: string | null, groups: readonly CompletedResultsGroup[]) {
  const serializedGroups = groups
    .map((group) => `${group.key}:${group.results.map((result) => result.item.card_id).join(",")}`)
    .join("|");
  return `${currentMonthKey ?? ""}::${serializedGroups}`;
}

export function getIncrementalVisibilityState({
  total,
  visibleCount,
  pageSize = SIDEBAR_INCREMENT_PAGE_SIZE,
}: {
  total: number;
  visibleCount: number;
  pageSize?: number;
}) {
  const normalizedVisibleCount = Math.max(pageSize, visibleCount);
  return {
    normalizedVisibleCount,
    nextVisibleCount: normalizedVisibleCount + pageSize,
    sliceEnd: Math.min(total, normalizedVisibleCount),
    canLoadMore: total > normalizedVisibleCount,
  };
}

function useIncrementalVisibleCount({
  total,
  resetKey,
  visibleCount,
  onVisibleCountChange,
  pageSize = SIDEBAR_INCREMENT_PAGE_SIZE,
}: {
  total: number;
  resetKey: string;
  visibleCount: number;
  onVisibleCountChange: (nextCount: number) => void;
  pageSize?: number;
}) {
  const previousResetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    if (visibleCount !== pageSize) {
      onVisibleCountChange(pageSize);
    }
  }, [onVisibleCountChange, pageSize, resetKey, visibleCount]);

  const state = useMemo(
    () => getIncrementalVisibilityState({ total, visibleCount, pageSize }),
    [pageSize, total, visibleCount],
  );

  return {
    visibleCount: state.normalizedVisibleCount,
    sliceEnd: state.sliceEnd,
    canLoadMore: state.canLoadMore,
    handleLoadMore: () => onVisibleCountChange(state.nextVisibleCount),
  };
}

export function LoadMoreFooter({
  canLoadMore,
  onLoadMore,
  testId,
  disabled = false,
  label = "さらに表示",
}: {
  canLoadMore: boolean;
  onLoadMore: () => void;
  testId: string;
  disabled?: boolean;
  label?: string;
}) {
  if (!canLoadMore) return null;

  return (
    <div className="px-2 pb-4 pt-2">
      <button
        type="button"
        data-testid={testId}
        onClick={onLoadMore}
        disabled={disabled}
        className="flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
      >
        {label}
      </button>
    </div>
  );
}

export function SharedPanelHeader({
  title,
  count,
  accessory,
  className,
  tone = "neutral",
}: {
  title: string;
  count: number;
  accessory?: React.ReactNode;
  className?: string;
  tone?: "danger" | "neutral";
}) {
  return (
    <div className={clsx("relative flex h-8 items-center justify-between border-b border-slate-200/80 px-3", className)}>
      <div className="flex min-w-0 items-center gap-2 leading-tight">
        <h2 className="truncate text-sm font-semibold leading-tight text-slate-800">{title}</h2>
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight",
            tone === "danger" ? "bg-rose-200 text-rose-800" : "bg-slate-200 text-slate-700"
          )}
        >
          {count}
        </span>
      </div>
      {accessory ?? null}
    </div>
  );
}

function SidebarCardRow({
  item,
  badgeLabel,
  timeText: _timeText,
  openSource,
  shortcutSection,
  testId,
  className,
  draggable = false,
  onToggleCheck,
  onRenameCardTitle,
  openCardModal,
  onOpenOverdueTimelineCard,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  isContextMenuOpen,
  isActive = false,
  isSelected = false,
  selectionLane,
  onShiftSelect,
  onClearSelection,
  onActivateCard,
  activeCardId,
  activeLaneId,
  inlineTitleEdit = false,
}: {
  item: {
    card_id: string;
    title: string;
    checked: boolean;
    checklist?: TimelineOverdueItem["checklist"];
    content?: TimelineOverdueItem["content"];
    excerpt?: string | null;
    tags?: string[];
    due_date?: string | null;
    due_start?: string | null;
    due_end?: string | null;
    due_bucket?: string | null;
    duration?: number | null;
    start_reminder_enabled?: boolean;
    end_reminder_enabled?: boolean;
    short_id: string | null;
  };
  badgeLabel: string;
  timeText: string | null;
  openSource: string;
  shortcutSection: ShortcutSection;
  testId: string;
  className?: string;
  draggable?: boolean;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  openCardModal: (shortId: string | null, source: string) => void;
  onOpenOverdueTimelineCard?: (item: TimelineOverdueItem) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  isContextMenuOpen: boolean;
  isActive?: boolean;
  isSelected?: boolean;
  selectionLane?: string;
  onShiftSelect?: SharedSelectionProps["onShiftSelect"];
  onClearSelection?: SharedSelectionProps["onClearSelection"];
  onActivateCard?: SharedSelectionProps["onActivateCard"];
  activeCardId?: string | null;
  activeLaneId?: string | null;
  inlineTitleEdit?: boolean;
  onRenameCardTitle?: (cardId: string, nextTitle: string) => Promise<boolean>;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const bucketPrefix = buildTimelineCardFloatingLabel(item, {
    bucketLabel: badgeLabel,
    includeDate: false,
    includeTime: false,
    includeDuration: false,
  });
  const floatingLabel = [bucketPrefix, _timeText].filter(Boolean).join(" ") || null;

  const renderCard = (dragHandleProps?: React.ComponentProps<typeof TimelineCard>["dragHandleProps"]) => (
    <div
      className="relative min-w-0 select-none pt-4 has-[:focus]:z-10"
      data-testid={testId}
      onContextMenu={(e) => onCardContextMenu(e, item.card_id)}
    >
      <TimelineCard
        title={item.title || ""}
        checked={item.checked}
        checklist={item.checklist}
        content={item.content ?? null}
        onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
        cardId={item.card_id}
        statusItems={buildTimelineCardStatusItems(item, {
          includeTags: true,
          includeDate: false,
          includeTime: false,
          includeDuration: false,
          includeBucket: false,
        })}
        timeText={floatingLabel}
        timePlacement="out-top"
        note={item.excerpt ?? undefined}
        noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
        notePreviewLines={2}
        onOpen={() => {
          if (openSource === "overdue" && onOpenOverdueTimelineCard) {
            onOpenOverdueTimelineCard(item as TimelineOverdueItem);
            return;
          }
          openCardModal(item.short_id, openSource);
        }}
        openButtonTestId={`cardOpenButton-${openSource}-${item.card_id}`}
        showOpenButton
        paddingClass="py-1"
        className={clsx("min-h-0", className, isActive && "shadow-md")}
        shortcutContext={{
          scope: "board",
          region: "sidebar",
          section: shortcutSection,
          part: "card",
        }}
        onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(item.card_id, rect)}
        focusGroup="bucket"
        isSelected={isSelected}
        selectionLane={selectionLane}
        onShiftSelect={onShiftSelect}
        onClearSelection={onClearSelection}
        onActivateCard={onActivateCard}
        activeCardId={activeCardId}
        activeLaneId={activeLaneId}
        inlineTitleEdit={inlineTitleEdit}
        onRenameTitle={onRenameCardTitle ? (nextTitle) => onRenameCardTitle(item.card_id, nextTitle).then(() => undefined) : undefined}
        onTitleEditStateChange={setIsEditingTitle}
        dragHandleProps={dragHandleProps}
      />
    </div>
  );

  if (!draggable) return renderCard();

  return (
    <DraggableCard
      id={`overdue:${item.card_id}`}
      data={{ kind: "overdue", cardId: item.card_id, item }}
      disabled={isContextMenuOpen || isEditingTitle}
    >
      {(dragHandleProps) => renderCard(dragHandleProps)}
    </DraggableCard>
  );
}

function buildOverdueTimeText(item: TimelineOverdueItem) {
  return buildTimelineCardTimeText(item, {
    includeDate: true,
    includeDuration: true,
  });
}

function buildTrashTimeText(item: TrashCardItem) {
  const purgeAt = new Date(item.purge_after_at);
  const deletedAt = new Date(item.deleted_at);
  const purgeText = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(purgeAt);
  const deletedText = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(deletedAt);
  return `削除 ${deletedText} / 完全削除 ${purgeText}`;
}

function renderSidebarResultRows({
  results,
  shortcutSection,
  openSource,
  testIdPrefix,
  showCompletedMonthHeadings = false,
  footer,
  onToggleCheck,
  onRenameCardTitle,
  openCardModal,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
  selectedCardIds,
  selectionLeadCardId,
  onShiftSelect,
  onClearSelection,
  onActivateCard,
  activeCardId,
  activeLaneId,
}: {
  results: readonly TimelineSearchResultItem[];
  shortcutSection: ShortcutSection;
  openSource: string;
  testIdPrefix: string;
  showCompletedMonthHeadings?: boolean;
  footer?: React.ReactNode;
} & SharedCardActions) {
  const content: React.ReactNode[] = [];
  let previousMonthKey: string | null = null;

  results.forEach((result) => {
    const monthKey = showCompletedMonthHeadings ? buildCompletedMonthKeyJst(result.item.checked_at) : null;
    if (monthKey && monthKey !== previousMonthKey) {
      content.push(
        <div
          key={`month-heading:${monthKey}`}
          data-testid={`completed-month-heading-${monthKey.replace("/", "-")}`}
          className="mt-3 border-t border-slate-200/80 pt-3 first:mt-0 first:border-t-0 first:pt-0"
        >
          <p className="text-[10px] font-semibold tracking-[0.08em] text-slate-400">{monthKey}</p>
        </div>,
      );
      previousMonthKey = monthKey;
    } else if (!monthKey) {
      previousMonthKey = null;
    }

    content.push(
      <SidebarCardRow
        key={`${result.kind}:${result.item.card_id}`}
        item={result.item}
        badgeLabel={result.badgeLabel}
        timeText={result.timeText}
        openSource={openSource}
        shortcutSection={shortcutSection}
        testId={`${testIdPrefix}-${result.kind}-${result.item.card_id}`}
        className="bg-white"
        onToggleCheck={onToggleCheck}
        onRenameCardTitle={onRenameCardTitle}
        openCardModal={openCardModal}
        onCardContextMenu={onCardContextMenu}
        onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
        isContextMenuOpen={contextMenuCardId === result.item.card_id}
        isActive={selectionLeadCardId === result.item.card_id || activeCardId === result.item.card_id}
        isSelected={selectedCardIds.has(result.item.card_id)}
        selectionLane={shortcutSection}
        onShiftSelect={onShiftSelect}
        onClearSelection={onClearSelection}
        onActivateCard={onActivateCard}
        activeCardId={activeCardId}
        activeLaneId={activeLaneId}
      />,
    );
  });

  return (
    <div className="min-h-full space-y-1 p-[1px] pb-4 pl-2 pr-2">
      {content}
      {footer}
    </div>
  );
}

export function OverdueSectionBody({
  items,
  allowDrag,
  emptyClassName,
  cardClassName,
  ...cardActions
}: {
  items: readonly TimelineOverdueItem[];
  allowDrag: boolean;
  emptyClassName?: string;
  cardClassName?: string;
} & SharedCardActions) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!allowDrag ? (
        <div className="px-3 pt-3">
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            List表示中はドラッグ移動を停止しています
          </p>
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="px-3 py-4">
          <p className={clsx("rounded-2xl border border-dashed border-rose-200 bg-rose-50/70 px-3 py-3 text-[11px] text-rose-700/80", emptyClassName)}>
            未完了の期限超過カードはありません
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
          <div className="min-h-full space-y-1 p-[1px] pb-4 pl-2 pr-2">
            {items.map((item) => (
              <SidebarCardRow
                key={item.card_id}
                item={item}
                badgeLabel={item.due_bucket?.toUpperCase() ?? "O"}
                timeText={buildOverdueTimeText(item)}
                openSource="overdue"
                shortcutSection="overdue"
                testId={`overdue-card-${item.card_id}`}
                className={clsx(allowDrag ? "bg-white" : "bg-slate-50", cardClassName)}
                draggable={allowDrag}
                onToggleCheck={cardActions.onToggleCheck}
                onRenameCardTitle={cardActions.onRenameCardTitle}
                openCardModal={cardActions.openCardModal}
                onOpenOverdueTimelineCard={cardActions.onOpenOverdueTimelineCard}
                onCardContextMenu={cardActions.onCardContextMenu}
                onCardContextMenuByKeyboard={cardActions.onCardContextMenuByKeyboard}
                isContextMenuOpen={cardActions.contextMenuCardId === item.card_id}
                isActive={cardActions.selectionLeadCardId === item.card_id || cardActions.activeCardId === item.card_id}
                isSelected={cardActions.selectedCardIds.has(item.card_id)}
                selectionLane="overdue"
                onShiftSelect={cardActions.onShiftSelect}
                onClearSelection={cardActions.onClearSelection}
                onActivateCard={cardActions.onActivateCard}
                activeCardId={cardActions.activeCardId}
                activeLaneId={cardActions.activeLaneId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SearchSectionBody({
  query,
  results,
  onQueryChange,
  searchInputTestId = "desktop-sidebar-search-input",
  visibleCount,
  onVisibleCountChange,
  ...cardActions
}: {
  query: string;
  results: readonly TimelineSearchResultItem[];
  onQueryChange: (value: string) => void;
  searchInputTestId?: string;
} & SharedCardActions & IncrementalVisibilityProps) {
  const resetKey = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return "";
    return `${trimmedQuery}::${results.map((result) => result.item.card_id).join(",")}`;
  }, [query, results]);
  const { sliceEnd, canLoadMore, handleLoadMore } = useIncrementalVisibleCount({
    total: results.length,
    resetKey,
    visibleCount,
    onVisibleCountChange,
  });
  const visibleResults = useMemo(() => results.slice(0, sliceEnd), [results, sliceEnd]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-slate-200/80 bg-slate-50 px-2 py-2">
        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search cards..."
            className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            data-testid={searchInputTestId}
            data-shortcut-scope="board"
            data-shortcut-region="sidebar"
            data-shortcut-section="search"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
        {!query.trim() ? (
          <div className="px-3 py-4">
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
              キーワードを入れると、このパネル内に一致カードを表示します
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="px-3 py-4">
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
              一致するカードはありません
            </p>
          </div>
        ) : (
          renderSidebarResultRows({
            results: visibleResults,
            shortcutSection: "search",
            openSource: "search",
            testIdPrefix: "search-card",
            footer: (
              <LoadMoreFooter
                canLoadMore={canLoadMore}
                onLoadMore={handleLoadMore}
                testId="sidebar-search-load-more"
              />
            ),
            ...cardActions,
          })
        )}
      </div>
    </div>
  );
}

export function ParentCardsSectionBody({
  results,
  visibleCount,
  onVisibleCountChange,
  ...cardActions
}: {
  results: readonly TimelineSearchResultItem[];
} & SharedCardActions & IncrementalVisibilityProps) {
  const resetKey = useMemo(
    () => results.map((result) => result.item.card_id).join(","),
    [results],
  );
  const { sliceEnd, canLoadMore, handleLoadMore } = useIncrementalVisibleCount({
    total: results.length,
    resetKey,
    visibleCount,
    onVisibleCountChange,
  });
  const visibleResults = useMemo(() => results.slice(0, sliceEnd), [results, sliceEnd]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {results.length === 0 ? (
        <div className="px-3 py-4">
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
            親カードはありません
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
          {renderSidebarResultRows({
            results: visibleResults,
            shortcutSection: "search",
            openSource: "parents",
            testIdPrefix: "parents-card",
            footer: (
              <LoadMoreFooter
                canLoadMore={canLoadMore}
                onLoadMore={handleLoadMore}
                testId="sidebar-parents-load-more"
              />
            ),
            ...cardActions,
          })}
        </div>
      )}
    </div>
  );
}

export function CompletedSectionBody({
  results,
  groupedResults,
  currentMonthKey,
  resetKey,
  ...cardActions
}: {
  results: readonly TimelineSearchResultItem[];
  groupedResults: readonly CompletedResultsGroup[];
  currentMonthKey: string | null;
  resetKey: string;
} & SharedCardActions & Partial<IncrementalVisibilityProps>) {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => new Set());
  const [groupVisibleCounts, setGroupVisibleCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setExpandedGroupKeys(new Set());
    setGroupVisibleCounts({});
  }, [resetKey]);

  const visibleGroups = groupedResults;

  const ensureGroupVisibleCount = (groupKey: string) => {
    setGroupVisibleCounts((prev) => {
      if (typeof prev[groupKey] === "number") return prev;
      return {
        ...prev,
        [groupKey]: SIDEBAR_INCREMENT_PAGE_SIZE,
      };
    });
  };

  const toggleGroup = (groupKey: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
    ensureGroupVisibleCount(groupKey);
  };

  const handleGroupLoadMore = (groupKey: string, nextVisibleCount: number) => {
    setGroupVisibleCounts((prev) => ({
      ...prev,
      [groupKey]: nextVisibleCount,
    }));
  };

  const buildSanitizedGroupKey = (groupKey: string) => {
    if (groupKey === COMPLETED_UNDATED_GROUP_KEY) return "undated";
    return groupKey.replace("/", "-");
  };

  const exposedGroups = useMemo(() => {
    return visibleGroups.map((group) => {
      const visibilityState = getIncrementalVisibilityState({
        total: group.results.length,
        visibleCount: groupVisibleCounts[group.key] ?? SIDEBAR_INCREMENT_PAGE_SIZE,
      });

      return {
        group,
        visibleResults: group.results.slice(0, visibilityState.sliceEnd),
        canLoadMore: visibilityState.canLoadMore,
        nextVisibleCount: visibilityState.nextVisibleCount,
      };
    });
  }, [groupVisibleCounts, visibleGroups]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {results.length === 0 ? (
        <div className="px-3 py-4">
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
            完了済みカードはありません
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
          <div className="min-h-full space-y-2 p-[1px] pb-4 pl-2 pr-2">
            {exposedGroups.map(({ group, visibleResults, canLoadMore, nextVisibleCount }) => {
              const isExpanded = expandedGroupKeys.has(group.key);
              const sanitizedGroupKey = buildSanitizedGroupKey(group.key);

              return (
                <div key={group.key} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={isExpanded}
                    data-testid={`completed-group-toggle-${sanitizedGroupKey}`}
                    className={clsx(
                      "flex min-h-8 w-full min-w-0 select-none items-center justify-between gap-3 border-b border-slate-200/90 bg-white px-2 py-1 text-left transition-colors duration-150",
                      "cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-inset",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[10px] font-semibold text-slate-700">{group.label}</span>
                      <span
                        className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold leading-none text-slate-700"
                        data-testid={`completed-group-count-${sanitizedGroupKey}`}
                      >
                        {group.count}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none transition-colors duration-150",
                        isExpanded
                          ? "border-sky-200 bg-sky-50 text-sky-700"
                          : "border-slate-200 bg-white text-slate-500",
                      )}
                    >
                      {isExpanded ? "Opening" : "Closed"}
                    </span>
                  </button>

                  {isExpanded ? (
                    <div className="space-y-1 pb-1">
                      {visibleResults.map((result) => (
                        <SidebarCardRow
                          key={`${result.kind}:${result.item.card_id}`}
                          item={result.item}
                          badgeLabel={result.badgeLabel}
                          timeText={result.timeText}
                          openSource="completed"
                          shortcutSection="completed"
                          testId={`completed-sidebar-card-${result.kind}-${result.item.card_id}`}
                          className="bg-white"
                          onToggleCheck={cardActions.onToggleCheck}
                          onRenameCardTitle={cardActions.onRenameCardTitle}
                          openCardModal={cardActions.openCardModal}
                          onCardContextMenu={cardActions.onCardContextMenu}
                          onCardContextMenuByKeyboard={cardActions.onCardContextMenuByKeyboard}
                          isContextMenuOpen={cardActions.contextMenuCardId === result.item.card_id}
                          isActive={cardActions.selectionLeadCardId === result.item.card_id || cardActions.activeCardId === result.item.card_id}
                          isSelected={cardActions.selectedCardIds.has(result.item.card_id)}
                          selectionLane="completed"
                          onShiftSelect={cardActions.onShiftSelect}
                          onClearSelection={cardActions.onClearSelection}
                          onActivateCard={cardActions.onActivateCard}
                          activeCardId={cardActions.activeCardId}
                          activeLaneId={cardActions.activeLaneId}
                        />
                      ))}
                      <LoadMoreFooter
                        canLoadMore={canLoadMore}
                        onLoadMore={() => handleGroupLoadMore(group.key, nextVisibleCount)}
                        testId={`sidebar-completed-load-more-${sanitizedGroupKey}`}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function TagsSectionBody({
  tags,
  results,
  selectedTags,
  onTagToggle,
  onTagClear,
  visibleCount,
  onVisibleCountChange,
  ...cardActions
}: {
  tags: readonly TimelineTagSummary[];
  results: readonly TimelineSearchResultItem[];
  selectedTags: readonly string[];
  onTagToggle: (value: string) => void;
  onTagClear: () => void;
} & SharedCardActions & IncrementalVisibilityProps) {
  const resetKey = useMemo(
    () => `${selectedTags.join(",")}::${results.map((result) => result.item.card_id).join(",")}`,
    [results, selectedTags],
  );
  const { sliceEnd, canLoadMore, handleLoadMore } = useIncrementalVisibleCount({
    total: results.length,
    resetKey,
    visibleCount,
    onVisibleCountChange,
  });
  const visibleResults = useMemo(() => results.slice(0, sliceEnd), [results, sliceEnd]);
  const viewState = useMemo(
    () =>
      getTagsSectionViewState({
        selectedTags,
        resultCount: results.length,
      }),
    [results.length, selectedTags],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200/80 bg-slate-50 px-3 py-2">
        <p className="text-[11px] font-medium text-slate-500">
          {viewState.headerText}
        </p>
        <button
          type="button"
          onClick={onTagClear}
          disabled={!viewState.hasSelection}
          className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
        {tags.length === 0 ? (
          <div className="px-1 py-2">
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
              利用できるタグはまだありません
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {viewState.hasSelection ? (
              results.length === 0 ? (
                <div className="px-1 py-1">
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
                    {viewState.helperMessage}
                  </p>
                </div>
              ) : (
                renderSidebarResultRows({
                  results: visibleResults,
                  shortcutSection: "search",
                  openSource: "tag-sidebar",
                  testIdPrefix: "tag-card",
                  footer: (
                    <LoadMoreFooter
                      canLoadMore={canLoadMore}
                      onLoadMore={handleLoadMore}
                      testId="sidebar-tags-load-more"
                    />
                  ),
                  ...cardActions,
                })
              )
            ) : (
              <div className="px-1 py-1">
                <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
                  {viewState.helperMessage}
                </p>
              </div>
            )}

            <div className={clsx("space-y-1", viewState.hasSelection && "border-t border-slate-200/70 pt-3")}>
              {tags.map((tag) => {
                const selected = selectedTags.includes(tag.name);
                return (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() => onTagToggle(tag.name)}
                    data-testid={`desktop-sidebar-tag-${tag.name}`}
                    className={clsx(
                      "flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition",
                      selected
                        ? "border-slate-300 bg-white text-slate-900 shadow-sm"
                        : "border-transparent bg-white/60 text-slate-700 hover:border-slate-200 hover:bg-white"
                    )}
                  >
                    <span className="min-w-0 truncate text-sm font-medium">#{tag.name}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      {tag.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TrashSectionBody({
  items,
  onRestoreTrashCard,
  openCardModal,
  visibleCount,
  onVisibleCountChange,
}: {
  items: readonly TrashCardItem[];
  onRestoreTrashCard: (cardId: string) => Promise<boolean>;
  openCardModal: (shortId: string | null, source: string) => void;
} & IncrementalVisibilityProps) {
  const resetKey = useMemo(
    () => items.map((item) => item.card_id).join(","),
    [items],
  );
  const { sliceEnd, canLoadMore, handleLoadMore } = useIncrementalVisibleCount({
    total: items.length,
    resetKey,
    visibleCount,
    onVisibleCountChange,
  });
  const visibleItems = useMemo(() => items.slice(0, sliceEnd), [items, sliceEnd]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {items.length === 0 ? (
        <div className="px-3 py-4">
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
            ゴミ箱は空です
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
          <div className="min-h-full space-y-2 p-[1px] pb-4 pl-2 pr-2 pt-2">
            {visibleItems.map((item) => (
              <div
                key={item.card_id}
                className="border border-slate-200 bg-white px-2.5 pb-2 pt-4 shadow-sm"
                data-testid={`trash-card-${item.card_id}`}
              >
                <div className="min-w-0">
                  <TimelineCard
                    title={item.title || ""}
                    checked={item.checked}
                    content={item.content ?? null}
                    note={item.excerpt ?? undefined}
                    noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
                    notePreviewLines={2}
                    cardId={item.card_id}
                    statusItems={[
                      {
                        key: "trash",
                        kind: "bucket",
                        label: "TR",
                      },
                    ]}
                    timeText={buildTrashTimeText(item)}
                    timePlacement="out-top"
                    onOpen={() => openCardModal(item.short_id, "trash")}
                    openButtonTestId={`cardOpenButton-trash-${item.card_id}`}
                    showOpenButton
                    onToggleCheck={() => {}}
                    hideLeftColumn
                    className="min-h-0 bg-white"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    残り {Math.max(0, Math.ceil((new Date(item.purge_after_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))} 日
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void onRestoreTrashCard(item.card_id);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-0.5 text-[11px] font-semibold text-slate-700 hover:border-slate-300 hover:text-slate-900"
                  >
                    復元
                  </button>
                </div>
              </div>
            ))}
            <LoadMoreFooter
              canLoadMore={canLoadMore}
              onLoadMore={handleLoadMore}
              testId="sidebar-trash-load-more"
            />
          </div>
        </div>
      )}
    </div>
  );
}
