import { useState, useRef, useEffect, useCallback, KeyboardEvent, ChangeEvent } from 'react';
import clsx from 'clsx';
import { splitPastedText } from '@/lib/tiptap';

// 最大高さ（6行分相当）
const MAX_HEIGHT_PX = 120;

type InlineTitleEditorProps = {
    title: string;
    onSave: (newTitle: string, previousTitle: string, meta?: { noteExtracted?: boolean }) => void;
    onCancel: () => void;
    onNoteExtracted?: (bodyLines: string[], updatedTitle?: string) => void;
    className?: string;
};

/**
 * カードタイトルのインライン編集コンポーネント
 * - Enter: 改行
 * - Cmd/Ctrl + Enter: 保存
 * - Escape: キャンセル（ロールバック）
 * - blur: 保存
 * - IME変換中は保存しない
 */
export function InlineTitleEditor({
    title,
    onSave,
    onCancel,
    onNoteExtracted,
    className,
}: InlineTitleEditorProps) {
    // 編集開始時のタイトルを保持（ロールバック用）
    const initialTitleRef = useRef(title);
    const [localTitle, setLocalTitle] = useState(title);
    const [isComposing, setIsComposing] = useState(false);
    const hasCommittedRef = useRef(false);
    const noteExtractedRef = useRef(false);
    const extractedTitleRef = useRef<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 編集開始時にフォーカス
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.focus();
            // カーソルを末尾に移動
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
        console.log('[InlineTitleEditor] mount', { title, length: title.length });
        // 編集開始時に hasCommittedRef をリセット
        hasCommittedRef.current = false;
        noteExtractedRef.current = false;
        extractedTitleRef.current = null;
    }, [title]);

    // 自動高さ調整
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
        }
    }, [localTitle]);

    const handleSave = useCallback(() => {
        if (hasCommittedRef.current) return; // 二重保存防止
        if (isComposing) return; // IME変換中は保存しない
        console.log('[InlineTitleEditor] handleSave', { localTitle: JSON.stringify(localTitle) });

        const { title: finalTitle, bodyLines } = splitPastedText(localTitle);
        const shouldExtractNote = bodyLines.length > 0 && !!onNoteExtracted;

        // 改行が含まれている（2行目以降がある）場合は本文として抽出
        if (shouldExtractNote && onNoteExtracted) {
            onNoteExtracted(bodyLines, finalTitle);
            noteExtractedRef.current = true;
            extractedTitleRef.current = finalTitle;
        }

        hasCommittedRef.current = true;
        const shouldSkipTitleUpdate =
            noteExtractedRef.current && (extractedTitleRef.current ?? "") === finalTitle;
        onSave(finalTitle, initialTitleRef.current, { noteExtracted: shouldSkipTitleUpdate });
    }, [localTitle, onSave, isComposing, onNoteExtracted]);

    const handleCancel = useCallback(() => {
        if (hasCommittedRef.current) return;
        hasCommittedRef.current = true;
        onCancel();
    }, [onCancel]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        // IME変換中は何もしない
        if (e.nativeEvent.isComposing || isComposing) return;

        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
        // 通常の Enter は改行なのでそのまま
    }, [isComposing, handleSave, handleCancel]);

    const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        // console.log('[InlineTitleEditor] onChange', { length: val.length, val: val.slice(0, 20) });
        setLocalTitle(val);
    }, []);

    const handleBlur = useCallback(() => {
        // IME変換中でなければ保存
        if (!isComposing) {
            handleSave();
        }
    }, [isComposing, handleSave]);

    return (
        <textarea
            ref={textareaRef}
            value={localTitle}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData('text');
                console.log('[InlineTitleEditor] onPaste raw:', JSON.stringify(text));

                const { title: pastedTitle, bodyLines } = splitPastedText(text);

                const textarea = e.currentTarget;
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const currentVal = localTitle;

                // 1行目（タイトル分）を現在位置に挿入
                const newVal = currentVal.substring(0, start) + pastedTitle + currentVal.substring(end);
                setLocalTitle(newVal);

                // 2行目以降があればコールバックで親に渡す
                if (bodyLines.length > 0 && onNoteExtracted) {
                    onNoteExtracted(bodyLines, pastedTitle);
                    noteExtractedRef.current = true;
                    extractedTitleRef.current = pastedTitle;
                }

                // Cursor position update needs to happen after render
                requestAnimationFrame(() => {
                    if (textarea) {
                        textarea.setSelectionRange(start + pastedTitle.length, start + pastedTitle.length);
                    }
                });
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            // DnD/クリック競合回避
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={clsx(
                'w-full resize-none bg-transparent border-none outline-none',
                'text-[11px] font-semibold text-slate-800 leading-tight',
                'focus:ring-1 focus:ring-sky-300 rounded px-0.5',
                className
            )}
            style={{ maxHeight: MAX_HEIGHT_PX, overflow: 'auto' }}
            rows={1}
            placeholder="Untitled card"
        />
    );
}
