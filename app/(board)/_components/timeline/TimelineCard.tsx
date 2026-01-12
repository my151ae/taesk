import clsx from 'clsx';
import { ReactNode, CSSProperties, KeyboardEvent as ReactKeyboardEvent, useState, useCallback, useRef } from 'react';
import { InlineTitleEditor } from './InlineTitleEditor';

type TimelineCardProps = {
    title: string;
    checked: boolean;
    onToggleCheck: (checked: boolean) => void;
    badgeLabel?: string | null;
    duration?: number | null;
    timeText?: ReactNode;
    rightMeta?: ReactNode;
    timePlacement?: 'top' | 'inline' | 'out-top';
    alignTop?: boolean;
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
    // インライン編集用 props
    onTitleChange?: (newTitle: string, previousTitle: string) => void;
    /** 編集中かどうかの外部制御（DnD無効化などに使用） */
    isEditingTitle?: boolean;
    onEditingChange?: (isEditing: boolean) => void;
};

export function TimelineCard({
    title,
    checked,
    onToggleCheck,
    badgeLabel,
    duration,
    timeText,
    rightMeta,
    timePlacement = 'top',
    alignTop = false,
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
    onTitleChange,
    isEditingTitle: externalIsEditing,
    onEditingChange,
}: TimelineCardProps) {
    // 内部編集状態（外部制御がない場合）
    const [internalIsEditing, setInternalIsEditing] = useState(false);
    const isEditing = externalIsEditing ?? internalIsEditing;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const checkboxRef = useRef<HTMLButtonElement | null>(null);
    const titleRef = useRef<HTMLSpanElement | null>(null);

    const setIsEditing = useCallback((value: boolean) => {
        setInternalIsEditing(value);
        onEditingChange?.(value);
    }, [onEditingChange]);

    const handleTitleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (onTitleChange && !isEditing) {
            setIsEditing(true);
        }
    }, [onTitleChange, isEditing, setIsEditing]);

    const handleSave = useCallback((newTitle: string, previousTitle: string) => {
        setIsEditing(false);
        onTitleChange?.(newTitle, previousTitle);
    }, [onTitleChange, setIsEditing]);

    const handleCancel = useCallback(() => {
        setIsEditing(false);
    }, [setIsEditing]);

    return (
        <div
            ref={containerRef}
            className={clsx(
                'relative flex flex-row items-stretch border border-slate-200 bg-white text-left shadow-sm w-full max-w-full outline-none',
                paddingClass === 'py-3' ? 'py-0' : '', // パディングの調整
                className
            )}
            style={style}
            data-testid={dataTestId}
            tabIndex={tabIndex}
            role={role}
            data-focus-group={focusGroup}
            data-focus-part={focusGroup ? 'card' : undefined}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && !isEditing) {
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenContextMenu?.(rect);
                        return;
                    }
                }
                onKeyDown?.(event);
            }}
        >
            <div className="relative flex flex-1 flex-col min-w-0">
                <div className={clsx(
                    "flex flex-1 flex-col gap-2 min-w-0",
                    "pl-[3px] pr-[3px]",
                    // 時間がカード内に表示される場合は上部パディングを設けて重なりを防止
                    (timePlacement === 'top' && timeText) ? "pt-4 pb-1" : (paddingClass === 'py-3' ? "pt-1 pb-3" : "pt-1 pb-1")
                )}>
                    {childrenPosition === 'top' && children}

                    <div className="flex items-center gap-1 pr-0 pt-0">
                        <button
                            type="button"
                            ref={checkboxRef}
                            data-focus-group={focusGroup}
                            data-focus-part={focusGroup ? 'checkbox' : undefined}
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleCheck(!checked);
                            }}
                            aria-label={checked ? '未完了に戻す' : '完了にする'}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (!isEditing) {
                                        onOpen();
                                    }
                                } else if (e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onToggleCheck(!checked);
                                }
                            }}
                            className={clsx(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-md border-2 transition-all",
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
                        </button>
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
                                        tabIndex={onTitleChange ? 0 : undefined}
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

                    {childrenPosition === 'bottom' && children}
                </div>

                {timePlacement === 'top' && timeText ? (
                    <div className="absolute top-0 left-[6px] pl-0 pr-1 text-[10px] font-semibold text-slate-600 z-20 pointer-events-none whitespace-nowrap max-w-[calc(100%-12px)]">
                        <span className="inline-block overflow-hidden text-ellipsis">{timeText}</span>
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
                    "flex shrink-0 items-start justify-center px-1",
                    (timePlacement === 'top' && timeText) ? "pt-4" : "pt-1"
                )}>
                    <div
                        className="flex items-center justify-center rounded bg-white px-[2px] h-4 min-w-[32px] ring-1 ring-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all cursor-pointer"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpen();
                        }}
                    >
                        <span className="text-[10px] font-bold text-slate-700 leading-none">
                            &gt; {rightMeta}
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
