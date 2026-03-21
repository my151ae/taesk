"use client";

import { clsx } from "clsx";
import { useEffect, useMemo, useRef } from "react";
import {
    getShortcutContextLabel,
    getSortedShortcutDefinitions,
    type ShortcutDefinition,
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

function formatScope(scope: ShortcutDefinition["scope"]) {
    return scope === "board" ? "Board" : "Modal";
}

function formatRegions(regions: ShortcutDefinition["regions"]) {
    return regions.map((region) => getShortcutContextLabel(region)).join(" / ");
}

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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200">
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div
                ref={modalRef}
                className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100 shrink-0">
                    <div className="flex flex-col">
                        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Keyboard Shortcuts</h1>
                        <p className="text-sm text-slate-500 font-medium">現在の registry に登録されている一覧</p>
                    </div>

                    <div className="hidden md:flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <KeyIcon className="w-8 h-8 text-sm">⇧</KeyIcon>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Shift</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <KeyIcon className="w-8 h-8 text-sm">⌃</KeyIcon>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Control</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <KeyIcon className="w-8 h-8 text-sm">⌥</KeyIcon>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Option</span>
                        </div>
                        <div className="flex items-center gap-2">
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

                <div className="overflow-y-auto p-6 md:p-8">
                    <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="grid grid-cols-[110px_180px_minmax(220px,1fr)_90px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                            <span>Scope</span>
                            <span>Context</span>
                            <span>Shortcut</span>
                            <span className="text-right">Priority</span>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {rows.map((row) => (
                                <div
                                    key={row.id}
                                    className="grid grid-cols-[110px_180px_minmax(220px,1fr)_90px] gap-4 px-5 py-3"
                                >
                                    <div className="flex items-center">
                                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                            {formatScope(row.scope)}
                                        </span>
                                    </div>
                                    <div className="flex items-center text-sm font-medium text-slate-700">
                                        {formatRegions(row.regions)}
                                    </div>
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <ShortcutRow
                                            label={row.label}
                                            keys={row.keys.map((key) => <KeyIcon key={`${row.id}-${key}`}>{key}</KeyIcon>)}
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

                <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors uppercase tracking-widest shadow-lg shadow-slate-200"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}
