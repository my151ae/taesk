import clsx from "clsx";
import type { MouseEvent } from "react";
import { Checklist, ChecklistLine, normalizeChecklist } from "@/lib/checklist";

type ChecklistPreviewProps = {
  checklist: Checklist | null;
  maxLines?: number;
  className?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onLineFocusRequest?: (lineId: string, caretPos?: number) => void;
};

export function ChecklistPreview({ checklist, maxLines = 3, className, onClick, onLineFocusRequest }: ChecklistPreviewProps) {
  const normalized = normalizeChecklist(checklist ?? null);
  const isEmpty = normalized.lines.length === 0;
  const lines: ChecklistLine[] = isEmpty
    ? [{ id: '__placeholder', level: 0, checked: false, text: '' }]
    : normalized.lines.slice(0, maxLines);
  const truncated = !isEmpty && normalized.lines.length > lines.length;

  return (
    <div
      className={clsx(
        'text-xs text-slate-700',
        className,
        onClick ? 'cursor-text' : undefined,
      )}
      onClick={onClick}
    >
      <ul className="space-y-1">
        {lines.map((line) => {
          const level = Number.isFinite(line.level) ? Math.min(line.level, 8) : 0;
          return (
            <li
              key={line.id}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 leading-tight"
              style={{ paddingLeft: level * 20 }}
              onClick={(e) => {
                e.stopPropagation();
                let caretPos: number | undefined = undefined;
                if (typeof window !== 'undefined') {
                  const selection = window.getSelection();
                  const anchorNode = selection?.anchorNode;
                  const parentEl = anchorNode instanceof HTMLElement
                    ? anchorNode
                    : anchorNode?.parentElement ?? null;
                  const lineId = parentEl?.dataset?.lineId;
                  if (lineId === line.id && typeof selection?.anchorOffset === 'number') {
                    caretPos = selection.anchorOffset;
                  }
                }
                onLineFocusRequest?.(line.id, caretPos);
                onClick?.(e);
              }}
            >
              <span
                className={clsx(
                  'inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] font-bold',
                  line.checked ? 'bg-slate-100 text-slate-700' : 'bg-white text-transparent'
                )}
                aria-hidden
              >
                ✓
              </span>
              <span
                className={clsx(
                  'flex-1 whitespace-pre-wrap break-words text-[11px]',
                  line.text ? 'text-slate-700' : 'text-slate-400'
                )}
                data-line-id={line.id}
              >
                {line.text || 'タスクを書く'}
              </span>
            </li>
          );
        })}
        {truncated ? <li className="text-[11px] text-slate-400">…</li> : null}
      </ul>
    </div>
  );
}
