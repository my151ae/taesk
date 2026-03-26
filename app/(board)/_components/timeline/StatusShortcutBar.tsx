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

function ShiftKeyGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M12 4.25 18.35 10.6H14.9v7.15H9.1V10.6H5.65L12 4.25Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function renderKeyLabel(label: string) {
  if (label === "⇧") return <ShiftKeyGlyph />;
  return label;
}

function KeyChip({ label, disabled = false }: { label: string; disabled?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex h-5 min-w-[22px] items-center justify-center rounded-md border px-1.5 text-[10px] font-bold leading-none shadow-sm",
        disabled
          ? "border-slate-200 bg-slate-50 text-slate-300 shadow-none"
          : "border-slate-300 bg-white text-slate-700"
      )}
    >
      {renderKeyLabel(label)}
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
        "flex h-9 items-center gap-2.5 rounded-2xl border border-slate-200 bg-white/95 px-3 shadow-sm ring-1 ring-black/5 backdrop-blur-sm",
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
        <div className="flex items-center gap-2.5 overflow-x-auto">
          {visibleItems.map((item) => (
            <div key={item.id} className="flex shrink-0 items-center gap-1.5">
              <div className="flex items-center gap-1">
                {item.keys.map((key, index) => (
                  <div key={`${item.id}-${key}-${index}`} className="flex items-center gap-1">
                    {index > 0 ? <span className="text-[10px] text-slate-400">+</span> : null}
                    <KeyChip label={key} disabled={!item.enabled} />
                  </div>
                ))}
              </div>
              <span className={clsx("text-[11px] font-medium leading-none", item.enabled ? "text-slate-700" : "text-slate-300")}>
                {item.label}
              </span>
            </div>
          ))}
          {overflowCount > 0 ? (
            <div className="shrink-0 text-[11px] font-semibold leading-none text-slate-500">+{overflowCount}</div>
          ) : null}
        </div>
      </div>
      <div className="ml-auto shrink-0 text-right text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-slate-400">
        {resolvedPayload.contextLabel}
      </div>
    </div>
  );
}
