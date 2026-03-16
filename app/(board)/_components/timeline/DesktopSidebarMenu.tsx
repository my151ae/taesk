"use client";

import clsx from "clsx";
import { useState } from "react";

import { DraggableCard } from "@/app/(board)/_components/timeline/TimelineDraggableCard";
import {
  TimelineCard,
  TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS,
} from "@/app/(board)/_components/timeline/TimelineCard";
import { buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import type { TimelineSearchResultItem } from "@/app/(board)/_hooks/useTimelineFiltering";
import type { TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";

type DesktopSidebarMenuProps = {
  overdueItems: readonly TimelineOverdueItem[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchResults: readonly TimelineSearchResultItem[];
  openCardModal: (shortId: string | null, source: string) => void;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  contextMenuCardId: string | null;
};

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 transition-transform duration-150 ease-out",
        expanded ? "rotate-180" : ""
      )}
      aria-hidden="true"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}

function SidebarSection({
  id,
  tone,
  label,
  count,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  tone: "amber" | "slate";
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const toneClassName =
    tone === "amber"
      ? "border-amber-200 bg-amber-50/80 text-amber-900 hover:bg-amber-100/70"
      : "border-slate-200 bg-white/90 text-slate-800 hover:bg-slate-50";
  const countClassName =
    tone === "amber"
      ? "bg-white/90 text-amber-800"
      : "bg-slate-100 text-slate-700";

  return (
    <section className="overflow-hidden rounded-xl">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={onToggle}
        className={clsx(
          "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left shadow-sm transition-colors",
          toneClassName
        )}
        data-testid={`${id}-toggle`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            {label}
          </span>
          <span
            className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm", countClassName)}
            data-testid={`${id}-count`}
          >
            {count}
          </span>
        </div>
        <Chevron expanded={expanded} />
      </button>

      <div
        id={id}
        data-testid={id}
        aria-hidden={!expanded}
        className="overflow-hidden transition-[max-height,opacity] duration-150 ease-out"
        style={{
          maxHeight: expanded ? "2000px" : "0px",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="pt-2">{children}</div>
      </div>
    </section>
  );
}

function SidebarCardRow({
  item,
  badgeLabel,
  timeText,
  openSource,
  testId,
  className,
  draggable = false,
  onToggleCheck,
  openCardModal,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  isContextMenuOpen,
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
  testId: string;
  className?: string;
  draggable?: boolean;
  onToggleCheck: (cardId: string, checked: boolean) => void;
  openCardModal: (shortId: string | null, source: string) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onCardContextMenuByKeyboard: (cardId: string, rect: DOMRect) => void;
  isContextMenuOpen: boolean;
}) {
  const card = (
    <div
      className="min-w-0"
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
        className={clsx("min-h-0 border-slate-200", className)}
        onOpenContextMenu={(rect) => onCardContextMenuByKeyboard(item.card_id, rect)}
        focusGroup="bucket"
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
  overdueItems,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  openCardModal,
  onToggleCheck,
  onCardContextMenu,
  onCardContextMenuByKeyboard,
  contextMenuCardId,
}: DesktopSidebarMenuProps) {
  const [overdueExpanded, setOverdueExpanded] = useState(true);
  const [searchExpanded, setSearchExpanded] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-2 py-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200">
      <div className="px-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">Menu</p>
        <p className="mt-1 text-[10px] text-slate-500">Overdue と Search をここで開閉できます</p>
      </div>

      <SidebarSection
        id="desktop-sidebar-overdue-panel"
        tone="amber"
        label="Overdue"
        count={overdueItems.length}
        expanded={overdueExpanded}
        onToggle={() => setOverdueExpanded((prev) => !prev)}
      >
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-2">
          {overdueItems.length === 0 ? (
            <p className="rounded-md border border-dashed border-amber-200 bg-white/70 px-3 py-2 text-[10px] text-amber-700/80">
              未完了の期限超過カードはありません
            </p>
          ) : (
            overdueItems.map((item) => (
              <SidebarCardRow
                key={item.card_id}
                item={item}
                badgeLabel={item.due_bucket?.toUpperCase() ?? "O"}
                timeText={buildOverdueTimeText(item)}
                openSource="overdue"
                testId={`overdue-card-${item.card_id}`}
                className="bg-amber-50/80"
                draggable
                onToggleCheck={onToggleCheck}
                openCardModal={openCardModal}
                onCardContextMenu={onCardContextMenu}
                onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                isContextMenuOpen={contextMenuCardId === item.card_id}
              />
            ))
          )}
        </div>
      </SidebarSection>

      <SidebarSection
        id="desktop-sidebar-search-panel"
        tone="slate"
        label="Search"
        count={searchQuery.trim() ? searchResults.length : 0}
        expanded={searchExpanded}
        onToggle={() => setSearchExpanded((prev) => !prev)}
      >
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search cards..."
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              data-testid="desktop-sidebar-search-input"
            />
          </div>

          {!searchQuery.trim() ? (
            <p className="rounded-md border border-dashed border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-500">
              キーワードを入れると該当カードをここに一覧表示します
            </p>
          ) : searchResults.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-500">
              一致するカードはありません
            </p>
          ) : (
            searchResults.map((result) => (
              <SidebarCardRow
                key={`${result.kind}:${result.item.card_id}`}
                item={result.item}
                badgeLabel={result.badgeLabel}
                timeText={result.timeText}
                openSource="search"
                testId={`search-card-${result.kind}-${result.item.card_id}`}
                className="bg-white/90"
                onToggleCheck={onToggleCheck}
                openCardModal={openCardModal}
                onCardContextMenu={onCardContextMenu}
                onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                isContextMenuOpen={contextMenuCardId === result.item.card_id}
              />
            ))
          )}
        </div>
      </SidebarSection>
    </div>
  );
}
