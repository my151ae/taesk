"use client";

import { DndContext, DragOverlay, MeasuringStrategy } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CardModal } from "@/app/components/CardModal";
import TimelineBoardHeader from "@/app/(board)/_components/timeline/TimelineBoardHeader";
import TimelineBoardDialogs from "@/app/(board)/_components/timeline/TimelineBoardDialogs";
import {
  DesktopTimelineToolbar,
  DesktopTimelineView,
} from "@/app/(board)/_components/timeline/DesktopTimelineView";
import {
  DesktopListToolbar,
  DesktopListView,
} from "@/app/(board)/_components/timeline/DesktopListView";
import MobileTimelineView from "@/app/(board)/_components/timeline/MobileTimelineView";
import MobileListView from "@/app/(board)/_components/timeline/MobileListView";
import { DesktopSidebarMenu } from "@/app/(board)/_components/timeline/DesktopSidebarMenu";
import { TimelineDragOverlayCard } from "@/app/(board)/_components/timeline/TimelineDragOverlayCard";
import { ShortcutsModal } from "@/app/(board)/_components/timeline/ShortcutsModal";
import { StatusShortcutBar } from "@/app/(board)/_components/timeline/StatusShortcutBar";
import { CardContextMenu } from "@/app/(board)/_components/timeline/CardContextMenu";
import {
  createEmptyShortcutBarPayload,
  getShortcutContextFromTarget,
  resolveShortcutBarPayload,
  type ShortcutBarConfig,
  type ShortcutContextDescriptor,
} from "@/app/(board)/_components/timeline/shortcut-bar-registry";
import { bucketsFirstCollisionDetection } from "@/app/(board)/_hooks/useTimelineDragAndDrop";
import type { OverdueSortOrder } from "@/lib/timeline-overdue-sort";

type HeaderProps = ComponentProps<typeof TimelineBoardHeader>;
type DialogsProps = ComponentProps<typeof TimelineBoardDialogs>;
type TimelineToolbarProps = ComponentProps<typeof DesktopTimelineToolbar>;
type TimelineBodyProps = ComponentProps<typeof DesktopTimelineView>;
type ListToolbarProps = ComponentProps<typeof DesktopListToolbar>;
type ListBodyProps = ComponentProps<typeof DesktopListView>;
type MobileTimelineProps = ComponentProps<typeof MobileTimelineView>;
type MobileTimelineBaseProps = Omit<
  MobileTimelineProps,
  "overdueSortOrder" | "onOverdueSortOrderChange"
>;
type MobileListProps = ComponentProps<typeof MobileListView>;
type SidebarMenuProps = ComponentProps<typeof DesktopSidebarMenu>;
type SidebarMenuBaseProps = Omit<
  SidebarMenuProps,
  "overdueSortOrder" | "onOverdueSortOrderChange"
>;
type ShortcutsModalProps = ComponentProps<typeof ShortcutsModal>;
type CardModalProps = ComponentProps<typeof CardModal>;
type CardContextMenuProps = ComponentProps<typeof CardContextMenu>;

type ParseResult = { ok: true } | { ok: false; code: string };
type TabItem = { key: "timeline" | "list"; label: string };

export type TimelineBoardScreenProps = {
  parseResult: ParseResult;
  onResetInvalidUrl: () => void;
  onMoveToCanonicalUrl: () => void;
  headerProps: HeaderProps;
  desktop: {
    activeView: "timeline" | "list";
    tabItems: TabItem[];
    onTabChange: (key: "timeline" | "list") => void;
    leftPanelProps: SidebarMenuBaseProps;
    overdueSortOrder: OverdueSortOrder;
    onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
    timelineToolbarProps: TimelineToolbarProps;
    timelineViewProps: TimelineBodyProps;
    listToolbarProps: ListToolbarProps;
    listViewProps: ListBodyProps;
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
    viewMode: "timeline" | "list";
    timelineProps: MobileTimelineBaseProps;
    listProps: MobileListProps;
    overdueSortOrder: OverdueSortOrder;
    onOverdueSortOrderChange: (order: OverdueSortOrder) => void;
  };
  dialogsProps: DialogsProps;
  shortcutsProps: ShortcutsModalProps;
  shortcutBarProps: ShortcutBarConfig;
  modalProps: CardModalProps | null;
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
  cardModalError,
  contextMenu,
}: TimelineBoardScreenProps) {
  const desktopScopeRef = useRef<HTMLDivElement | null>(null);
  const [desktopShortcutDescriptor, setDesktopShortcutDescriptor] = useState<ShortcutContextDescriptor | null>(null);

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
    if (!desktopShortcutDescriptor) return createEmptyShortcutBarPayload("board");
    return resolveShortcutBarPayload({
      ...desktopShortcutDescriptor,
      state: "active",
    }) ?? createEmptyShortcutBarPayload("board");
  }, [desktopShortcutDescriptor, modalProps]);
  const activeTabClassName =
    "rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-800 shadow-sm ring-1 ring-slate-300";
  const inactiveTabClassName =
    "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50";
  const desktopSidebarExpanded = desktop.leftPanelProps.state.expandedSectionKey !== null;
  const desktopSidebarWidth = desktopSidebarExpanded ? "clamp(252px, 19vw, 292px)" : "3.5rem";

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
      <div className="box-border flex h-full w-full flex-col gap-0 px-3 pb-4 md:px-4 md:pb-4 xl:px-6 xl:pb-4 2xl:px-8 2xl:pb-4">
        <TimelineBoardHeader {...headerProps} />

        <div
          ref={desktopScopeRef}
          className="hidden min-h-0 flex-1 md:flex md:flex-col"
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
                    <div className="border-b border-slate-100 bg-white px-3 py-2">
                      <div className="flex items-center gap-2">
                        {desktop.tabItems.map((item) => {
                          const isActive = item.key === desktop.activeView;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => desktop.onTabChange(item.key)}
                              className={isActive ? activeTabClassName : inactiveTabClassName}
                              aria-current={isActive ? "page" : undefined}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <DesktopTimelineToolbar {...desktop.timelineToolbarProps} />
                    <DesktopTimelineView {...desktop.timelineViewProps} />
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
                  <div className="border-b border-slate-100 bg-white px-3 py-2">
                    <div className="flex items-center gap-2">
                      {desktop.tabItems.map((item) => {
                        const isActive = item.key === desktop.activeView;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => desktop.onTabChange(item.key)}
                            className={isActive ? activeTabClassName : inactiveTabClassName}
                            aria-current={isActive ? "page" : undefined}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <DesktopListToolbar {...desktop.listToolbarProps} />
                  <DesktopListView {...desktop.listViewProps} />
                </>
              )}
            </>
          )}
        </div>

        {mobile.viewMode === "timeline" ? (
          <div className="flex-1 overflow-hidden md:hidden">
            <MobileTimelineView
              {...mobile.timelineProps}
              overdueSortOrder={mobile.overdueSortOrder}
              onOverdueSortOrderChange={mobile.onOverdueSortOrderChange}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden md:hidden">
            <MobileListView {...mobile.listProps} />
          </div>
        )}

        <TimelineBoardDialogs {...dialogsProps} />
        <ShortcutsModal {...shortcutsProps} />
        {modalProps ? <CardModal {...modalProps} /> : null}
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
      </div>
    </div>
  );
}
