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
type SidebarSectionTone = "danger" | "neutral";

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
      ? "bg-rose-600 text-white"
      : "bg-rose-100 text-rose-600"
    : count > 0
      ? "bg-slate-700 text-white"
      : "bg-slate-200 text-slate-500";

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={id}
      onClick={onToggle}
      data-testid={`${id}-toggle`}
      className={clsx(
        "group relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        expanded
          ? isDanger
            ? "border-rose-200 bg-white text-rose-700 shadow-[0_10px_24px_-18px_rgba(225,29,72,0.9)] focus-visible:outline-rose-500"
            : "border-sky-200 bg-white text-sky-700 shadow-[0_10px_24px_-18px_rgba(14,165,233,0.9)] focus-visible:outline-sky-500"
          : "border-transparent bg-white/70 text-slate-500 hover:border-slate-200 hover:bg-white hover:text-slate-800 focus-visible:outline-slate-400"
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "absolute left-[-5px] top-1/2 h-4 w-1 -translate-y-1/2 rounded-full transition-opacity duration-150",
          expanded ? (isDanger ? "bg-rose-500 opacity-100" : "bg-sky-500 opacity-100") : "opacity-0"
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
    icon: React.ReactNode;
    renderContent: () => React.ReactNode;
  }> = [
    {
      key: "overdue",
      tone: "danger",
      id: "desktop-sidebar-overdue-panel",
      label: "Overdue",
      count: overdueItems.length,
      icon: <OverdueIcon />,
      renderContent: () => (
        <div className="flex min-h-0 flex-1 flex-col">
          {overdueItems.length === 0 ? (
            <div className="px-3 py-4">
              <p className="rounded-2xl border border-dashed border-rose-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
                未完了の期限超過カードはありません
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200">
              <div className="min-h-full space-y-1 p-[1px] pb-4 pl-2 pr-2">
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
      tone: "neutral",
      id: "desktop-sidebar-search-panel",
      label: "Search",
      count: searchQuery.trim() ? searchResults.length : 0,
      icon: <SearchIcon />,
      renderContent: () => (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-2 py-2">
            <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
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
            <div className="px-3 py-4">
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
                キーワードを入れると該当カードをここに一覧表示します
              </p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="px-3 py-4">
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white/90 px-3 py-3 text-[11px] text-slate-500">
                一致するカードはありません
              </p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200">
              <div className="min-h-full space-y-1 p-[1px] pb-4 pl-2 pr-2">
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
    <div className="flex h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.94))]">
      <div className="flex w-[2.5rem] shrink-0 flex-col items-center gap-2 border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.8))] px-0.5 py-2.5">
        <div className="h-0.5" aria-hidden="true" />
        {sectionDefinitions.map((section) => (
          <SidebarRailButton
            key={section.key}
            id={section.id}
            label={section.label}
            count={section.count}
            tone={section.tone}
            expanded={expandedSectionKey === section.key}
            onToggle={() => handleToggleSection(section.key)}
          >
            {section.icon}
          </SidebarRailButton>
        ))}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {sectionDefinitions.map((section) => {
          const expanded = expandedSectionKey === section.key;
          const isDanger = section.tone === "danger";

          return (
            <section
              key={section.key}
              className={clsx("min-h-0 flex-1 flex-col overflow-hidden", expanded ? "flex" : "hidden")}
              aria-hidden={!expanded}
            >
              <div className="relative flex min-h-10 items-center justify-between border-b border-slate-200/80 px-3 py-1.5">
                <span className="pointer-events-none absolute right-3 top-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                  Panel
                </span>
                <div className="flex min-w-0 items-center gap-2 leading-tight">
                  <h2 className="truncate text-sm font-semibold leading-tight text-slate-800">{section.label}</h2>
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight",
                      isDanger ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-700"
                    )}
                  >
                    {section.count}
                  </span>
                </div>
              </div>

              <div
                id={section.id}
                data-testid={section.id}
                aria-hidden={!expanded}
                hidden={!expanded}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                {section.renderContent()}
              </div>
            </section>
          );
        })}

        {!expandedSectionKey ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-[18rem] rounded-3xl border border-dashed border-slate-300/90 bg-white/75 px-5 py-6 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Sidebar</p>
              <p className="mt-2 text-sm font-medium text-slate-700">左のアイコンを押すとパネルを表示します</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Overdue は赤バッジ、Search は該当件数をそのまま確認できます。</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
