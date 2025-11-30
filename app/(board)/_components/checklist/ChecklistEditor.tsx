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

const areLinesEqual = (a: ChecklistLine[], b: ChecklistLine[]) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.id !== right.id || left.level !== right.level || left.checked !== right.checked || left.text !== right.text) {
      return false;
    }
  }
  return true;
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
  const hasAutoFocusedRef = useRef(false);
  const onChangeRef = useRef<ChecklistEditorProps['onChange']>();
  const lastEmittedRef = useRef<string>('');

  useEffect(() => {
    initialValueRef.current = normalizedValue;
    if (dirty || isFocused) return;
    if (!normalizedValue.lines.length) return; // 空の場合は既存プレースホルダーを維持
    const nextLines = ensureLines(normalizedValue);
    setLines((prev) => (areLinesEqual(prev, nextLines) ? prev : nextLines));
  }, [normalizedValue, dirty, isFocused]);

  const clampText = (text: string) => text.slice(0, MAX_CHECKLIST_TEXT_LENGTH);

  const updateLine = (id: string, patch: Partial<ChecklistLine>) => {
    setLines((prev) => {
      const next = prev.map((line) => line.id === id ? { ...line, ...patch, text: clampText(patch.text ?? line.text) } : line);
      setDirty(true);
      setError(null);
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
      return next;
    });
  };

  const removeLine = (index: number) => {
    setLines((prev) => {
      if (prev.length === 1) {
        const only = { ...prev[0], text: '', checked: false };
        return [only];
      }
      const next = [...prev.slice(0, index), ...prev.slice(index + 1)];
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

  // 初期表示で最初の行にフォーカスを当て、クリック後すぐ入力できるようにする
  useEffect(() => {
    if (hasAutoFocusedRef.current) return;
    const firstLineId = lines[0]?.id;
    if (firstLineId) {
      focusLine(firstLineId);
      hasAutoFocusedRef.current = true;
    }
  }, [lines]);

  // 親への同期はレンダー後に行い、セットステート警告を回避する
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!onChangeRef.current) return;
    const next = normalizeChecklist({ version: CHECKLIST_VERSION, lines });
    const serialized = JSON.stringify(next.lines);
    if (serialized === lastEmittedRef.current) return;
    lastEmittedRef.current = serialized;
    onChangeRef.current(next);
  }, [lines]);

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
    const target = lineRefs.current[line.id];
    const caret = target?.selectionStart ?? 0;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevLine = lines[index - 1];
      if (prevLine) {
        const pos = Math.min(caret, prevLine.text.length);
        focusLine(prevLine.id, pos);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextLine = lines[index + 1];
      if (nextLine) {
        const pos = Math.min(caret, nextLine.text.length);
        focusLine(nextLine.id, pos);
      }
      return;
    }
    if (event.key === 'ArrowLeft' && caret === 0) {
      event.preventDefault();
      const prevLine = lines[index - 1];
      if (prevLine) {
        focusLine(prevLine.id, prevLine.text.length);
      }
      return;
    }
    if (event.key === 'ArrowRight' && caret === line.text.length) {
      event.preventDefault();
      const nextLine = lines[index + 1];
      if (nextLine) {
        focusLine(nextLine.id, 0);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      const reset = ensureLines(initialValueRef.current);
      setLines(reset);
      setDirty(false);
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
      let newLineId: string | null = null;
      setLines((prev) => {
        if (prev.length >= MAX_CHECKLIST_LINES) return prev;
        const current = prev[index];
        if (!current) return prev;
        const target = lineRefs.current[line.id];
        const start = target?.selectionStart ?? current.text.length;
        const end = target?.selectionEnd ?? start;
        const before = clampText(current.text.slice(0, start));
        const after = clampText(current.text.slice(end));
        newLineId = createLineId();
        const next = [...prev];
        next[index] = { ...current, text: before };
        next.splice(index + 1, 0, {
          id: newLineId,
          level: current.level,
          checked: current.checked,
          text: after,
        });
        setDirty(true);
        setError(null);
        return next;
      });
      if (newLineId) {
        focusLine(newLineId, 0);
      }
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
      <div className="space-y-1">
        {lines.map((line, index) => (
          <div
            key={line.id}
            className="flex items-center gap-1.5 rounded px-1 py-0.5"
            style={{ paddingLeft: Math.min(line.level, 8) * 20 }}
          >
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer"
              checked={line.checked}
              onChange={(e) => updateLine(line.id, { checked: e.target.checked })}
              onPointerDown={(e) => e.stopPropagation()}
            />
            <input
              ref={(el) => { lineRefs.current[line.id] = el; }}
              type="text"
              value={line.text}
              maxLength={MAX_CHECKLIST_TEXT_LENGTH}
              placeholder={index === 0 ? (placeholder ?? 'タスクを書く') : ''}
              className="flex-1 bg-transparent text-xs leading-tight text-slate-800 placeholder:text-slate-400 focus:outline-none"
              onChange={(e) => updateLine(line.id, { text: e.target.value })}
              onKeyDown={(e) => handleLineKeyDown(e, index, line)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              autoFocus={index === 0}
              data-checklist-line={line.id}
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
