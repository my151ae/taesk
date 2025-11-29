"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type FocusEvent,
} from "react";
import {
  Checklist,
  ChecklistLine,
  normalizeChecklist,
  EMPTY_CHECKLIST,
  CHECKLIST_VERSION,
  MAX_CHECKLIST_LINES,
  MAX_CHECKLIST_TEXT_LENGTH,
} from "@/lib/checklist";

export type ChecklistSaveTrigger = 'blur' | 'shortcut' | 'auto';

type ChecklistEditorProps = {
  value: Checklist | null;
  onCommit?: (next: Checklist, trigger: ChecklistSaveTrigger) => Promise<void> | void;
  onChange?: (next: Checklist) => void;
  onCancel?: () => void;
  onEditingChange?: (isEditing: boolean) => void;
  autoSaveDelayMs?: number;
  placeholder?: string;
  minRows?: number; // 互換用（ブロックUIでは未使用）
  className?: string;
};

const createLineId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chk_${Math.random().toString(36).slice(2, 10)}`;
};

const ensureLines = (checklist: Checklist | null): ChecklistLine[] => {
  const normalized = normalizeChecklist(checklist ?? EMPTY_CHECKLIST);
  if (!normalized.lines.length) {
    return [{ id: createLineId(), level: 0, checked: false, text: '' }];
  }
  return normalized.lines;
};

export function ChecklistEditor({
  value,
  onCommit,
  onChange,
  onCancel,
  onEditingChange,
  autoSaveDelayMs = 1500,
  placeholder,
  className,
}: ChecklistEditorProps) {
  const normalizedValue = useMemo(() => normalizeChecklist(value ?? EMPTY_CHECKLIST), [value]);
  const [lines, setLines] = useState<ChecklistLine[]>(ensureLines(normalizedValue));
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const initialValueRef = useRef<Checklist>(normalizedValue);

  useEffect(() => {
    initialValueRef.current = normalizedValue;
    if (!dirty && !isFocused) {
      setLines(ensureLines(normalizedValue));
    }
  }, [normalizedValue, dirty, isFocused]);

  const emitChange = useCallback((nextLines: ChecklistLine[]) => {
    const next = normalizeChecklist({ version: CHECKLIST_VERSION, lines: nextLines });
    onChange?.(next);
  }, [onChange]);

  const clampText = (text: string) => text.slice(0, MAX_CHECKLIST_TEXT_LENGTH);

  const updateLine = (id: string, patch: Partial<ChecklistLine>) => {
    setLines((prev) => {
      const next = prev.map((line) => line.id === id ? { ...line, ...patch, text: clampText(patch.text ?? line.text) } : line);
      setDirty(true);
      setError(null);
      emitChange(next);
      return next;
    });
  };

  const insertLine = (index: number, base?: ChecklistLine) => {
    setLines((prev) => {
      if (prev.length >= MAX_CHECKLIST_LINES) return prev;
      const nextLine: ChecklistLine = base ?? { id: createLineId(), level: 0, checked: false, text: '' };
      const next = [...prev.slice(0, index), nextLine, ...prev.slice(index)];
      setDirty(true);
      setError(null);
      emitChange(next);
      return next;
    });
  };

  const removeLine = (index: number) => {
    setLines((prev) => {
      if (prev.length === 1) {
        const only = { ...prev[0], text: '', checked: false };
        emitChange([only]);
        return [only];
      }
      const next = [...prev.slice(0, index), ...prev.slice(index + 1)];
      emitChange(next);
      setDirty(true);
      setError(null);
      return next;
    });
  };

  const focusLine = (id: string, caretPos?: number) => {
    requestAnimationFrame(() => {
      const target = lineRefs.current[id];
      if (!target) return;
      target.focus();
      if (typeof caretPos === 'number') {
        target.selectionStart = target.selectionEnd = Math.max(0, Math.min(target.value.length, caretPos));
      }
    });
  };

  const commit = useCallback(async (trigger: ChecklistSaveTrigger) => {
    if (!dirty && trigger === 'auto') return;
    if (!onCommit) {
      setDirty(false);
      return;
    }
    if (isSaving) {
      setPendingSave(true);
      return;
    }

    const next = normalizeChecklist({ version: CHECKLIST_VERSION, lines });
    setIsSaving(true);
    setError(null);
    try {
      await onCommit(next, trigger);
      setDirty(false);
    } catch (err) {
      console.error('[checklist] commit failed', err);
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
      if (pendingSave) {
        setPendingSave(false);
        commit('auto');
      }
    }
  }, [dirty, isSaving, onCommit, pendingSave, lines]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => commit('auto'), autoSaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [dirty, lines, commit, autoSaveDelayMs]);

  const handleContainerBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as HTMLElement | null;
    if (containerRef.current && nextTarget && containerRef.current.contains(nextTarget)) {
      return;
    }
    commit('blur');
    setIsFocused(false);
    onEditingChange?.(false);
  };

  const handleContainerFocus = () => {
    setIsFocused(true);
    onEditingChange?.(true);
  };

  const handleLineKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, index: number, line: ChecklistLine) => {
    if (isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'enter') {
      event.preventDefault();
      commit('shortcut');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      const reset = ensureLines(initialValueRef.current);
      setLines(reset);
      setDirty(false);
      emitChange(reset);
      onCancel?.();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const nextLevel = Math.max(0, Math.min(8, line.level + (event.shiftKey ? -1 : 1)));
      updateLine(line.id, { level: nextLevel });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const base: ChecklistLine = { id: createLineId(), level: line.level, checked: false, text: '' };
      insertLine(index + 1, base);
      focusLine(base.id, 0);
      return;
    }
    if (event.key === 'Backspace') {
      const target = lineRefs.current[line.id];
      const caret = target?.selectionStart ?? 0;
      if (line.text.length === 0 && caret === 0) {
        event.preventDefault();
        if (lines.length === 1) return;
        const prevLine = lines[index - 1];
        removeLine(index);
        if (prevLine) focusLine(prevLine.id, prevLine.text.length);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={clsx('flex flex-col gap-2', className)}
      onFocus={handleContainerFocus}
      onBlur={handleContainerBlur}
    >
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div
            key={line.id}
            className="flex items-start gap-2 rounded-md border border-transparent px-2 py-1 hover:border-slate-200 focus-within:border-sky-300 focus-within:ring-1 focus-within:ring-sky-200"
            style={{ paddingLeft: Math.min(line.level, 8) * 16 + 8 }}
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 cursor-pointer"
              checked={line.checked}
              onChange={(e) => updateLine(line.id, { checked: e.target.checked })}
              onPointerDown={(e) => e.stopPropagation()}
            />
            <input
              ref={(el) => { lineRefs.current[line.id] = el; }}
              type="text"
              value={line.text}
              maxLength={MAX_CHECKLIST_TEXT_LENGTH}
              placeholder={index === 0 ? (placeholder ?? 'タスクを入力') : ''}
              className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
              onChange={(e) => updateLine(line.id, { text: e.target.value })}
              onKeyDown={(e) => handleLineKeyDown(e, index, line)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              data-testid="checklist-editor"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-500">
        {dirty ? <span>未保存の変更あり</span> : <span>保存済み</span>}
        {isSaving ? <span className="text-sky-600">保存中...</span> : null}
        {error ? <span className="text-rose-600">{error}</span> : null}
      </div>
    </div>
  );
}
