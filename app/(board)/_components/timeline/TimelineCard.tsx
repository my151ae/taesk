import clsx from 'clsx';
import {
    ReactNode,
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    FocusEvent as ReactFocusEvent,
    useRef,
    useCallback
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
    onCreateNext?: () => void;
    /** フォーカス復帰用のカードID */
    cardId?: string;
    /** タイトル部分に適用する追加のクラス */
    titleClassName?: string;
    /** 左側のチェックボックス列を非表示にするか */
    hideLeftColumn?: boolean;
    shortcutContext?: ShortcutContextDescriptor | null;
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
    onCreateNext,
    cardId,
    titleClassName,
    hideLeftColumn = false,
    shortcutContext,
}: TimelineCardProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const checkboxRef = useRef<HTMLDivElement | null>(null);
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
    const shortcutAttributes = shortcutContext ? buildShortcutDataAttributes(shortcutContext) : undefined;

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
            data-card-id={cardId}
            {...shortcutAttributes}
            tabIndex={tabIndex ?? 0}
            role={role}
            data-focus-group={focusGroup}
            data-focus-part={focusGroup ? 'card' : undefined}
            onMouseDown={handleMouseDown}
            onClick={handleContainerClick}
            onFocus={onFocus}
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
                                backgroundImage: "repeating-linear-gradient(to bottom, rgb(203 213 225) 0 8px, transparent 8px 12px)",
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
                                            onToggleCheck(!checked);
                                        }}
                                        aria-label={checked ? '未完了に戻す' : '完了にする'}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className={clsx(
                                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-md border-2 transition-all cursor-pointer",
                                            checked
                                                ? "border-slate-400 bg-slate-400"
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
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] font-semibold text-slate-800">
                                    <span
                                        className={clsx(
                                            "truncate leading-tight",
                                            !title && "text-slate-400",
                                            titleClassName
                                        )}
                                        data-focus-group={focusGroup}
                                        data-focus-part={focusGroup ? 'title' : undefined}
                                        tabIndex={-1}
                                    >
                                        {title || "Untitled card"}
                                    </span>
                                    {timePlacement === 'inline' && timeText ? (
                                        <span className="text-[10px] font-normal text-slate-500">{timeText}</span>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        {hasBodySection ? (
                            <div
                                className="grid min-h-0 min-w-0 flex-1 border-t border-slate-200"
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
                                                className="flex min-h-[3rem] flex-col items-center justify-start text-[11px] font-semibold leading-none text-slate-500 tabular-nums"
                                                aria-label={`チェックリスト ${checklistProgressLabel}`}
                                            >
                                                <span>{checklistCheckedCount}</span>
                                                <span className="my-1 h-px w-3 bg-slate-300" aria-hidden="true" />
                                                <span>{checklistTotalCount}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                )}

                                <div
                                    className={clsx(
                                        "flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 pt-1 text-[10px] leading-tight text-slate-600"
                                    )}
                                    style={{
                                        ...(note ? { maxHeight: `${notePreviewMaxHeightEm}em` } : {}),
                                        paddingLeft: CARD_RIGHT_CELL_X_PADDING,
                                        paddingRight: CARD_RIGHT_CELL_X_PADDING,
                                        paddingTop: CARD_BODY_TOP_PADDING,
                                    }}
                                >
                                    {note ? (() => {
                                        const lines = note.split(/\r?\n/);
                                        return lines.map((line, idx) => {
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
                                                    <span className={clsx(resolvedNoteClampClass)}>{text || '\u00A0'}</span>
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
                    <div className="absolute top-0 left-[6px] pl-0 pr-1 text-[10px] font-semibold text-slate-600 z-20 pointer-events-none whitespace-nowrap max-w-[calc(100%-12px)] overflow-hidden text-ellipsis">
                        {timeText}
                    </div>
                ) : null}

                {timePlacement === 'out-top' && timeText ? (
                    <div className="absolute -top-4 left-[6px] max-w-[calc(100%-32px)] overflow-hidden text-ellipsis whitespace-nowrap pl-0 pr-1 text-[10px] font-semibold text-slate-600 z-10 pointer-events-none">
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
                        {renderRightMeta()}
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
