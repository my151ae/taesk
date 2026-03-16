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

type SidebarSectionKey = "overdue" | "search";
type SidebarSectionTone = "amber" | "slate";

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex h-[18px] w-[18px] items-center justify-center border border-slate-200 bg-white text-slate-600 transition-transform duration-150 ease-out",
        expanded ? "rotate-180" : ""
      )}
      aria-hidden="true"
    >
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
  fillAvailableSpace,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  tone: SidebarSectionTone;
  label: string;
  count: number;
  fillAvailableSpace?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const buttonClassName =
    tone === "amber"
      ? "text-sky-700 hover:bg-sky-50/70"
      : "text-slate-700 hover:bg-white/60";
  const countClassName =
    tone === "amber"
      ? "bg-sky-100 text-sky-700"
      : "bg-slate-100 text-slate-700";

  return (
    <section
      className={clsx(
        "overflow-hidden border-b border-slate-200/80",
        expanded && fillAvailableSpace ? "flex min-h-0 flex-1 flex-col" : ""
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={onToggle}
        className={clsx(
          "flex w-full items-center justify-between px-2 py-2 text-left transition-colors",
          buttonClassName
        )}
        data-testid={`${id}-toggle`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.01em]">
            {label}
          </span>
          <span
            className={clsx("rounded-sm px-1.5 py-0.5 text-[9px] font-semibold", countClassName)}
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
        hidden={!expanded}
        className={clsx(
          "min-h-0 pt-1",
          expanded && fillAvailableSpace ? "flex min-h-0 flex-1 flex-col" : ""
        )}
      >
        {children}
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
        className={clsx("min-h-0", className)}
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
  const [expandedSectionKey, setExpandedSectionKey] = useState<SidebarSectionKey | null>("overdue");

  const handleToggleSection = (key: SidebarSectionKey) => {
    setExpandedSectionKey((prev) => (prev === key ? null : key));
  };

  const sectionDefinitions: Array<{
    key: SidebarSectionKey;
    tone: SidebarSectionTone;
    id: string;
    label: string;
    count: number;
    renderContent: () => React.ReactNode;
  }> = [
    {
      key: "overdue",
      tone: "amber",
      id: "desktop-sidebar-overdue-panel",
      label: "Overdue",
      count: overdueItems.length,
      renderContent: () => (
        <div className="flex min-h-0 flex-1 flex-col">
          {overdueItems.length === 0 ? (
            <div className="px-2 py-3">
              <p className="border border-dashed border-slate-200 bg-white/80 px-3 py-2 text-[10px] text-slate-500">
              未完了の期限超過カードはありません
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
              <div className="min-h-full space-y-1 p-[1px] pl-1 pr-0 pb-3">
              {overdueItems.map((item) => (
                <SidebarCardRow
                  key={item.card_id}
                  item={item}
                  badgeLabel={item.due_bucket?.toUpperCase() ?? "O"}
                  timeText={buildOverdueTimeText(item)}
                  openSource="overdue"
                  testId={`overdue-card-${item.card_id}`}
                  className="bg-white"
                  draggable
                  onToggleCheck={onToggleCheck}
                  openCardModal={openCardModal}
                  onCardContextMenu={onCardContextMenu}
                  onCardContextMenuByKeyboard={onCardContextMenuByKeyboard}
                  isContextMenuOpen={contextMenuCardId === item.card_id}
                />
              ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "search",
      tone: "slate",
      id: "desktop-sidebar-search-panel",
      label: "Search",
      count: searchQuery.trim() ? searchResults.length : 0,
      renderContent: () => (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-1 py-1">
            <div className="border border-slate-200 bg-white px-3 py-1.5">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search cards..."
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              data-testid="desktop-sidebar-search-input"
            />
            </div>
          </div>

          {!searchQuery.trim() ? (
            <div className="px-2 py-3">
              <p className="border border-dashed border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-500">
                キーワードを入れると該当カードをここに一覧表示します
              </p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="px-2 py-3">
              <p className="border border-dashed border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-500">
                一致するカードはありません
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 [scrollbar-gutter:stable]">
              <div className="min-h-full space-y-1 p-[1px] pl-1 pr-0 pb-3">
              {searchResults.map((result) => (
                <SidebarCardRow
                  key={`${result.kind}:${result.item.card_id}`}
                  item={result.item}
                  badgeLabel={result.badgeLabel}
                  timeText={result.timeText}
                  openSource="search"
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
      ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden pl-2 pr-0 py-3">
      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden bg-white">
        {sectionDefinitions.map((section, index) => (
          <div
            key={section.key}
            className={clsx(
              "flex min-h-0 flex-col",
              index > 0 ? "pt-3" : ""
            )}
          >
            <SidebarSection
              id={section.id}
              tone={section.tone}
              label={section.label}
              count={section.count}
              expanded={expandedSectionKey === section.key}
              fillAvailableSpace
              onToggle={() => handleToggleSection(section.key)}
            >
              {section.renderContent()}
            </SidebarSection>
          </div>
        ))}
      </div>
    </div>
  );
}
