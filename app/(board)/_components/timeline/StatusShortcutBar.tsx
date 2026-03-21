"use client";

import clsx from "clsx";

import {
  createEmptyShortcutBarPayload,
  type ShortcutBarPayload,
  sliceShortcutItems,
} from "@/app/(board)/_components/timeline/shortcut-bar-registry";

type StatusShortcutBarProps = {
  payload?: ShortcutBarPayload | null;
  maxVisibleItems?: number;
  className?: string;
  dataTestId?: string;
};

function KeyChip({ label }: { label: string }) {
  return (
    <span className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-bold leading-none text-slate-700 shadow-sm">
      {label}
    </span>
  );
}

export function StatusShortcutBar({
  payload,
  maxVisibleItems = 5,
  className,
  dataTestId,
}: StatusShortcutBarProps) {
  const resolvedPayload = payload ?? createEmptyShortcutBarPayload("board");
  const { visibleItems, overflowCount } = sliceShortcutItems(resolvedPayload.items, maxVisibleItems);

  return (
    <div
      className={clsx(
        "flex min-h-10 items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-2 shadow-sm ring-1 ring-black/5 backdrop-blur-sm",
        className
      )}
      data-testid={dataTestId}
      data-shortcut-bar-scope={resolvedPayload.scope}
      data-shortcut-bar-region={resolvedPayload.region ?? ""}
      data-shortcut-bar-section={resolvedPayload.section ?? ""}
      data-shortcut-bar-view={resolvedPayload.view ?? ""}
      data-shortcut-bar-part={resolvedPayload.part ?? ""}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-3 overflow-x-auto">
          {visibleItems.map((item) => (
            <div key={item.id} className="flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-1">
                {item.keys.map((key, index) => (
                  <div key={`${item.id}-${key}-${index}`} className="flex items-center gap-1">
                    {index > 0 ? <span className="text-[10px] text-slate-400">+</span> : null}
                    <KeyChip label={key} />
                  </div>
                ))}
              </div>
              <span className="text-xs font-medium text-slate-700">{item.label}</span>
            </div>
          ))}
          {overflowCount > 0 ? (
            <div className="shrink-0 text-xs font-semibold text-slate-500">+{overflowCount}</div>
          ) : null}
        </div>
      </div>
      <div className="ml-auto shrink-0 text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {resolvedPayload.contextLabel}
      </div>
    </div>
  );
}
