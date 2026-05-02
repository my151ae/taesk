"use client";

import { DndContext, DragOverlay, MeasuringStrategy } from "@dnd-kit/core";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { CardModal } from "@/app/components/CardModal";
import TimelineBoardHeader from "@/app/(board)/_components/timeline/TimelineBoardHeader";
import TimelineBoardDialogs from "@/app/(board)/_components/timeline/TimelineBoardDialogs";
import {
  DesktopTimelineToolbar,
  DesktopTimelineView,
  type HorizontalStepRequest,
} from "@/app/(board)/_components/timeline/DesktopTimelineView";
import {
  DesktopListToolbar,
  DesktopListView,
} from "@/app/(board)/_components/timeline/DesktopListView";
import {
  DesktopMonthToolbar,
  DesktopMonthView,
} from "@/app/(board)/_components/timeline/DesktopMonthView";
import MobileTimelineView from "@/app/(board)/_components/timeline/MobileTimelineView";
import MobileListView from "@/app/(board)/_components/timeline/MobileListView";
import MobileMonthView from "@/app/(board)/_components/timeline/MobileMonthView";
import ParentChildPanel from "@/app/(board)/_components/timeline/ParentChildPanel";
import { SidebarSectionShell } from "@/app/(board)/_components/timeline/SidebarSectionShell";
import { DesktopSidebarMenu } from "@/app/(board)/_components/timeline/DesktopSidebarMenu";
import {
  CompletedSectionBody,
  OverdueSectionBody,
  ParentCardsSectionBody,
  SearchSectionBody,
  TagsSectionBody,
  TrashSectionBody,
} from "@/app/(board)/_components/timeline/TimelineLeftPanelShared";
import {
  NotificationsSectionActions,
  NotificationsSectionBody,
} from "@/app/(board)/_components/timeline/TimelineNotificationsShared";
import { TimelineDragOverlayCard } from "@/app/(board)/_components/timeline/TimelineDragOverlayCard";
import { ShortcutsModal } from "@/app/(board)/_components/timeline/ShortcutsModal";
import { StatusShortcutBar } from "@/app/(board)/_components/timeline/StatusShortcutBar";
import { CardContextMenu } from "@/app/(board)/_components/timeline/CardContextMenu";
import { handleTimelineCardArrowFocus } from "@/app/(board)/_components/timeline/timeline-focus-navigation";
import {
  createEmptyShortcutBarPayload,
  getShortcutContextFromTarget,
  resolveShortcutBarPayload,
  type ShortcutBarConfig,
  type ShortcutContextDescriptor,
} from "@/app/(board)/_components/timeline/shortcut-bar-registry";
import { bucketsFirstCollisionDetection } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { SidebarSectionKey } from "@/app/(board)/_components/timeline/sidebar-section-types";
import type { OverdueSortOrder } from "@/lib/timeline-overdue-sort";

type HeaderProps = ComponentProps<typeof TimelineBoardHeader>;
type DialogsProps = ComponentProps<typeof TimelineBoardDialogs>;
type TimelineToolbarProps = ComponentProps<typeof DesktopTimelineToolbar>;
type TimelineBodyProps = ComponentProps<typeof DesktopTimelineView>;
type ListToolbarProps = ComponentProps<typeof DesktopListToolbar>;
type ListBodyProps = ComponentProps<typeof DesktopListView>;
type MonthToolbarProps = ComponentProps<typeof DesktopMonthToolbar>;
type MonthBodyProps = ComponentProps<typeof DesktopMonthView>;
type MobileTimelineProps = ComponentProps<typeof MobileTimelineView>;
type MobileTimelineBaseProps = MobileTimelineProps;
type MobileListProps = ComponentProps<typeof MobileListView>;
type MobileMonthProps = ComponentProps<typeof MobileMonthView>;
type SidebarMenuProps = ComponentProps<typeof DesktopSidebarMenu>;
type SidebarMenuBaseProps = Omit<
  SidebarMenuProps,
  "overdueSortOrder" | "onOverdueSortOrderChange"
>;
type ShortcutsModalProps = ComponentProps<typeof ShortcutsModal>;
type CardModalProps = ComponentProps<typeof CardModal>;
type ParentChildPanelProps = ComponentProps<typeof ParentChildPanel>;
type CardContextMenuProps = ComponentProps<typeof CardContextMenu>;
type CardPeekMode = "compact" | "standard" | "wide" | "full";

type ParseResult = { ok: true } | { ok: false; code: string };
type TabItem = { key: "timeline" | "list" | "month"; label: string };
type MobileHeaderAccessory =
  | {
      kind: "overdue-sort";
      order: OverdueSortOrder;
      onChange: (order: OverdueSortOrder) => void;
    }
  | null;

