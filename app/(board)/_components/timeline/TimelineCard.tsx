import clsx from 'clsx';
import { ReactNode, CSSProperties, KeyboardEvent as ReactKeyboardEvent, useState, useCallback } from 'react';
import { InlineTitleEditor } from './InlineTitleEditor';

type TimelineCardProps = {
    title: string;
    checked: boolean;
    onToggleCheck: (checked: boolean) => void;
    badgeLabel?: string | null;
    duration?: number | null;
    timeText?: ReactNode;
    timePlacement?: 'top' | 'inline' | 'out-top';
    onOpen: () => void;
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
    openButtonTestId?: string;
    dataTestId?: string;
    tabIndex?: number;
    role?: string;
    onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
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
    timePlacement = 'top',
    onOpen,
    className,
    style,
    children,
    openButtonTestId,
    dataTestId,
    tabIndex,
    role,
    onKeyDown,
    childrenPosition = 'bottom',
    onTitleChange,
    isEditingTitle: externalIsEditing,
    onEditingChange,
}: TimelineCardProps) {
    // 内部編集状態（外部制御がない場合）
    const [internalIsEditing, setInternalIsEditing] = useState(false);
    const isEditing = externalIsEditing ?? internalIsEditing;

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
            className={clsx(
                'relative flex flex-col gap-2 border border-slate-200 bg-white px-[6px] py-3 text-left shadow-sm w-full max-w-full',
                className
            )}
            style={style}
            data-testid={dataTestId}
            tabIndex={tabIndex}
            role={role}
            onKeyDown={onKeyDown}
            onClick={handleCardClick}
        >
            {childrenPosition === 'top' && children}

            <div className="flex items-start gap-2 pr-6">
                <button
                    type="button"
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
                        "mt-0.5 flex h-4 w-4 items-center justify-center border border-slate-300 text-xs font-bold transition hover:border-sky-400",
                        checked ? "text-slate-800" : "text-transparent"
                    )}
                >
                    {checked ? '✓' : ''}
                </button>
                <div className="mt-1 flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-800">
                    {isEditing && onTitleChange ? (
                        <InlineTitleEditor
                            title={title}
                            onSave={handleSave}
                            onCancel={handleCancel}
                        />
                    ) : (
                        <span
                            className={clsx(
                                "leading-tight",
                                onTitleChange ? "cursor-text hover:bg-slate-50 rounded px-0.5 -mx-0.5" : "truncate",
                                !title && "text-slate-400"
                            )}
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

            {badgeLabel || duration ? (
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
