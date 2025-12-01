import clsx from 'clsx';
import { ReactNode, CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';

type TimelineCardProps = {
    title: string;
    checked: boolean;
    onToggleCheck: (checked: boolean) => void;
    badgeLabel?: string | null;
    timeText?: ReactNode;
    timePlacement?: 'top' | 'inline';
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
};

export function TimelineCard({
    title,
    checked,
    onToggleCheck,
    badgeLabel,
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
}: TimelineCardProps) {
    return (
        <div
            className={clsx(
                'relative flex flex-col gap-2 border border-slate-200 bg-white p-3 text-left shadow-sm w-full max-w-full',
                className
            )}
            style={style}
            data-testid={dataTestId}
            tabIndex={tabIndex}
            role={role}
            onKeyDown={onKeyDown}
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
                    className={clsx(
                        "mt-0.5 flex h-4 w-4 items-center justify-center border border-slate-300 text-xs font-bold transition hover:border-sky-400",
                        checked ? "text-slate-800" : "text-transparent"
                    )}
                >
                    {checked ? '✓' : ''}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-800">
                    <span className="leading-tight truncate">{title || 'Untitled card'}</span>
                    {timePlacement === 'inline' && timeText ? (
                        <span className="text-[10px] font-normal text-slate-500">{timeText}</span>
                    ) : null}
                </div>
            </div>

            {timePlacement === 'top' && timeText ? (
                <div className="absolute top-0.5 left-0 px-1 text-[10px] font-semibold text-slate-600">
                    {timeText}
                </div>
            ) : null}

            {badgeLabel ? (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpen();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute top-2 right-2 flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
                    aria-label="Open card"
                    data-testid={openButtonTestId}
                >
                    <span className="text-[11px] font-bold leading-none">{badgeLabel}</span>
                    <span aria-hidden="true" className="text-[12px] leading-none">
                        ›
                    </span>
                </button>
            ) : null}

            {childrenPosition === 'bottom' && children}
        </div>
    );
}