export type TimelineBoardScreenProps = {
  parseResult: ParseResult;
  onResetInvalidUrl: () => void;
  onMoveToCanonicalUrl: () => void;
  headerProps: HeaderProps;
  desktop: {
    activeView: "timeline" | "list" | "month";
    timelineTransitionPending: boolean;
    tabItems: TabItem[];
    onTabChange: (key: "timeline" | "list" | "month") => void;
    leftPanelProps: SidebarMenuBaseProps;
    overdueSortOrder: OverdueSortOrder;
    onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
    timelineToolbarProps: TimelineToolbarProps;
    timelineViewProps: TimelineBodyProps;
    listToolbarProps: ListToolbarProps;
    listViewProps: ListBodyProps;
    monthToolbarProps: MonthToolbarProps;
    monthViewProps: MonthBodyProps;
    dndProps: Pick<
      TimelineBodyProps,
      "sensors" | "handleDragStart" | "handleDragMove" | "handleDragEnd" | "handleDragCancel"
    >;
    overlayProps: {
      overlayCardData: ComponentProps<typeof TimelineDragOverlayCard>["overlayCardData"];
      overlayTimelineEvent: ComponentProps<typeof TimelineDragOverlayCard>["overlayTimelineEvent"];
      overlayBucketCard: ComponentProps<typeof TimelineDragOverlayCard>["overlayBucketCard"];
      overlayOverdueCard: ComponentProps<typeof TimelineDragOverlayCard>["overlayOverdueCard"];
    };
  };
  mobile: {
    viewMode: "timeline" | "list" | "month";
    timelineTransitionPending: boolean;
    timelineProps: MobileTimelineBaseProps;
    listProps: MobileListProps;
    monthProps: MobileMonthProps;
    leftPanelProps: SidebarMenuBaseProps;
    selectorPresentation: {
      currentSection: SidebarSectionKey;
      selectorItems: Array<{ key: SidebarSectionKey; label: string }>;
      triggerLabel: string;
      onSelect: (key: SidebarSectionKey) => void;
    };
    currentSectionChrome: {
      title: string;
      count: number;
      tone: "danger" | "neutral";
      headerAccessory: MobileHeaderAccessory;
      secondaryActionsKind: "notifications" | null;
    };
  };
  dialogsProps: DialogsProps;
  shortcutsProps: ShortcutsModalProps;
  shortcutBarProps: ShortcutBarConfig;
  modalProps: CardModalProps | null;
  parentPanelProps: ParentChildPanelProps | null;
  cardModalError: string | null;
  contextMenu:
    | {
        open: true;
        cardId: string;
        x: number;
        y: number;
        items: CardContextMenuProps["items"];
        onClose: CardContextMenuProps["onClose"];
      }
    | {
        open: false;
        cardId: string | null;
      };
  bucketCreateMenu:
    | {
        open: true;
        x: number;
        y: number;
        items: CardContextMenuProps["items"];
        onClose: CardContextMenuProps["onClose"];
      }
    | {
        open: false;
      };
};

function TimelineLoadingPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50/40">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-500 shadow-sm">
        Timeline を読み込み中...
      </div>
    </div>
  );
}

const CARD_PEEK_WIDTHS: Record<Exclude<CardPeekMode, "full">, number> = {
  compact: 360,
  standard: 720,
  wide: 1040,
};
const CARD_PEEK_STORAGE_KEY = "taesk.cardPeek.layout.v1";
const CARD_PEEK_SNAP_TOLERANCE = 48;
const CARD_PEEK_MIN_WIDTH = 320;
const CARD_PEEK_MAX_WIDTH = 1280;

const clampPeekWidth = (width: number) => Math.min(CARD_PEEK_MAX_WIDTH, Math.max(CARD_PEEK_MIN_WIDTH, Math.round(width)));

const resolveModeFromWidth = (width: number): Exclude<CardPeekMode, "full"> | null => {
  const candidates: Array<{ mode: Exclude<CardPeekMode, "full">; width: number }> = [
    { mode: "compact", width: CARD_PEEK_WIDTHS.compact },
    { mode: "standard", width: CARD_PEEK_WIDTHS.standard },
    { mode: "wide", width: CARD_PEEK_WIDTHS.wide },
  ];
  const nearest = candidates.reduce((best, candidate) =>
    Math.abs(candidate.width - width) < Math.abs(best.width - width) ? candidate : best,
  );
  return Math.abs(nearest.width - width) <= CARD_PEEK_SNAP_TOLERANCE ? nearest.mode : null;
};

