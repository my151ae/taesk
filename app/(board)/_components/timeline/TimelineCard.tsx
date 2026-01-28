import clsx from 'clsx';
import { ReactNode, CSSProperties, KeyboardEvent as ReactKeyboardEvent, useState, useCallback, useRef } from 'react';
import { InlineTitleEditor } from './InlineTitleEditor';

type TimelineCardProps = {
    title: string;
    checked: boolean;
    onToggleCheck: (checked: boolean) => void;
    badgeLabel?: string | null;
    timeText?: ReactNode;
    rightMeta?: ReactNode;
    timePlacement?: 'top' | 'inline' | 'out-top';
    paddingClass?: string;
    onOpen: () => void;
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
    openButtonTestId?: string;
    dataTestId?: string;
    tabIndex?: number;
    role?: string;
    onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    onOpenContextMenu?: (rect: DOMRect) => void;
    focusGroup?: 'timeline' | 'bucket';
    childrenPosition?: 'top' | 'bottom';
    /** 本文のプレビュー文字列 */
    note?: string;
    /** 本文に適用する line-clamp 等のクラスを指定。未指定なら高さクリップのみ。 */
    noteClampClass?: string;
    // インライン編集用 props
    onTitleChange?: (newTitle: string, previousTitle: string) => void;
    /** 編集中かどうかの外部制御（DnD無効化などに使用） */
    isEditingTitle?: boolean;
    onEditingChange?: (isEditing: boolean) => void;
    /** 背景色のクラス（デフォルト: bg-white） */
    backgroundClass?: string;
    onCreateNext?: () => void;
    /** インライン編集での貼り付け時に抽出された本文（2行目以降）を受け取る */
    onNoteExtracted?: (bodyLines: string[], updatedTitle?: string) => void;
};

