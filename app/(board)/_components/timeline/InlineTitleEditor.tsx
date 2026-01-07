'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent, ChangeEvent } from 'react';
import clsx from 'clsx';

// 最大高さ（6行分相当）
const MAX_HEIGHT_PX = 120;

type InlineTitleEditorProps = {
    title: string;
    onSave: (newTitle: string, previousTitle: string) => void;
    onCancel: () => void;
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
    className,
}: InlineTitleEditorProps) {
    // 編集開始時のタイトルを保持（ロールバック用）
    const initialTitleRef = useRef(title);
    const [localTitle, setLocalTitle] = useState(title);
    const [isComposing, setIsComposing] = useState(false);
    const hasCommittedRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 編集開始時にフォーカス
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.focus();
            // カーソルを末尾に移動
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
        // 編集開始時に hasCommittedRef をリセット
        hasCommittedRef.current = false;
    }, []);

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
        hasCommittedRef.current = true;
        onSave(localTitle, initialTitleRef.current);
    }, [localTitle, onSave, isComposing]);

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
        setLocalTitle(e.target.value);
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