export default function TimelineBoardScreen({
  parseResult,
  onResetInvalidUrl,
  onMoveToCanonicalUrl,
  headerProps,
  desktop,
  mobile,
  dialogsProps,
  shortcutsProps,
  shortcutBarProps,
  modalProps,
  parentPanelProps,
  cardModalError,
  contextMenu,
  bucketCreateMenu,
}: TimelineBoardScreenProps) {
  const desktopScopeRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const [desktopShortcutDescriptor, setDesktopShortcutDescriptor] = useState<ShortcutContextDescriptor | null>(null);
  const [desktopHorizontalStepRequest, setDesktopHorizontalStepRequest] = useState<HorizontalStepRequest>(null);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const cardPeekEnabled = process.env.NEXT_PUBLIC_CARD_PEEK_V2 !== "false";
  const [cardPeekMode, setCardPeekMode] = useState<CardPeekMode>("standard");
  const [cardPeekWidth, setCardPeekWidth] = useState(CARD_PEEK_WIDTHS.standard);
  const previousPeekLayoutRef = useRef<{ mode: CardPeekMode; width: number }>({
    mode: "standard",
    width: CARD_PEEK_WIDTHS.standard,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(CARD_PEEK_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { mode?: CardPeekMode; widthPx?: number };
      if (parsed.mode === "compact" || parsed.mode === "standard" || parsed.mode === "wide" || parsed.mode === "full") {
        setCardPeekMode(parsed.mode);
      }
      if (typeof parsed.widthPx === "number" && Number.isFinite(parsed.widthPx)) {
        setCardPeekWidth(clampPeekWidth(parsed.widthPx));
      }
    } catch {
      window.localStorage.removeItem(CARD_PEEK_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!cardPeekEnabled || !modalProps || typeof window === "undefined") return;
    window.localStorage.setItem(
      CARD_PEEK_STORAGE_KEY,
      JSON.stringify({ mode: cardPeekMode, widthPx: cardPeekWidth }),
    );
  }, [cardPeekEnabled, cardPeekMode, cardPeekWidth, modalProps]);

  const handleCardPeekModeChange = useCallback((mode: CardPeekMode) => {
    setCardPeekMode((currentMode) => {
      if (mode === "full") {
        previousPeekLayoutRef.current = { mode: currentMode, width: cardPeekWidth };
        return "full";
      }
      if (currentMode === "full" && mode === "standard") {
        const previous = previousPeekLayoutRef.current;
        setCardPeekWidth(previous.width);
        return previous.mode === "full" ? "standard" : previous.mode;
      }
      setCardPeekWidth(CARD_PEEK_WIDTHS[mode]);
      return mode;
    });
  }, [cardPeekWidth]);

  const handleCardPeekResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (cardPeekMode === "full") return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = cardPeekWidth;
    let latestWidth = startWidth;

    const handleMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampPeekWidth(startWidth + startX - moveEvent.clientX);
      latestWidth = nextWidth;
      setCardPeekWidth(nextWidth);
    };

    const handleUp = () => {
      const snappedMode = resolveModeFromWidth(latestWidth);
      if (snappedMode) {
        setCardPeekMode(snappedMode);
        setCardPeekWidth(CARD_PEEK_WIDTHS[snappedMode]);
      }
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [cardPeekMode, cardPeekWidth]);

  const setBoardShortcutContextFromTarget = useCallback((target: EventTarget | null) => {
    const nextDescriptor = getShortcutContextFromTarget(target);
    setDesktopShortcutDescriptor(nextDescriptor?.scope === "board" ? nextDescriptor : null);
  }, []);

  const syncBoardShortcutContextFromActiveElement = useCallback(() => {
    if (modalProps) {
      setDesktopShortcutDescriptor(null);
      return;
    }
    const scope = desktopScopeRef.current;
    const activeElement = document.activeElement;
    if (!(scope && activeElement instanceof Element) || !scope.contains(activeElement)) {
      setDesktopShortcutDescriptor(null);
      return;
    }
    setBoardShortcutContextFromTarget(activeElement);
  }, [modalProps, setBoardShortcutContextFromTarget]);

  useEffect(() => {
    syncBoardShortcutContextFromActiveElement();
  }, [modalProps, syncBoardShortcutContextFromActiveElement]);

  const boardShortcutPayload = useMemo(() => {
    if (modalProps) return createEmptyShortcutBarPayload("board");
    if (contextMenu.open && contextMenu.cardId) {
      const sourceCard = typeof document !== "undefined"
        ? document.querySelector(`[data-card-id="${contextMenu.cardId}"]`)
        : null;
      const sourceDescriptor = getShortcutContextFromTarget(sourceCard);
      return resolveShortcutBarPayload({
        scope: "context-menu",
        region: sourceDescriptor?.region ?? "main-panel",
        section: sourceDescriptor?.section ?? null,
        view: sourceDescriptor?.view ?? desktop.activeView,
        part: sourceDescriptor?.part ?? "card",
        state: "active",
      }) ?? createEmptyShortcutBarPayload("context-menu");
    }
    if (bucketCreateMenu.open) {
      return resolveShortcutBarPayload({
        scope: "context-menu",
        region: "main-panel",
        view: desktop.activeView,
        part: "card",
        state: "active",
      }) ?? createEmptyShortcutBarPayload("context-menu");
    }
    if (!desktopShortcutDescriptor) return createEmptyShortcutBarPayload("board");
    return resolveShortcutBarPayload({
      ...desktopShortcutDescriptor,
      state: "active",
    }) ?? createEmptyShortcutBarPayload("board");
  }, [bucketCreateMenu.open, contextMenu.cardId, contextMenu.open, desktop.activeView, desktopShortcutDescriptor, modalProps]);
  const activeTabClassName =
    "inline-flex h-6 shrink-0 items-center rounded-full bg-slate-200 px-3 text-[11px] font-semibold text-slate-800 shadow-sm ring-1 ring-slate-300";
  const inactiveTabClassName =
    "inline-flex h-6 shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 hover:bg-slate-50";
  const desktopSidebarExpanded = desktop.leftPanelProps.state.expandedSectionKey !== null;
  const desktopSidebarWidth = desktopSidebarExpanded ? "clamp(252px, 19vw, 292px)" : "2.5rem";

  const renderDesktopShell = useCallback(
    (content: ReactNode) => (
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-2xl border border-slate-200 border-t-slate-200 bg-white shadow-sm">
        <aside
          data-testid="desktop-sidebar-shell"
          className="flex min-h-0 shrink-0 self-stretch flex-col overflow-hidden border-r border-slate-200 bg-slate-50/70 transition-[width] duration-200 ease-out"
          style={{ width: desktopSidebarWidth }}
        >
          <DesktopSidebarMenu
            {...desktop.leftPanelProps}
            overdueSortOrder={desktop.overdueSortOrder}
            onOverdueSortOrderChange={desktop.onOverdueSortOrderChange}
          />
        </aside>

        <section data-testid="desktop-main-panel" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {content}
        </section>
      </div>
    ),
    [desktop.leftPanelProps, desktop.onOverdueSortOrderChange, desktop.overdueSortOrder, desktopSidebarWidth]
  );
  const headerToggleLabel = isHeaderCollapsed ? "メインヘッダーを表示" : "メインヘッダーを隠す";
  const [showMobileSelector, setShowMobileSelector] = useState(false);
  const [isMobilePanelCollapsed, setIsMobilePanelCollapsed] = useState(true);
  const mobileSelectorRef = useRef<HTMLDivElement | null>(null);
  const previousMobileSectionRef = useRef<SidebarSectionKey | null>(null);
  const renderDesktopTabs = () => (
    <div className="border-b border-slate-100 bg-white px-3">
      <div className="flex h-8 items-center gap-2 overflow-x-auto">
        {desktop.tabItems.map((item) => {
          const isActive = item.key === desktop.activeView;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => desktop.onTabChange(item.key)}
              data-focus-group="toolbar"
              data-focus-part="control"
              className={isActive ? activeTabClassName : inactiveTabClassName}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  useEffect(() => {
    if (!showMobileSelector) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (mobileSelectorRef.current?.contains(target)) return;
      setShowMobileSelector(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [showMobileSelector]);

  const currentMobileSection = useMemo(
    () => mobile.leftPanelProps.sections.find((section) => section.key === mobile.selectorPresentation.currentSection) ?? null,
    [mobile.leftPanelProps.sections, mobile.selectorPresentation.currentSection]
  );

  const desktopTimelineToolbarProps = useMemo(() => {
    if (desktop.activeView !== "timeline") return desktop.timelineToolbarProps;
    return {
      ...desktop.timelineToolbarProps,
      onPrevDay: () => {
        setDesktopHorizontalStepRequest({ id: ++requestIdRef.current, direction: "prev" });
      },
      onNextDay: () => {
        setDesktopHorizontalStepRequest({ id: ++requestIdRef.current, direction: "next" });
      },
      onToday: () => {
        setDesktopHorizontalStepRequest({ id: ++requestIdRef.current, direction: "today" });
      },
      onPrevDayRange: () => {
        setDesktopHorizontalStepRequest({ id: ++requestIdRef.current, direction: "prevRange" });
      },
      onNextDayRange: () => {
        setDesktopHorizontalStepRequest({ id: ++requestIdRef.current, direction: "nextRange" });
      },
    };
  }, [desktop.activeView, desktop.timelineToolbarProps]);

  const desktopTimelineViewProps = useMemo(
    () => ({
      ...desktop.timelineViewProps,
      horizontalStepRequest: desktopHorizontalStepRequest,
      onHorizontalStepRequestConsumed: (requestId: number) => {
        setDesktopHorizontalStepRequest((current) => (current?.id === requestId ? null : current));
      },
    }),
    [desktop.timelineViewProps, desktopHorizontalStepRequest],
  );

  useEffect(() => {
    const previousSection = previousMobileSectionRef.current;
    if (previousSection !== null && previousSection !== mobile.selectorPresentation.currentSection) {
      setIsMobilePanelCollapsed(false);
    }
    previousMobileSectionRef.current = mobile.selectorPresentation.currentSection;
  }, [mobile.selectorPresentation.currentSection]);

  const mobileHeaderAccessory = useMemo(() => {
    if (mobile.currentSectionChrome.headerAccessory?.kind !== "overdue-sort") {
      return null;
    }

    return (
      <button
        type="button"
        data-testid="mobile-overdue-sort-toggle"
        data-order={mobile.currentSectionChrome.headerAccessory.order}
        onClick={() =>
          mobile.currentSectionChrome.headerAccessory?.onChange(
            mobile.currentSectionChrome.headerAccessory.order === "oldest" ? "newest" : "oldest"
          )
        }
        aria-label={`Overdue の並び順を${
          mobile.currentSectionChrome.headerAccessory.order === "oldest" ? "新しい順" : "古い順"
        }に切り替え`}
        className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2 py-1 text-[10px] font-semibold text-rose-700"
      >
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d={mobile.currentSectionChrome.headerAccessory.order === "oldest" ? "M6 14l4-4 4 4M10 6v8" : "M6 6l4 4 4-4M10 14V6"}
          />
        </svg>
        <span>{mobile.currentSectionChrome.headerAccessory.order === "oldest" ? "古い順" : "新しい順"}</span>
      </button>
    );
  }, [mobile.currentSectionChrome.headerAccessory]);

  const renderMobilePanelBody = useCallback(() => {
    const commonProps = {
      openCardModal: mobile.leftPanelProps.openCardModal,
      onToggleCheck: mobile.leftPanelProps.onToggleCheck,
      onRenameCardTitle: mobile.leftPanelProps.onRenameCardTitle,
      onCardContextMenu: mobile.leftPanelProps.onCardContextMenu,
      onCardContextMenuByKeyboard: mobile.leftPanelProps.onCardContextMenuByKeyboard,
      contextMenuCardId: mobile.leftPanelProps.contextMenuCardId,
      selectedCardIds: mobile.leftPanelProps.selectedCardIds,
      selectionLeadCardId: mobile.leftPanelProps.selectionLeadCardId,
      onShiftSelect: mobile.leftPanelProps.onShiftSelect,
      onClearSelection: mobile.leftPanelProps.onClearSelection,
      onActivateCard: mobile.leftPanelProps.onActivateCard,
      activeCardId: mobile.leftPanelProps.activeCardId,
      activeLaneId: mobile.leftPanelProps.activeLaneId,
    };

    if (!currentMobileSection) return null;

    if (currentMobileSection.key === "overdue") {
      return (
        <OverdueSectionBody
          items={currentMobileSection.items}
          allowDrag={mobile.viewMode === "timeline"}
          cardClassName="bg-white"
          emptyClassName="bg-white/90 text-rose-700"
          {...commonProps}
        />
      );
    }
    if (currentMobileSection.key === "search") {
      return (
        <SearchSectionBody
          query={mobile.leftPanelProps.state.searchQuery}
          results={currentMobileSection.results}
          onQueryChange={mobile.leftPanelProps.actions.onSearchQueryChange}
          searchInputTestId="mobile-left-panel-search-input"
          visibleCount={mobile.leftPanelProps.visibleCounts.search}
          onVisibleCountChange={(nextCount) => mobile.leftPanelProps.onVisibleCountChange("search", nextCount)}
          {...commonProps}
          onRenameCardTitle={undefined}
        />
      );
    }
    if (currentMobileSection.key === "parents") {
      return (
        <ParentCardsSectionBody
          results={currentMobileSection.results}
          visibleCount={mobile.leftPanelProps.visibleCounts.parents}
          onVisibleCountChange={(nextCount) => mobile.leftPanelProps.onVisibleCountChange("parents", nextCount)}
          {...commonProps}
          onRenameCardTitle={undefined}
        />
      );
    }
    if (currentMobileSection.key === "notifications") {
      return (
        <NotificationsSectionBody
            notifications={mobile.leftPanelProps.notifications}
            loading={mobile.leftPanelProps.notificationsLoading}
            loadingMore={mobile.leftPanelProps.notificationsLoadingMore}
            error={mobile.leftPanelProps.notificationsError}
            hasMore={mobile.leftPanelProps.notificationsHasMore}
            feedback={mobile.leftPanelProps.notificationFeedback}
            onRetry={mobile.leftPanelProps.onRetryNotifications}
            onLoadMore={mobile.leftPanelProps.onLoadMoreNotifications}
            onOpenNotification={mobile.leftPanelProps.onOpenNotification}
          />
      );
    }
    if (currentMobileSection.key === "completed") {
      return (
        <CompletedSectionBody
          results={currentMobileSection.results}
          groupedResults={currentMobileSection.groupedResults}
          currentMonthKey={currentMobileSection.currentMonthKey}
          resetKey={currentMobileSection.resetKey}
          visibleCount={mobile.leftPanelProps.visibleCounts.completed}
          onVisibleCountChange={(nextCount) => mobile.leftPanelProps.onVisibleCountChange("completed", nextCount)}
          {...commonProps}
          onRenameCardTitle={undefined}
        />
      );
    }
    if (currentMobileSection.key === "trash") {
      return (
        <TrashSectionBody
          items={currentMobileSection.items}
          visibleCount={mobile.leftPanelProps.visibleCounts.trash}
          onVisibleCountChange={(nextCount) => mobile.leftPanelProps.onVisibleCountChange("trash", nextCount)}
          onRestoreTrashCard={mobile.leftPanelProps.onRestoreTrashCard}
          openCardModal={mobile.leftPanelProps.openCardModal}
        />
      );
    }
    if (currentMobileSection.key === "tags") {
      return (
        <TagsSectionBody
          tags={currentMobileSection.tags}
          results={currentMobileSection.results}
          selectedTags={mobile.leftPanelProps.state.selectedTags}
          onTagToggle={mobile.leftPanelProps.actions.onTagToggle}
          onTagClear={mobile.leftPanelProps.actions.onTagClear}
          visibleCount={mobile.leftPanelProps.visibleCounts.tags}
          onVisibleCountChange={(nextCount) => mobile.leftPanelProps.onVisibleCountChange("tags", nextCount)}
          {...commonProps}
          onRenameCardTitle={undefined}
        />
      );
    }
    return null;
  }, [currentMobileSection, mobile.leftPanelProps, mobile.viewMode]);

  const renderMobileTopArea = useCallback(() => (
    <>
      <div className="relative z-40 border-b border-slate-200 bg-slate-50/70">
        <div className="relative flex h-10 items-center justify-between px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div ref={mobileSelectorRef} className="relative flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowMobileSelector((current) => !current)}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                aria-haspopup="menu"
                aria-expanded={showMobileSelector}
                aria-label="メニューを切り替え"
                data-testid="mobile-left-panel-selector-trigger"
              >
                <svg className={clsx("h-3.5 w-3.5 transition-transform", showMobileSelector && "rotate-180")} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="5" height="5" rx="1" />
                  <rect x="11.5" y="3.5" width="5" height="5" rx="1" />
                  <rect x="3.5" y="11.5" width="5" height="5" rx="1" />
                  <rect x="11.5" y="11.5" width="5" height="5" rx="1" />
                </svg>
              </button>
              <span className="truncate text-sm font-semibold leading-tight text-slate-800">
                {mobile.selectorPresentation.triggerLabel}
              </span>
              {showMobileSelector ? (
                <div className="absolute left-0 top-full z-[70] mt-1 min-w-[132px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg" role="menu">
                  {mobile.selectorPresentation.selectorItems.map((item) => {
                    const selected = item.key === mobile.selectorPresentation.currentSection;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setShowMobileSelector(false);
                          setIsMobilePanelCollapsed(false);
                          mobile.selectorPresentation.onSelect(item.key);
                        }}
                        data-testid={`mobile-left-panel-selector-item-${item.key}`}
                        className={clsx(
                          "flex w-full items-center rounded-lg px-3 py-2 text-left text-[12px]",
                          selected ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700 hover:bg-slate-50"
                        )}
                        role="menuitemradio"
                        aria-checked={selected}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <span
              className={clsx(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight",
                mobile.currentSectionChrome.tone === "danger" ? "bg-rose-200 text-rose-800" : "bg-slate-200 text-slate-700"
              )}
              data-testid="mobile-left-panel-count-badge"
            >
              {mobile.currentSectionChrome.count}
            </span>
            <button
              type="button"
              onClick={() => setIsMobilePanelCollapsed((current) => !current)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
              aria-label={isMobilePanelCollapsed ? "left panel を表示" : "left panel を隠す"}
              aria-expanded={!isMobilePanelCollapsed}
              aria-controls="mobile-left-panel-body"
            >
              <svg className={clsx("h-3.5 w-3.5 transition-transform", isMobilePanelCollapsed && "rotate-180")} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5 10 7.5 15 12.5" />
              </svg>
            </button>
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-2">
            {mobileHeaderAccessory}
          </div>
        </div>
        <div
          id="mobile-left-panel-body"
          data-testid="mobile-left-panel-body"
          className="overflow-hidden transition-[height,opacity] duration-200 ease-out"
          style={{ height: isMobilePanelCollapsed ? "0px" : "clamp(168px, 28svh, 240px)", opacity: isMobilePanelCollapsed ? 0 : 1 }}
        >
          <SidebarSectionShell
            title={mobile.currentSectionChrome.title}
            count={mobile.currentSectionChrome.count}
            tone={mobile.currentSectionChrome.tone}
            panelId="mobile-left-panel-shell"
            expanded
            renderHeader={false}
            sectionClassName="h-full"
            secondaryActions={
              mobile.currentSectionChrome.secondaryActionsKind === "notifications" ? (
                <NotificationsSectionActions
                  unreadCount={mobile.leftPanelProps.notificationUnreadCount}
                  onMarkAllAsRead={mobile.leftPanelProps.onMarkAllNotificationsRead}
                  onOpenSettings={mobile.leftPanelProps.onOpenNotificationSettings}
                  className="border-t border-slate-200/80"
                  markAllButtonTestId="mobile-notifications-mark-all-read"
                  settingsButtonTestId="mobile-notification-settings-button"
                />
              ) : null
            }
            bodyClassName="h-full"
          >
            {renderMobilePanelBody()}
          </SidebarSectionShell>
        </div>
      </div>
    </>
  ), [isMobilePanelCollapsed, mobile.currentSectionChrome, mobile.leftPanelProps, mobile.selectorPresentation, mobileHeaderAccessory, renderMobilePanelBody, showMobileSelector]);

  if (!parseResult.ok) {
    return (
      <div className="min-h-screen bg-[#f4f5f7] p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Invalid/legacy URL</h1>
          <p className="mt-2 text-sm text-slate-600">
            このURLは現在の契約に一致しません。reason:{" "}
            <span className="font-mono text-rose-600">{parseResult.code}</span>
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={onResetInvalidUrl}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              URLをリセット
            </button>
            <button
              onClick={onMoveToCanonicalUrl}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
            >
              正規URLへ移動
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-x-hidden bg-[#f4f5f7]">
      <div
        className="box-border flex h-full w-full flex-col gap-0 px-3 pb-4 md:px-4 md:pb-4 xl:px-6 xl:pb-4 2xl:px-8 2xl:pb-4"
        onKeyDownCapture={(event) => {
          handleTimelineCardArrowFocus(event);
        }}
      >
        <div
          className={clsx(
            "shrink-0 overflow-hidden transition-[max-height,opacity,transform] duration-200 ease-out",
            isHeaderCollapsed ? "pointer-events-none max-h-0 -translate-y-3 opacity-0" : "max-h-56 translate-y-0 opacity-100"
          )}
          aria-hidden={isHeaderCollapsed}
          data-testid="board-main-header"
        >
          <TimelineBoardHeader {...headerProps} collapsed={isHeaderCollapsed} />
        </div>

        <div
          ref={desktopScopeRef}
          className="hidden min-h-0 flex-1 md:flex md:flex-col"
          onKeyDownCapture={(event) => {
            handleTimelineCardArrowFocus(event);
          }}
          onFocusCapture={(event) => {
            if (modalProps) return;
            setBoardShortcutContextFromTarget(event.target);
          }}
          onBlurCapture={() => {
            if (typeof window === "undefined") return;
            window.requestAnimationFrame(() => {
              syncBoardShortcutContextFromActiveElement();
            });
          }}
        >
          {!modalProps ? (
            <StatusShortcutBar
              payload={boardShortcutPayload}
              maxVisibleItems={shortcutBarProps.maxVisibleItems}
              className="mb-0 shrink-0 rounded-t-2xl rounded-b-none border-b-0 shadow-sm ring-0"
              dataTestId="board-shortcut-bar"
              trailingAction={
                <button
                  type="button"
                  onClick={() => setIsHeaderCollapsed((prev) => !prev)}
                  data-focus-group="header"
                  data-focus-part="control"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-800"
                  aria-label={headerToggleLabel}
                  aria-expanded={!isHeaderCollapsed}
                  data-testid="board-header-toggle"
                  title={headerToggleLabel}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className={clsx("h-4 w-4 transition-transform duration-200", isHeaderCollapsed && "rotate-180")}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 14.25 3.75-3.75 3.75 3.75" />
                  </svg>
                </button>
              }
            />
          ) : null}
          {desktop.activeView === "timeline" ? (
            <>
              <DndContext
                sensors={desktop.dndProps.sensors}
                onDragStart={desktop.dndProps.handleDragStart}
                onDragMove={desktop.dndProps.handleDragMove}
                onDragEnd={desktop.dndProps.handleDragEnd}
                onDragCancel={desktop.dndProps.handleDragCancel}
                collisionDetection={bucketsFirstCollisionDetection}
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
              autoScroll={{
                  enabled: false,
                  threshold: { x: 0, y: 0.2 },
                  acceleration: 1,
                }}
              >
                {renderDesktopShell(
                  <>
                    {renderDesktopTabs()}
                    <DesktopTimelineToolbar
                      {...desktopTimelineToolbarProps}
                      timelineStartHour={desktop.timelineViewProps.timelineStartHour}
                    />
                    {desktop.timelineTransitionPending ? (
                      <TimelineLoadingPlaceholder />
                    ) : (
                      <DesktopTimelineView {...desktopTimelineViewProps} />
                    )}
                  </>
                )}

                <DragOverlay dropAnimation={null} zIndex={50}>
                  <TimelineDragOverlayCard
                    variant="desktop"
                    overlayCardData={desktop.overlayProps.overlayCardData}
                    overlayTimelineEvent={desktop.overlayProps.overlayTimelineEvent}
                    overlayBucketCard={desktop.overlayProps.overlayBucketCard}
                    overlayOverdueCard={desktop.overlayProps.overlayOverdueCard}
                  />
                </DragOverlay>
              </DndContext>
            </>
          ) : (
            <>
              {renderDesktopShell(
                <>
                  {renderDesktopTabs()}
                  {desktop.activeView === "list" ? (
                    <>
                      <DesktopListToolbar {...desktop.listToolbarProps} />
                      <DesktopListView {...desktop.listViewProps} />
                    </>
                  ) : (
                    <>
                      <DesktopMonthToolbar {...desktop.monthToolbarProps} />
                      <DesktopMonthView {...desktop.monthViewProps} />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {mobile.viewMode === "timeline" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:hidden">
            {renderMobileTopArea()}
            {mobile.timelineTransitionPending ? (
              <TimelineLoadingPlaceholder />
            ) : (
              <MobileTimelineView {...mobile.timelineProps} />
            )}
          </div>
        ) : mobile.viewMode === "list" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:hidden">
            {renderMobileTopArea()}
            <MobileListView {...mobile.listProps} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:hidden">
            {renderMobileTopArea()}
            <MobileMonthView {...mobile.monthProps} />
          </div>
        )}

        <TimelineBoardDialogs {...dialogsProps} />
        <ShortcutsModal {...shortcutsProps} />
        {!cardPeekEnabled && parentPanelProps ? <ParentChildPanel {...parentPanelProps} /> : null}
        {modalProps ? (
          <CardModal
            {...modalProps}
            presentation={cardPeekEnabled ? "peek" : "modal"}
            peekMode={cardPeekMode}
            peekWidth={cardPeekWidth}
            onPeekModeChange={handleCardPeekModeChange}
            onPeekResizeStart={handleCardPeekResizeStart}
          />
        ) : null}
        {cardModalError ? (
          <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
            {cardModalError}
          </div>
        ) : null}
        {contextMenu.open && contextMenu.cardId ? (
          <CardContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={contextMenu.onClose}
            items={contextMenu.items}
          />
        ) : null}
        {bucketCreateMenu.open ? (
          <CardContextMenu
            x={bucketCreateMenu.x}
            y={bucketCreateMenu.y}
            onClose={bucketCreateMenu.onClose}
            items={bucketCreateMenu.items}
          />
        ) : null}
      </div>
    </div>
  );
}
