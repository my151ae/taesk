import clsx from 'clsx';
import {
    ReactNode,
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    FocusEvent as ReactFocusEvent,
    PointerEvent as ReactPointerEvent,
    MouseEvent as ReactMouseEvent,
    useEffect,
    useRef,
    useCallback,
    useState
} from 'react';
import type { JSONContent } from '@tiptap/react';
import type { Checklist } from '@/lib/checklist';
import { countCheckedLines, countNonEmptyLines } from '@/lib/checklist';
import { getTiptapPlainText, normalizeContent } from '@/lib/tiptap';
import {
    buildShortcutDataAttributes,
    type ShortcutContextDescriptor,
} from '@/app/(board)/_components/timeline/shortcut-bar-registry';

export const TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS = 'line-clamp-3';
const NOTE_PREVIEW_LINE_HEIGHT_EM = 1.25;
const NOTE_PREVIEW_ROW_GAP_EM = 0.125;
const CARD_LEFT_COLUMN_WIDTH = '1.2rem';
const CARD_LEFT_CELL_X_PADDING = '1px';
const CARD_RIGHT_CELL_X_PADDING = '4px';
const CARD_TOP_CELL_Y_PADDING = '1px';
const CARD_BODY_TOP_PADDING = '4px';
const CARD_TOP_ROW_MIN_HEIGHT = '1.2rem';

type TimelineCardProps = {
    title: string;
    checked: boolean;
    checklist?: Checklist | null;
    content?: JSONContent | null;
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
    onFocus?: (event: ReactFocusEvent<HTMLDivElement>) => void;
    onBlur?: (event: ReactFocusEvent<HTMLDivElement>) => void;
    childrenPosition?: 'top' | 'bottom';
    /** 本文のプレビュー文字列 */
    note?: string;
    /** 本文に適用する line-clamp 等のクラスを指定。未指定なら高さクリップのみ。 */
    noteClampClass?: string;
    /** 本文プレビュー領域の最大行数。高さクリップ用に使う。 */
    notePreviewLines?: number;
    /** 背景色のクラス（デフォルト: bg-white） */
    backgroundClass?: string;
    borderClassName?: string;
    onCreateNext?: () => void;
    /** フォーカス復帰用のカードID */
    cardId?: string;
    /** タイトル部分に適用する追加のクラス */
    titleClassName?: string;
    /** タイトルの背景に適用する追加のクラス */
    titleBackgroundClassName?: string;
    /** 左側のチェックボックス列を非表示にするか */
    hideLeftColumn?: boolean;
    shortcutContext?: ShortcutContextDescriptor | null;
    checkedVisualTone?: 'default' | 'timeline-dim';
    isSelected?: boolean;
    selectionLane?: string | null;
    onShiftSelect?: (args: {
        cardId: string;
        laneId: string;
        activeCardId: string | null;
        activeLaneId: string | null;
    }) => void;
    onClearSelection?: () => void;
    onActivateCard?: (cardId: string, laneId: string) => void;
    activeCardId?: string | null;
    activeLaneId?: string | null;
    inlineTitleEdit?: boolean;
    onRenameTitle?: (nextTitle: string) => Promise<void>;
    onTitleEditStateChange?: (editing: boolean) => void;
    autoStartTitleEdit?: boolean;
    onAutoStartTitleEditConsumed?: () => void;
    showOpenButton?: boolean;
};

