"use client";

import { DndContext, DragOverlay, MeasuringStrategy } from "@dnd-kit/core";
import type { ComponentProps } from "react";
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
import { CardContextMenu } from "@/app/(board)/_components/timeline/CardContextMenu";
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
  modalProps,
  cardModalError,
  contextMenu,
}: TimelineBoardScreenProps) {
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
    <div className="min-h-screen overflow-x-hidden bg-[#f4f5f7]">
      <div className="flex w-full flex-col gap-4 px-3 pt-4 md:px-4 md:pt-6 xl:px-6 2xl:px-8">
        <TimelineBoardHeader {...headerProps} />

        <div className="hidden md:block">
          {desktop.activeView === "timeline" ? (
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
              <div className="flex min-h-0 max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                <aside
                  className="flex min-h-0 shrink-0 self-stretch flex-col overflow-hidden border-r border-slate-200 bg-slate-50/70"
                  style={{ width: "clamp(252px, 19vw, 292px)" }}
                >
                  <DesktopSidebarMenu
                    {...desktop.leftPanelProps}
                    overdueSortOrder={desktop.overdueSortOrder}
                    onOverdueSortOrderChange={desktop.onOverdueSortOrderChange}
                  />
                </aside>

                <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="border-b border-slate-100 bg-white px-3 py-2">
                    <div className="flex items-center gap-2">
                      {desktop.tabItems.map((item) => {
                        const isActive = item.key === desktop.activeView;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => desktop.onTabChange(item.key)}
                            className={
                              isActive
                                ? "rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow-sm"
                                : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            }
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
                </section>
              </div>

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
          ) : (
            <div className="flex min-h-0 max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <aside
                className="flex min-h-0 shrink-0 self-stretch flex-col overflow-hidden border-r border-slate-200 bg-slate-50/70"
                style={{ width: "clamp(252px, 19vw, 292px)" }}
              >
                <DesktopSidebarMenu
                  {...desktop.leftPanelProps}
                  overdueSortOrder={desktop.overdueSortOrder}
                  onOverdueSortOrderChange={desktop.onOverdueSortOrderChange}
                />
              </aside>

              <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="border-b border-slate-100 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    {desktop.tabItems.map((item) => {
                      const isActive = item.key === desktop.activeView;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => desktop.onTabChange(item.key)}
                          className={
                            isActive
                              ? "rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow-sm"
                              : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          }
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
              </section>
            </div>
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
