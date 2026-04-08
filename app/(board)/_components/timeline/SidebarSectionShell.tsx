"use client";

import clsx from "clsx";

import { SharedPanelHeader } from "@/app/(board)/_components/timeline/TimelineLeftPanelShared";

export function SidebarSectionShell({
  title,
  count,
  tone,
  panelId,
  expanded,
  headerAccessory,
  secondaryActions,
  children,
  renderHeader = true,
  sectionClassName,
  headerClassName,
  bodyClassName,
}: {
  title: string;
  count: number;
  tone: "danger" | "neutral";
  panelId: string;
  expanded: boolean;
  headerAccessory?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  children: React.ReactNode;
  renderHeader?: boolean;
  sectionClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={clsx("min-h-0 min-w-0 flex-1 flex-col overflow-hidden", expanded ? "flex" : "hidden", sectionClassName)}
      aria-hidden={!expanded}
    >
      {renderHeader ? (
        <SharedPanelHeader
          title={title}
          count={count}
          tone={tone}
          accessory={headerAccessory}
          className={headerClassName}
        />
      ) : null}

      {secondaryActions ?? null}

      <div
        id={panelId}
        data-testid={panelId}
        aria-hidden={!expanded}
        hidden={!expanded}
        className={clsx("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", bodyClassName)}
      >
        {expanded ? children : null}
      </div>
    </section>
  );
}