export function TimelineCard({
    title,
    checked,
    checklist,
    content,
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
    onFocus,
    onBlur,
    childrenPosition = 'bottom',
    note,
    noteClampClass,
    notePreviewLines = 2,
    backgroundClass = 'bg-white',
    borderClassName,
    onCreateNext,
    cardId,
    titleClassName,
    titleBackgroundClassName,
    hideLeftColumn = false,
    shortcutContext,
    checkedVisualTone = 'default',
    isSelected = false,
    selectionLane = null,
    onShiftSelect,
    onClearSelection,
    onActivateCard,
    activeCardId = null,
    activeLaneId = null,
    inlineTitleEdit = false,
    onRenameTitle,
    onTitleEditStateChange,
    autoStartTitleEdit = false,
    onAutoStartTitleEditConsumed,
    showOpenButton = false,
}: TimelineCardProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const checkboxRef = useRef<HTMLDivElement | null>(null);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const isComposingRef = useRef(false);
    const isSubmittingTitleRef = useRef(false);
    const resolvedNoteClampClass =
        noteClampClass ?? (notePreviewLines >= 3 ? TIMELINE_LIST_CARD_NOTE_CLAMP_CLASS : 'line-clamp-2');
    const notePreviewMaxHeightEm = notePreviewLines > 0
        ? (notePreviewLines * NOTE_PREVIEW_LINE_HEIGHT_EM) + ((notePreviewLines - 1) * NOTE_PREVIEW_ROW_GAP_EM)
        : 0;
    const plainTextFromContent = content ? getTiptapPlainText(normalizeContent(content)) : '';
    const contentChecklistProgress = plainTextFromContent
        .split(/\r?\n/)
        .reduce(
            (acc, line) => {
                const match = line.match(/^\s*\[([ xX])\]\s+(.*)$/);
                if (!match || !match[2]?.trim()) return acc;
                acc.total += 1;
                if (match[1].toLowerCase() === 'x') {
                    acc.checked += 1;
                }
                return acc;
            },
            { checked: 0, total: 0 }
        );
    const checklistTotalCount = countNonEmptyLines(checklist) || contentChecklistProgress.total;
    const checklistCheckedCount = countCheckedLines(checklist) || contentChecklistProgress.checked;
    const checklistProgressLabel = checklistTotalCount > 0 ? `${checklistCheckedCount}/${checklistTotalCount}` : null;
    const hasBodySection = Boolean(note || checklistProgressLabel);
    const isTimelineDimChecked = checked && checkedVisualTone === 'timeline-dim';
    const inlineBadgeLabel = badgeLabel && !['A', 'B'].includes(badgeLabel.toUpperCase()) ? badgeLabel : null;
    const resolvedBackgroundClass = isTimelineDimChecked ? 'bg-slate-100' : backgroundClass;
    const resolvedBorderClassName = borderClassName ?? (isTimelineDimChecked ? 'border-slate-200 shadow-none' : 'border-slate-200');
    const checkedTextClassName = isTimelineDimChecked ? 'text-slate-400 line-through decoration-slate-400 decoration-1' : '';
    const checkedMetaTextClassName = isTimelineDimChecked ? 'text-slate-400' : '';
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [draftTitle, setDraftTitle] = useState(title);

    // クリック開始時にフォーカスがあったかどうかを保持するref
    const wasFocusedRef = useRef(false);

    useEffect(() => {
        if (!isEditingTitle) {
            setDraftTitle(title);
        }
    }, [isEditingTitle, title]);

    useEffect(() => {
        onTitleEditStateChange?.(isEditingTitle);
    }, [isEditingTitle, onTitleEditStateChange]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const input = titleInputRef.current;
        if (!input) return;
        input.focus();
        input.select();
    }, [isEditingTitle]);

    const restoreCardFocus = useCallback(() => {
        requestAnimationFrame(() => {
            containerRef.current?.focus();
        });
    }, []);

    const finishTitleEditing = useCallback((nextEditing: boolean) => {
        setIsEditingTitle(nextEditing);
        if (!nextEditing) {
            restoreCardFocus();
        }
    }, [restoreCardFocus]);

    const activateCardForTitleEditing = useCallback(() => {
        if (cardId && selectionLane) {
            onActivateCard?.(cardId, selectionLane);
        }
        onClearSelection?.();
    }, [cardId, onActivateCard, onClearSelection, selectionLane]);

    useEffect(() => {
        if (!autoStartTitleEdit) return;

        if (!inlineTitleEdit || !onRenameTitle) {
            onAutoStartTitleEditConsumed?.();
            return;
        }

        activateCardForTitleEditing();
        setDraftTitle(title);
        setIsEditingTitle(true);
        onAutoStartTitleEditConsumed?.();
    }, [
        activateCardForTitleEditing,
        autoStartTitleEdit,
        inlineTitleEdit,
        onAutoStartTitleEditConsumed,
        onRenameTitle,
        title,
    ]);

    const commitTitleChange = useCallback(async () => {
        if (!inlineTitleEdit || !onRenameTitle || isSubmittingTitleRef.current) {
            finishTitleEditing(false);
            return;
        }

        const trimmedTitle = draftTitle.trim();
        const previousTitle = title;
        if (!trimmedTitle || trimmedTitle === previousTitle) {
            setDraftTitle(previousTitle);
            finishTitleEditing(false);
            return;
        }

        isSubmittingTitleRef.current = true;
        finishTitleEditing(false);
        try {
            await onRenameTitle(trimmedTitle);
        } catch {
            setDraftTitle(previousTitle);
        } finally {
            isSubmittingTitleRef.current = false;
        }
    }, [draftTitle, finishTitleEditing, inlineTitleEdit, onRenameTitle, title]);

    const cancelTitleEditing = useCallback(() => {
        setDraftTitle(title);
        finishTitleEditing(false);
    }, [finishTitleEditing, title]);

    const handleTitleDisplayPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!inlineTitleEdit) return;
        event.stopPropagation();
    }, [inlineTitleEdit]);

    const handleTitleDisplayClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
        if (!inlineTitleEdit || !onRenameTitle) return;
        event.preventDefault();
        event.stopPropagation();
        activateCardForTitleEditing();
        setDraftTitle(title);
        setIsEditingTitle(true);
    }, [activateCardForTitleEditing, inlineTitleEdit, onRenameTitle, title]);

    const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
        if (isEditingTitle) {
            e.stopPropagation();
            return;
        }
        if (e.shiftKey && onShiftSelect && cardId && selectionLane) {
            e.preventDefault();
            e.stopPropagation();
            onShiftSelect({
                cardId,
                laneId: selectionLane,
                activeCardId,
                activeLaneId,
            });
            wasFocusedRef.current = false;
            return;
        }

        // ドラッグ動作を阻害しないよう stopPropagation は行わない
        // ポインターダウン時点でフォーカスがあるかチェック
        wasFocusedRef.current = (document.activeElement === containerRef.current);
    }, [activeCardId, activeLaneId, cardId, isEditingTitle, onShiftSelect, selectionLane]);

    const handleContainerClick = useCallback((e: React.MouseEvent) => {
        if (isEditingTitle) {
            e.stopPropagation();
            return;
        }
        if (e.shiftKey && onShiftSelect && cardId && selectionLane) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        e.stopPropagation(); // イベント伝播を止める
        if (cardId && selectionLane) {
            onActivateCard?.(cardId, selectionLane);
        }
        onClearSelection?.();
        // コンテナ（タイトル以外）をクリックした場合
        // マウスダウン時に既にフォーカスがあった（＝選択されていた）場合はモーダルを開く
        if (wasFocusedRef.current) {
            onOpen();
        } else {
            // フォーカスがなかった場合はフォーカスさせる（選択状態にする）
            containerRef.current?.focus();
        }
    }, [cardId, isEditingTitle, onActivateCard, onClearSelection, onOpen, onShiftSelect, selectionLane]);

    const renderRightMeta = useCallback(() => {
        if (typeof rightMeta === "string") {
            const match = rightMeta.match(/^(\d+h)(\d+m)$/);
            if (match) {
                return (
                    <span className="text-[10px] font-semibold text-slate-600 leading-[1.05] text-center">
                        [{match[1]}<br />{match[2]}]
                    </span>
                );
            }
        }

        return (
            <span className="text-[10px] font-semibold text-slate-600 leading-none">
                [{rightMeta}]
            </span>
        );
    }, [rightMeta]);
    const handleOpenButtonClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
    }, [onOpen]);
    const shortcutAttributes = shortcutContext ? buildShortcutDataAttributes(shortcutContext) : undefined;
    const handleFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
        if (cardId && selectionLane) {
            onActivateCard?.(cardId, selectionLane);
        }
        onFocus?.(event);
    }, [cardId, onActivateCard, onFocus, selectionLane]);

    return (
        <div
            ref={containerRef}
            className={clsx(
                'relative flex flex-row items-stretch border text-left shadow-sm w-full max-w-full outline-none transition-shadow',
                resolvedBackgroundClass,
                resolvedBorderClassName,
                isSelected && "border-sky-500 bg-sky-50/90 shadow-[0_0_0_2px_rgba(14,165,233,0.18)] before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-l before:bg-sky-500 before:content-['']",
                paddingClass === 'py-3' ? 'py-0' : '', // パディングの調整
                'hover:ring-2 hover:ring-sky-200', // ホバー時のリング
                'focus:ring-2 focus:ring-sky-500', // フォーカス時のリング
                'focus:z-10',
                className
            )}
            style={style}
            data-testid={dataTestId}
            data-card-id={cardId}
            data-selection-lane={selectionLane ?? undefined}
            data-selected={isSelected ? 'true' : undefined}
            data-checked-visual={isTimelineDimChecked ? 'timeline-dim' : undefined}
            {...shortcutAttributes}
            tabIndex={tabIndex ?? 0}
            role={role}
            data-focus-group={focusGroup}
            data-focus-part={focusGroup ? 'card' : undefined}
            onPointerDown={handlePointerDown}
            onClick={handleContainerClick}
            onFocus={handleFocus}
            onBlur={onBlur}
            onKeyDown={(event) => {
                // Create next card: Shift+Enter
                if (event.key === 'Enter' && event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (onCreateNext) {
                        onCreateNext();
                    }
                    return;
                }

                // Open card details: Enter
                if (event.key === 'Enter') {
                    if (isEditingTitle) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    onOpen();
                    return;
                }

                // Context menu: Delete
                if (event.key === 'Delete') {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) onOpenContextMenu?.(rect);
                    return;
                }

                // Toggle Check: Space
                if (event.key === ' ') {
                    if (isEditingTitle) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    onToggleCheck(!checked);
                    return;
                }

                onKeyDown?.(event);
            }}
        >
            <div className="relative flex flex-1 flex-col min-w-0">
                <div className={clsx(
                    "flex flex-1 flex-col gap-2 min-w-0 overflow-hidden min-h-0",
                    // 時間がカード内に表示される場合は上部パディングを設けて重なりを防止
                    (timePlacement === 'top' && timeText) ? "pt-4 pb-0.5" : (paddingClass === 'py-3' ? "pt-0.5 pb-1" : "py-0.5")
                )}>
                    {childrenPosition === 'top' && children}

                    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                        <div
                            className="pointer-events-none absolute inset-y-0 w-px"
                            aria-hidden="true"
                            style={{
                                left: CARD_LEFT_COLUMN_WIDTH,
                                backgroundImage: isTimelineDimChecked
                                    ? "repeating-linear-gradient(to bottom, rgb(226 232 240) 0 8px, transparent 8px 12px)"
                                    : "repeating-linear-gradient(to bottom, rgb(203 213 225) 0 8px, transparent 8px 12px)",
                            }}
                        />
                        <div
                            className="grid min-w-0"
                            style={{ gridTemplateColumns: hideLeftColumn ? "minmax(0, 1fr)" : `${CARD_LEFT_COLUMN_WIDTH} minmax(0, 1fr)` }}
                        >
                            {!hideLeftColumn && (
                                <div
                                    className="flex items-center justify-center"
                                    style={{
                                        minHeight: CARD_TOP_ROW_MIN_HEIGHT,
                                        paddingLeft: CARD_LEFT_CELL_X_PADDING,
                                        paddingRight: CARD_LEFT_CELL_X_PADDING,
                                        paddingTop: CARD_TOP_CELL_Y_PADDING,
                                        paddingBottom: CARD_TOP_CELL_Y_PADDING,
                                    }}
                                >
                                    <div
                                        role="checkbox"
                                        aria-checked={checked}
                                        ref={checkboxRef}
                                        data-focus-group={focusGroup}
                                        data-focus-part={focusGroup ? 'checkbox' : undefined}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onClearSelection?.();
                                            onToggleCheck(!checked);
                                        }}
                                        aria-label={checked ? '未完了に戻す' : '完了にする'}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        data-checkbox-tone={isTimelineDimChecked ? 'success' : 'default'}
                                        className={clsx(
                                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-md border-2 transition-all cursor-pointer",
                                            checked
                                                ? isTimelineDimChecked
                                                    ? 'border-emerald-500 bg-emerald-500'
                                                    : "border-slate-400 bg-slate-400"
                                                : "border-slate-300 bg-white hover:border-sky-400"
                                        )}
                                    >
                                        {checked && (
                                            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div
                                className="flex min-w-0 items-center"
                                style={{
                                    minHeight: CARD_TOP_ROW_MIN_HEIGHT,
                                    paddingLeft: CARD_RIGHT_CELL_X_PADDING,
                                    paddingRight: CARD_RIGHT_CELL_X_PADDING,
                                    paddingTop: CARD_TOP_CELL_Y_PADDING,
                                    paddingBottom: CARD_TOP_CELL_Y_PADDING,
                                }}
                            >
                                <div className={clsx(
                                    'flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] font-semibold',
                                    'text-slate-800',
                                    checkedTextClassName
                                )}>
                                    <div className="flex min-w-0 items-start gap-1">
                                        <span
                                            className="min-w-0 flex-1"
                                            data-focus-group={focusGroup}
                                            data-focus-part={focusGroup ? 'title' : undefined}
                                            tabIndex={-1}
                                        >
                                            {isEditingTitle ? (
                                                <input
                                                    ref={titleInputRef}
                                                    type="text"
                                                    value={draftTitle}
                                                    maxLength={255}
                                                    data-testid="timeline-card-title-input"
                                                    className={clsx(
                                                        'w-full min-w-0 rounded border border-sky-300 bg-white px-1 py-0.5 text-[11px] font-semibold leading-tight text-slate-900 shadow-sm outline-none ring-2 ring-sky-200',
                                                        titleBackgroundClassName,
                                                        titleClassName
                                                    )}
                                                    onPointerDown={(event) => {
                                                        event.stopPropagation();
                                                    }}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                    }}
                                                    onChange={(event) => {
                                                        setDraftTitle(event.target.value);
                                                    }}
                                                    onCompositionStart={() => {
                                                        isComposingRef.current = true;
                                                    }}
                                                    onCompositionEnd={() => {
                                                        isComposingRef.current = false;
                                                    }}
                                                    onKeyDown={(event) => {
                                                        event.stopPropagation();
                                                        if (event.key === 'Enter') {
                                                            if (isComposingRef.current) return;
                                                            event.preventDefault();
                                                            void commitTitleChange();
                                                            return;
                                                        }
                                                        if (event.key === 'Escape') {
                                                            event.preventDefault();
                                                            cancelTitleEditing();
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        if (isComposingRef.current) return;
                                                        void commitTitleChange();
                                                    }}
                                                />
                                            ) : (
                                                <span
                                                    className={clsx(
                                                        "line-clamp-2 break-words leading-tight",
                                                        inlineTitleEdit && onRenameTitle && (titleBackgroundClassName ? "cursor-text" : "cursor-text rounded px-0.5 hover:bg-sky-50"),
                                                        !title && "text-slate-400",
                                                        titleBackgroundClassName,
                                                        titleClassName
                                                    )}
                                                    data-testid="timeline-card-title-display"
                                                    onPointerDown={handleTitleDisplayPointerDown}
                                                    onClick={handleTitleDisplayClick}
                                                >
                                                    {title || "Untitled card"}
                                                </span>
                                            )}
                                        </span>
                                        {showOpenButton ? (
                                            <div className="flex shrink-0 items-center gap-1 pl-1">
                                                {inlineBadgeLabel ? (
                                                    <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-500 shadow-sm">
                                                        {inlineBadgeLabel}
                                                    </span>
                                                ) : null}
                                                <span
                                                    aria-hidden="true"
                                                    className={clsx(
                                                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                                                        isTimelineDimChecked
                                                            ? "border-slate-200 bg-white/80 text-slate-300"
                                                            : "border-slate-200 bg-white text-slate-400"
                                                    )}
                                                >
                                                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                                                        <circle cx="9" cy="7" r="1.25" />
                                                        <circle cx="15" cy="7" r="1.25" />
                                                        <circle cx="9" cy="12" r="1.25" />
                                                        <circle cx="15" cy="12" r="1.25" />
                                                        <circle cx="9" cy="17" r="1.25" />
                                                        <circle cx="15" cy="17" r="1.25" />
                                                    </svg>
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label="カードを開く"
                                                    data-testid={openButtonTestId}
                                                    className={clsx(
                                                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                                                        isTimelineDimChecked
                                                            ? "border-slate-200 bg-white/80 text-slate-400 hover:border-slate-300 hover:text-slate-500"
                                                            : "border-slate-200 bg-white text-slate-500 hover:border-sky-300 hover:text-sky-600"
                                                    )}
                                                    onClick={handleOpenButtonClick}
                                                    onPointerDown={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                    }}
                                                    tabIndex={-1}
                                                >
                                                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                        <path d="M14 5h5v5" />
                                                        <path d="M10 14 19 5" />
                                                        <path d="M19 14v4a1 1 0 0 1-1 1h-4" />
                                                        <path d="M10 5H6a1 1 0 0 0-1 1v4" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                    {timePlacement === 'inline' && timeText ? (
                                        <span className={clsx("text-[10px] font-normal text-slate-500", checkedMetaTextClassName)}>{timeText}</span>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        {hasBodySection ? (
                            <div
                                className={clsx(
                                    'grid min-h-0 min-w-0 flex-1 border-t',
                                    isTimelineDimChecked ? 'border-slate-100' : 'border-slate-200'
                                )}
                                style={{ gridTemplateColumns: hideLeftColumn ? "minmax(0, 1fr)" : `${CARD_LEFT_COLUMN_WIDTH} minmax(0, 1fr)` }}
                            >
                                {!hideLeftColumn && (
                                    <div
                                        className="flex min-h-0 items-start justify-center"
                                        style={{
                                            paddingLeft: CARD_LEFT_CELL_X_PADDING,
                                            paddingRight: CARD_LEFT_CELL_X_PADDING,
                                            paddingTop: CARD_BODY_TOP_PADDING,
                                        }}
                                    >
                                        {checklistProgressLabel ? (
                                            <div
                                                className={clsx(
                                                    'flex min-h-[3rem] flex-col items-center justify-start text-[11px] font-semibold leading-none tabular-nums',
                                                    'text-slate-500',
                                                    checkedMetaTextClassName
                                                )}
                                                aria-label={`チェックリスト ${checklistProgressLabel}`}
                                            >
                                                <span>{checklistCheckedCount}</span>
                                                <span className={clsx('my-1 h-px w-3', isTimelineDimChecked ? 'bg-slate-200' : 'bg-slate-300')} aria-hidden="true" />
                                                <span>{checklistTotalCount}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                )}

                                <div
                                    className={clsx(
                                        'flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 pt-1 text-[10px] leading-tight',
                                        'text-slate-600',
                                        checkedTextClassName
                                    )}
                                    style={{
                                        ...(note ? { maxHeight: `${notePreviewMaxHeightEm}em` } : {}),
                                        paddingLeft: CARD_RIGHT_CELL_X_PADDING,
                                        paddingRight: CARD_RIGHT_CELL_X_PADDING,
                                        paddingTop: CARD_BODY_TOP_PADDING,
                                    }}
                                >
                                    {note ? (() => {
                                        const lines = note
                                            .split(/\r?\n/)
                                            .map((line) => line)
                                            .filter((line) => {
                                                const taskMatch = line.match(/^([\s\u00A0]*)\[([ xX])\]\s?(.*)$/);
                                                if (taskMatch) return true;
                                                return Boolean(line.trim());
                                            });
                                        return lines.map((line, idx) => {
                                            const taskMatch = line.match(/^([\s\u00A0]*)\[([ xX])\]\s?(.*)$/);
                                            const isTask = Boolean(taskMatch);
                                            const indentRaw = taskMatch?.[1] ?? '';
                                            const indentLevel = indentRaw.split('').reduce((acc, char) => acc + (char === '\t' ? 2 : 1), 0);
                                            const checked = taskMatch?.[2]?.toLowerCase() === 'x';
                                            const text = isTask ? (taskMatch?.[3] ?? '') : line;

                                            return (
                                                <div
                                                    key={`line-${idx}`}
                                                    className="flex w-full min-w-0 items-start gap-1"
                                                    style={isTask && indentLevel > 0 ? { paddingLeft: `${indentLevel * 6}px` } : undefined}
                                                >
                                                    {isTask ? (
                                                        <span
                                                            className={clsx(
                                                                "mt-[1px] flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border",
                                                                checked ? "border-slate-500 bg-slate-500" : "border-slate-400"
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
                                                    <span
                                                        className={clsx('block min-w-0 w-0 flex-1 truncate')}
                                                    >
                                                        {text || '\u00A0'}
                                                    </span>
                                                </div>
                                            );
                                        });
                                    })() : (
                                        <div className="min-h-[3rem]" />
                                    )}
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {childrenPosition === 'bottom' && children}
                </div>

                {timePlacement === 'top' && timeText ? (
                    <div className={clsx(
                        'absolute top-0 left-[6px] z-20 max-w-[calc(100%-12px)] overflow-hidden text-ellipsis whitespace-nowrap pl-0 pr-1 text-[10px] font-semibold pointer-events-none',
                        isTimelineDimChecked ? 'text-slate-400 opacity-40' : 'text-slate-600'
                    )}>
                        {timeText}
                    </div>
                ) : null}

                {timePlacement === 'out-top' && timeText ? (
                    <div className={clsx(
                        'absolute -top-4 left-[6px] z-10 max-w-[calc(100%-40px)] overflow-hidden text-ellipsis whitespace-nowrap pl-0 pr-1 text-[10px] font-semibold pointer-events-none',
                        isTimelineDimChecked ? 'text-slate-400 opacity-40' : 'text-slate-600'
                    )}>
                        {timeText}
                    </div>
                ) : null}
            </div>

            {rightMeta ? (
                <div className={clsx(
                    'flex shrink-0 items-center justify-center',
                    isTimelineDimChecked ? 'opacity-35' : '',
                    (timePlacement === 'top' && timeText) ? "pt-4 pb-1" : "py-1"
                )}>
                    <div className={clsx('h-full w-px', isTimelineDimChecked ? 'bg-slate-100' : 'bg-slate-200')} />
                    <div className="flex items-center justify-center px-1">
                        {renderRightMeta()}
                    </div>
                </div>
            ) : null}

        </div>
    );
}
