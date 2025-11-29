import clsx from "clsx";
import type { MouseEvent } from "react";
import { Checklist, normalizeChecklist } from "@/lib/checklist";

type ChecklistPreviewProps = {
  checklist: Checklist | null;
  maxLines?: number;
  className?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
};

export function ChecklistPreview({ checklist, maxLines = 3, className, onClick }: ChecklistPreviewProps) {
  const normalized = normalizeChecklist(checklist ?? null);
  const lines = normalized.lines.slice(0, maxLines);
  const truncated = normalized.lines.length > lines.length;

  return (
    <div
      className={clsx(
        'group rounded-md border border-slate-200 bg-white/60 px-3 py-2 text-xs text-slate-700 transition hover:border-sky-300 hover:bg-white',
        className,
        onClick ? 'cursor-text' : undefined,
      )}
      onClick={onClick}
    >
      {lines.length === 0 ? (
        <p className="text-slate-400">本文なし</p>
      ) : (
        <ul className="space-y-1">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start gap-2 leading-tight">
              <span
                className={clsx(
                  'mt-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-slate-300 text-[10px] font-bold',
                  line.checked ? 'bg-slate-100 text-slate-700' : 'bg-white text-transparent'
                )}
                aria-hidden
              >
                ✓
              </span>
              <span className="flex-1 whitespace-pre-wrap break-words text-[11px] text-slate-700">
                {line.text || '（空行）'}
              </span>
            </li>
          ))}
          {truncated ? <li className="text-[11px] text-slate-400">…</li> : null}
        </ul>
      )}
    </div>
  );
}