export function TimelineCard({
    title,
    checked,
    onToggleCheck,
    badgeLabel,
    timeText,
    rightMeta,
    timePlacement = 'top',
    paddingClass = 'py-3',
    onOpen,
    className,
    style,
    children,
    openButtonTestId,
    dataTestId,
    tabIndex,
    role,
    onKeyDown,
    onOpenContextMenu,
    focusGroup,
    childrenPosition = 'bottom',
    note,
    noteClampClass,
    onTitleChange,
    isEditingTitle: externalIsEditing,
    onEditingChange,
    backgroundClass = 'bg-white',
    onCreateNext,
    onNoteExtracted,
}: TimelineCardProps) {
    // 内部編集状態（外部制御がない場合）
    const [internalIsEditing, setInternalIsEditing] = useState(false);
    const isEditing = externalIsEditing ?? internalIsEditing;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const checkboxRef = useRef<HTMLDivElement | null>(null);
    const titleRef = useRef<HTMLSpanElement | null>(null);

    const setIsEditing = useCallback((value: boolean) => {
        setInternalIsEditing(value);
        onEditingChange?.(value);
    }, [onEditingChange]);

    const handleTitleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        // タイトル部分はクリックで即座に編集開始
        if (onTitleChange && !isEditing) {
            setIsEditing(true);
        }
    }, [onTitleChange, isEditing, setIsEditing]);

    // クリック開始時にフォーカスがあったかどうかを保持するref
    const wasFocusedRef = useRef(false);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // ドラッグ動作を阻害しないよう stopPropagation は行わない
        // マウスダウンの時点でフォーカスがあるかチェック
        wasFocusedRef.current = (document.activeElement === containerRef.current);
    }, []);

    const handleContainerClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation(); // イベント伝播を止める
        // コンテナ（タイトル以外）をクリックした場合
        // マウスダウン時に既にフォーカスがあった（＝選択されていた）場合はモーダルを開く
        if (wasFocusedRef.current) {
            onOpen();
        } else {
            // フォーカスがなかった場合はフォーカスさせる（選択状態にする）
            containerRef.current?.focus();
        }
    }, [onOpen]);

    const handleSave = useCallback((newTitle: string, previousTitle: string) => {
        setIsEditing(false);
        onTitleChange?.(newTitle, previousTitle);
        // 編集完了後にカードにフォーカスを戻す
        requestAnimationFrame(() => {
            containerRef.current?.focus();
        });
    }, [onTitleChange, setIsEditing]);

    const handleCancel = useCallback(() => {
        setIsEditing(false);
        // キャンセル時もフォーカスを戻す
        requestAnimationFrame(() => {
            containerRef.current?.focus();
        });
    }, [setIsEditing]);

    return (
        <div
            ref={containerRef}
            className={clsx(
                'relative flex flex-row items-stretch border border-slate-200 text-left shadow-sm w-full max-w-full outline-none transition-shadow',
                backgroundClass, // 背景色を適用
                paddingClass === 'py-3' ? 'py-0' : '', // パディングの調整
                'hover:ring-2 hover:ring-sky-200', // ホバー時のリング
                'focus:ring-2 focus:ring-sky-500', // フォーカス時のリング
                'focus:z-10',
                className
            )}
            style={style}
            data-testid={dataTestId}
            tabIndex={tabIndex ?? 0}
            role={role}
            data-focus-group={focusGroup}
            data-focus-part={focusGroup ? 'card' : undefined}
            onMouseDown={handleMouseDown}
            onClick={handleContainerClick}
            onKeyDown={(event) => {
                if (!isEditing) {
                    // Title editing: Cmd+Enter or Ctrl+Enter
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        if (onTitleChange) {
                            setIsEditing(true);
                        }
                        return;
                    }

                    // Create next card: Enter
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        if (onCreateNext) {
                            onCreateNext();
                        } else {
                            // フォールバック: コンテキストメニュー (既存挙動維持が必要な場合)
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (rect) onOpenContextMenu?.(rect);
                        }
                        return;
                    }

                    // Toggle Check: Space
                    if (event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleCheck(!checked);
                        return;
                    }

                }
                onKeyDown?.(event);
            }}
        >
            <div className="relative flex flex-1 flex-col min-w-0">
                <div className={clsx(
                    "flex flex-1 flex-col gap-2 min-w-0 overflow-hidden min-h-0",
                    "pl-[3px] pr-[3px]",
                    // 時間がカード内に表示される場合は上部パディングを設けて重なりを防止
                    (timePlacement === 'top' && timeText) ? "pt-4 pb-1" : (paddingClass === 'py-3' ? "pt-1 pb-3" : "pt-1 pb-1")
                )}>
                    {childrenPosition === 'top' && children}

                    <div className="flex items-center gap-1 pr-0 pt-0">
                        <div
                            role="checkbox"
                            aria-checked={checked}
                            ref={checkboxRef}
                            data-focus-group={focusGroup}
                            data-focus-part={focusGroup ? 'checkbox' : undefined}
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleCheck(!checked);
                            }}
                            aria-label={checked ? '未完了に戻す' : '完了にする'}
                            onPointerDown={(e) => e.stopPropagation()}
                            className={clsx(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-md border-2 transition-all cursor-pointer",
                                checked
                                    ? "bg-slate-400 border-slate-400"
                                    : "bg-white border-slate-300 hover:border-sky-400"
                            )}
                        >
                            {checked && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </div>
                        <div className={clsx(
                            "flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-800 pt-0.5"
                        )}>
                            <div className="flex min-w-0 items-center gap-2">
                                {isEditing && onTitleChange ? (
                                    <div className="min-w-0 flex-1">
                                        <InlineTitleEditor
                                            title={title}
                                            onSave={handleSave}
                                            onCancel={handleCancel}
                                            onNoteExtracted={onNoteExtracted}
                                        />
                                    </div>
                                ) : (
                                    <span
                                        className={clsx(
                                            "truncate leading-tight",
                                            onTitleChange ? "cursor-text hover:bg-slate-50 rounded px-0.5 -mx-0.5" : "",
                                            !title && "text-slate-400"
                                        )}
                                        ref={onTitleChange ? titleRef : undefined}
                                        data-focus-group={focusGroup}
                                        data-focus-part={focusGroup ? 'title' : undefined}
                                        onClick={onTitleChange ? handleTitleClick : undefined}
                                        onPointerDown={onTitleChange ? (e) => e.stopPropagation() : undefined}
                                        tabIndex={-1}
                                        role={onTitleChange ? "button" : undefined}
                                        aria-label={onTitleChange ? "タイトルを編集" : undefined}
                                        onKeyDown={onTitleChange ? (e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                handleTitleClick(e as any);
                                            }
                                        } : undefined}
                                    >
                                        {title || "Untitled card"}
                                    </span>
                                )}
                            </div>
                            {timePlacement === 'inline' && timeText ? (
                                <span className="text-[10px] font-normal text-slate-500">{timeText}</span>
                            ) : null}
                        </div>
                    </div>

                    {note ? (
                        <div
                            className={clsx(
                                "flex flex-col gap-0.5 text-[10px] text-slate-600 leading-tight min-w-0"
                            )}
                        >
                            {(() => {
                                const lines = note.split(/\r?\n/);
                                const processedTitle = title.trim().toLowerCase();

                                // 先頭数行をチェックして、タイトルと実質的に同じ内容であればスキップ
                                // content の 1行目が taskItem なので、excerpt の冒頭は通常 "[ ] タイトル" または "タイトル" になる
                                let skipCount = 0;
                                if (lines.length > 0) {
                                    const firstLine = lines[0].trim();
                                    // "[ ] title" または "title" そのものに一致するか判定
                                    const taskMatch = firstLine.match(/^\[[ xX]\]\s?(.*)$/);
                                    const firstLineContent = (taskMatch ? taskMatch[1] : firstLine).trim().toLowerCase();

                                    if (firstLineContent === processedTitle || (processedTitle === "" && firstLineContent === "")) {
                                        skipCount = 1;
                                    }
                                }

                                return lines.slice(skipCount).map((line, idx) => {
                                    const taskMatch = line.match(/^([\s\u00A0]*)\[([ xX])\]\s?(.*)$/);
                                    const isTask = Boolean(taskMatch);
                                    const indentRaw = taskMatch?.[1] ?? '';
                                    const indentLevel = indentRaw.split('').reduce((acc, char) => acc + (char === '\t' ? 2 : 1), 0);
                                    const checked = taskMatch?.[2]?.toLowerCase() === 'x';
                                    const text = isTask ? (taskMatch?.[3] ?? '') : line;

                                    if (!text.trim() && !isTask) return null;

                                    return (
                                        <div
                                            key={`line-${idx}`}
                                            className="flex items-start gap-1 w-full min-w-0"
                                            style={isTask && indentLevel > 0 ? { paddingLeft: `${indentLevel * 6}px` } : undefined}
                                        >
                                            {isTask ? (
                                                <span
                                                    className={clsx(
                                                        "h-3 w-3 rounded-[3px] border flex items-center justify-center shrink-0 mt-[1px]",
                                                        checked ? "bg-slate-500 border-slate-500" : "border-slate-400"
                                                    )}
                                                    aria-hidden="true"
                                                >
                                                    {checked ? (
                                                        <svg className="h-2 w-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    ) : null}
                                                </span>
                                            ) : null}
                                            <span className="line-clamp-2">{text || '\u00A0'}</span>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    ) : null}

                    {childrenPosition === 'bottom' && children}
                </div>

                {timePlacement === 'top' && timeText ? (
                    <div className="absolute top-0 left-[6px] pl-0 pr-1 text-[10px] font-semibold text-slate-600 z-20 pointer-events-none whitespace-nowrap max-w-[calc(100%-12px)] overflow-hidden text-ellipsis">
                        {timeText}
                    </div>
                ) : null}

                {timePlacement === 'out-top' && timeText ? (
                    <div className="absolute -top-4 left-[6px] pl-0 pr-1 text-[10px] font-semibold text-slate-600 whitespace-nowrap z-10 pointer-events-none">
                        {timeText}
                    </div>
                ) : null}
            </div>

            {rightMeta ? (
                <div className={clsx(
                    "flex shrink-0 items-center justify-center",
                    (timePlacement === 'top' && timeText) ? "pt-4 pb-1" : "py-1"
                )}>
                    <div className="h-full w-px bg-slate-200" />
                    <div className="flex items-center justify-center px-1">
                        <span className="text-[10px] font-semibold text-slate-600 leading-none">
                            [{rightMeta}]
                        </span>
                    </div>
                </div>
            ) : null}

            {badgeLabel && !['A', 'B'].includes(badgeLabel.toUpperCase()) ? (
                <button
                    type="button"
                    className="absolute top-[3px] right-[6px] flex items-center justify-center rounded-md bg-slate-100 px-1.5 py-0.5"
                    aria-label="カードを開く"
                    data-testid={openButtonTestId}
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpen();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    tabIndex={-1}
                >
                    <span className="text-[10px] font-bold leading-none text-slate-500">
                        {badgeLabel || ''}
                    </span>
                </button>
            ) : null}
        </div>
    );
}
