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

    const handleCardClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        // 編集中はカードを開かない
        if (!isEditing) {
            onOpen();
        }
    }, [isEditing, onOpen]);

    return (
        <div
            ref={containerRef}
            className={clsx(
                'relative flex flex-col gap-2 border border-slate-200 bg-white px-[6px] text-left shadow-sm w-full max-w-full',
                paddingClass,
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
            onClick={handleCardClick}
        >
            {childrenPosition === 'top' && children}

            <div className="flex items-start gap-2 pr-0">
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
                            // Enterでトグルではなくモーダルを開く
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
                        "flex h-4 w-4 items-center justify-center border border-slate-300 text-xs font-bold transition hover:border-sky-400",
                        alignTop ? "mt-0" : "mt-0.5",
                        checked ? "text-slate-800" : "text-transparent"
                    )}
                >
                    {checked ? '✓' : ''}
                </button>
                <div className={clsx(
                    "flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-800",
                    alignTop ? "mt-0" : "mt-1"
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
                        {rightMeta ? (
                            <span className="ml-auto shrink-0 text-[10px] font-semibold text-slate-500 text-right">
                                {rightMeta}
                            </span>
                        ) : null}
                    </div>
                    {timePlacement === 'inline' && timeText ? (
                        <span className="text-[10px] font-normal text-slate-500">{timeText}</span>
                    ) : null}
                </div>
            </div>

            {timePlacement === 'top' && timeText ? (
                <div className="absolute top-0 left-[6px] pl-0 pr-1 text-[10px] font-semibold text-slate-600">
                    {timeText}
                </div>
            ) : null}

            {timePlacement === 'out-top' && timeText ? (
                <div className="absolute -top-4 left-[6px] pl-0 pr-1 text-[10px] font-semibold text-slate-600 w-max">
                    {timeText}
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

            {childrenPosition === 'bottom' && children}
        </div>
    );
}
