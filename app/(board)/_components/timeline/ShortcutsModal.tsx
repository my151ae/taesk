"use client";

import { clsx } from "clsx";
import { useEffect, useMemo, useRef } from "react";
import {
    formatShortcutParts,
    formatShortcutRegions,
    formatShortcutScope,
    formatShortcutSections,
    formatShortcutViews,
    getSortedShortcutDefinitions,
} from "@/app/(board)/_components/timeline/shortcut-bar-registry";

type KeyIconProps = {
    children: React.ReactNode;
    className?: string;
};

function KeyIcon({ children, className }: KeyIconProps) {
    return (
        <span className={clsx(
            "inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md border border-slate-300 bg-white text-[11px] font-bold text-slate-700 shadow-sm",
            className
        )}>
            {children}
        </span>
    );
}

function ShiftKeyGlyph() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
            <path
                d="M12 4.25 18.35 10.6H14.9v7.15H9.1V10.6H5.65L12 4.25Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function renderKeyLabel(label: string) {
    if (label === "⇧") return <ShiftKeyGlyph />;
    return label;
}

type ShortcutRowProps = {
    label: string;
    keys: React.ReactNode[];
};

function ShortcutRow({ label, keys }: ShortcutRowProps) {
    return (
        <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-slate-600 font-medium">{label}</span>
            <div className="flex items-center gap-1">
                {keys.map((key, i) => (
                    <div key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-slate-400 text-[10px]">+</span>}
                        {typeof key === 'string' ? <KeyIcon>{key}</KeyIcon> : key}
                    </div>
                ))}
            </div>
        </div>
    );
}

type ShortcutsModalProps = {
    isOpen: boolean;
    onClose: () => void;
};

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
    const modalRef = useRef<HTMLDivElement>(null);
    const rows = useMemo(() => getSortedShortcutDefinitions(), []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        if (isOpen) {
            document.addEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "hidden";
        }
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "unset";
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-200">
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div
                ref={modalRef}
                className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-200"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 md:px-6 md:py-4 shrink-0">
                    <div className="flex flex-col">
                        <h1 className="text-lg font-bold text-slate-900 tracking-tight md:text-xl">Keyboard Shortcuts</h1>
                        <p className="text-xs font-medium text-slate-500 md:text-sm">現在の registry に登録されている一覧</p>
                    </div>

                    <div className="hidden md:flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <KeyIcon className="w-8 h-8 text-sm"><ShiftKeyGlyph /></KeyIcon>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Shift</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <KeyIcon className="w-8 h-8 text-sm">⌃</KeyIcon>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Control</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <KeyIcon className="w-8 h-8 text-sm">⌥</KeyIcon>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Option</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <KeyIcon className="w-8 h-8 text-sm">⌘</KeyIcon>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Command</span>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3 md:px-5 md:pb-5 md:pt-4">
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200">
                        <div className="grid grid-cols-[96px_112px_96px_96px_96px_minmax(220px,1fr)_90px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 shrink-0">
                            <span>Scope</span>
                            <span>Region</span>
                            <span>Section</span>
                            <span>View</span>
                            <span>Part</span>
                            <span>Shortcut</span>
                            <span className="text-right">Priority</span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">
                            {rows.map((row) => (
                                <div
                                    key={row.id}
                                    className="grid grid-cols-[96px_112px_96px_96px_96px_minmax(220px,1fr)_90px] gap-4 px-4 py-2.5"
                                >
                                    <div className="flex items-center">
                                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                            {formatShortcutScope(row.scope)}
                                        </span>
                                    </div>
                                    <div className="flex items-center text-sm font-medium text-slate-700">
                                        {formatShortcutRegions(row.regions)}
                                    </div>
                                    <div className="flex items-center text-sm font-medium text-slate-700">
                                        {formatShortcutSections(row.sections)}
                                    </div>
                                    <div className="flex items-center text-sm font-medium text-slate-700">
                                        {formatShortcutViews(row.views)}
                                    </div>
                                    <div className="flex items-center text-sm font-medium text-slate-700">
                                        {formatShortcutParts(row.parts)}
                                    </div>
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <ShortcutRow
                                            label={row.label}
                                            keys={row.keys.map((key) => (
                                                <KeyIcon key={`${row.id}-${key}`}>{renderKeyLabel(key)}</KeyIcon>
                                            ))}
                                        />
                                    </div>
                                    <div className="flex items-center justify-end text-sm font-semibold text-slate-500">
                                        {row.priorityBand}.{row.displayOrder}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-3 md:px-6 shrink-0">
                    <button
                        onClick={onClose}
                        className="rounded-xl bg-slate-900 px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-slate-800 shadow-lg shadow-slate-200"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}
