"use client";

import clsx from "clsx";

import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import type { ShortcutSection } from "@/app/(board)/_components/timeline/shortcut-bar-registry";
import { buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import type { TimelineSearchResultItem } from "@/app/(board)/_hooks/useTimelineFiltering";
import type { TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";
import type { OverdueSortOrder } from "@/lib/timeline-overdue-sort";

export type SidebarSectionKey = "overdue" | "search";
type SidebarSectionTone = "danger" | "neutral";

export type DesktopSidebarMenuState = {
  expandedSectionKey: SidebarSectionKey | null;
  searchQuery: string;
};

export type DesktopSidebarMenuActions = {
  onExpandedSectionChange: (key: SidebarSectionKey | null) => void;
  onSearchQueryChange: (value: string) => void;
};

export type DesktopSidebarSection =
  | {
      key: "overdue";
      tone: "danger";
      id: string;
      label: string;
      count: number;
      items: readonly TimelineOverdueItem[];
    }
  | {
      key: "search";
      tone: "neutral";
      id: string;
      label: string;
      count: number;
      results: readonly TimelineSearchResultItem[];
    };

type DesktopSidebarMenuProps = {
  state: DesktopSidebarMenuState;
  actions: DesktopSidebarMenuActions;
  sections: readonly DesktopSidebarSection[];
  overdueSortOrder: OverdueSortOrder;
  onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
  allowOverdueDrag: boolean;
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
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

function OverdueSortToggle({
  order,
  onChange,
  testId,
}: {
  order: OverdueSortOrder;
  onChange: (order: OverdueSortOrder) => void;
  testId: string;
}) {
  const nextOrder = order === "oldest" ? "newest" : "oldest";
  const currentLabel = order === "oldest" ? "古い順" : "新しい順";
  const nextLabel = nextOrder === "oldest" ? "古い順" : "新しい順";

  return (
    <button
      type="button"
      data-testid={testId}
      data-order={order}
      onClick={() => onChange(nextOrder)}
      aria-label={`Overdue の並び順を${nextLabel}に切り替え`}
      title={`現在: ${currentLabel}`}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
    >
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={order === "oldest" ? "M6 14l4-4 4 4M10 6v8" : "M6 6l4 4 4-4M10 14V6"} />
      </svg>
      <span>{currentLabel}</span>
    </button>
  );
}

function OverdueIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v5l3 2" />
      <circle cx="12" cy="12" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6l1.5-1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.2-4.2" />
    </svg>
  );
}

function SidebarRailButton({
  id,
  label,
  count,
  tone,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count: number;
  tone: SidebarSectionTone;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const isDanger = tone === "danger";
  const badgeClassName = isDanger
    ? count > 0
      ? "bg-rose-200 text-rose-800"
      : "bg-rose-100 text-rose-700"
    : count > 0
      ? "bg-slate-200 text-slate-800"
      : "bg-slate-200 text-slate-500";

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={id}
      data-focus-group="sidebar"
      data-focus-part="rail-button"
      onClick={onToggle}
      data-testid={`${id}-toggle`}
      className={clsx(
        "group relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        expanded
          ? isDanger
            ? "border-rose-200 bg-white text-rose-700 shadow-[0_10px_24px_-18px_rgba(251,113,133,0.7)] focus-visible:outline-rose-400"
            : "border-slate-300 bg-white text-slate-700 shadow-[0_10px_24px_-18px_rgba(100,116,139,0.45)] focus-visible:outline-slate-400"
          : "border-transparent bg-white/70 text-slate-500 hover:border-slate-200 hover:bg-white hover:text-slate-800 focus-visible:outline-slate-400"
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "absolute left-[-5px] top-1/2 h-4 w-1 -translate-y-1/2 rounded-full transition-opacity duration-150",
          expanded ? (isDanger ? "bg-rose-300 opacity-100" : "bg-slate-300 opacity-100") : "opacity-0"
        )}
      />
      <span className="relative inline-flex items-center justify-center">
        {children}
        <span
          className={clsx(
            "absolute -right-1.5 -top-1.5 min-w-[1rem] rounded-full px-[0.28rem] py-[0.18rem] text-center text-[8px] font-semibold leading-none shadow-sm",
            badgeClassName
          )}
          data-testid={`${id}-count`}
        >
          {count}
        </span>
      </span>
    </button>
  );
}

function SidebarCardRow({
  item,
  badgeLabel,
  timeText,
  openSource,
  shortcutSection,
  testId,
  className,
  draggable = false,
  onToggleCheck,
  openCardModal,
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
}: {
  item: {
    card_id: string;
    title: string;
    checked: boolean;
    checklist?: TimelineOverdueItem["checklist"];
    content?: TimelineOverdueItem["content"];
    excerpt?: string | null;
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
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  isContextMenuOpen: boolean;
  isActive?: boolean;
  isSelected?: boolean;
  selectionLane?: string;
  onShiftSelect?: (args: {
    cardId: string;
    laneId: string;
    activeCardId: string | null;
    activeLaneId: string | null;
  }) => void;
  onClearSelection?: () => void;
  onActivateCard?: (cardId: string, laneId: string) => void;
  activeCardId?: string | null;
  activeLaneId?: string | null;
}) {
  const card = (
    <div
      className="relative min-w-0 pt-4 has-[:focus]:z-10"
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
        badgeLabel={badgeLabel}
        timeText={timeText}
        timePlacement="out-top"
        note={item.excerpt ?? undefined}
        noteClampClass={TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS}
        notePreviewLines={3}
        onOpen={() => openCardModal(item.short_id, openSource)}
        openButtonTestId={`cardOpenButton-${openSource}-${item.card_id}`}
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
      />
    </div>
  );

  if (!draggable) return card;

  return (
    <DraggableCard
      id={`overdue:${item.card_id}`}
      data={{ kind: "overdue", cardId: item.card_id, item }}
      disabled={isContextMenuOpen}
    >
      {card}
    </DraggableCard>
  );
}

function buildOverdueTimeText(item: TimelineOverdueItem) {
  return buildTimelineCardTimeText(item, {
    includeDate: true,
    includeDuration: true,
  });
}

export function DesktopSidebarMenu({
  state,
  actions,
  sections,
  overdueSortOrder,
  onOverdueSortOrderChange,
  allowOverdueDrag,
  openCardModal,
  onToggleCheck,
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
}: DesktopSidebarMenuProps) {
  const handleToggleSection = (key: SidebarSectionKey) => {
    actions.onExpandedSectionChange(state.expandedSectionKey === key ? null : key);
  };

  const getSectionIcon = (key: SidebarSectionKey) => {
    switch (key) {
      case "overdue":
        return <OverdueIcon />;
      case "search":
        return <SearchIcon />;
      default:
        return null;
    }
  };

  const renderSectionContent = (section: DesktopSidebarSection) => {
    if (section.key === "overdue") {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {!allowOverdueDrag ? (
            <div className="px-3 pt-3">
              <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                List表示中はドラッグ移動を停止しています
              </p>
            </div>
          ) : null}
          {section.items.length === 0 ? (
            <div className="px-3 py-4">
              <p className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/70 px-3 py-3 text-[11px] text-rose-700/80">
                未完了の期限超過カードはありません
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200">
              <div className="min-h-full space-y-1 p-[1px] pb-4 pl-2 pr-2">
                {section.items.map((item) => (
                  <SidebarCardRow
                    key={item.card_id}
                    item={item}
                    badgeLabel={item.due_bucket?.toUpperCase() ?? "O"}
                    timeText={buildOverdueTimeText(item)}
                    openSource="overdue"
                    shortcutSection="overdue"
                    testId={`overdue-card-${item.card_id}`}
                    className={allowOverdueDrag ? "bg-white" : "bg-slate-50"}
                    draggable={allowOverdueDrag}
                    onToggleCheck={onToggleCheck}
                    openCardModal={openCardModal}
                    onCardContextMenu={onCardContextMenu}
                    onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                    isContextMenuOpen={contextMenuCardId === item.card_id}
                    isActive={selectionLeadCardId === item.card_id || activeCardId === item.card_id}
                    isSelected={selectedCardIds.has(item.card_id)}
                    selectionLane="overdue"
                    onShiftSelect={onShiftSelect}
                    onClearSelection={onClearSelection}
                    onActivateCard={onActivateCard}
                    activeCardId={activeCardId}
                    activeLaneId={activeLaneId}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-2 py-2">
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <input
                type="text"
                value={state.searchQuery}
                onChange={(event) => actions.onSearchQueryChange(event.target.value)}
                placeholder="Search cards..."
                className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                data-testid="desktop-sidebar-search-input"
                data-shortcut-scope="board"
                data-shortcut-region="sidebar"
                data-shortcut-section="search"
              />
          </div>
        </div>

        {!state.searchQuery.trim() ? (
          <div className="px-3 py-4">
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
              キーワードを入れると該当カードをここに一覧表示します
            </p>
          </div>
        ) : section.results.length === 0 ? (
          <div className="px-3 py-4">
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
              一致するカードはありません
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200">
            <div className="min-h-full space-y-1 p-[1px] pb-4 pl-2 pr-2">
              {section.results.map((result) => (
                <SidebarCardRow
                  key={`${result.kind}:${result.item.card_id}`}
                  item={result.item}
                  badgeLabel={result.badgeLabel}
                  timeText={result.timeText}
                  openSource="search"
                  shortcutSection="search"
                  testId={`search-card-${result.kind}-${result.item.card_id}`}
                  className="bg-white"
                  onToggleCheck={onToggleCheck}
                  openCardModal={openCardModal}
                  onCardContextMenu={onCardContextMenu}
                  onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                  isContextMenuOpen={contextMenuCardId === result.item.card_id}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.94))]">
      <div className="flex w-[2.5rem] shrink-0 flex-col items-center gap-2 border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.8))] px-0.5 py-2.5">
        <div className="h-0.5" aria-hidden="true" />
        {sections.map((section) => (
          <SidebarRailButton
            key={section.key}
            id={section.id}
            label={section.label}
            count={section.count}
            tone={section.tone}
            expanded={state.expandedSectionKey === section.key}
            onToggle={() => handleToggleSection(section.key)}
          >
            {getSectionIcon(section.key)}
          </SidebarRailButton>
        ))}
      </div>

      {state.expandedSectionKey ? (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {sections.map((section) => {
            const expanded = state.expandedSectionKey === section.key;
            const isDanger = section.tone === "danger";

            return (
              <section
                key={section.key}
                className={clsx("min-h-0 min-w-0 flex-1 flex-col overflow-hidden", expanded ? "flex" : "hidden")}
                aria-hidden={!expanded}
              >
                <div className="relative flex h-8 items-center justify-between border-b border-slate-200/80 px-3">
                  <div className="flex min-w-0 items-center gap-2 leading-tight">
                    <h2 className="truncate text-sm font-semibold leading-tight text-slate-800">{section.label}</h2>
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight",
                        isDanger ? "bg-rose-200 text-rose-800" : "bg-slate-200 text-slate-700"
                      )}
                    >
                      {section.count}
                    </span>
                  </div>
                  {section.key === "overdue" ? (
                    <OverdueSortToggle
                      order={overdueSortOrder}
                      onChange={onOverdueSortOrderChange}
                      testId="desktop-sidebar-overdue-sort-toggle"
                    />
                  ) : null}
                </div>

                <div
                  id={section.id}
                  data-testid={section.id}
                  aria-hidden={!expanded}
                  hidden={!expanded}
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                  {renderSectionContent(section)}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
