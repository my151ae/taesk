"use client";

import { clsx } from "clsx";
import { useEffect, useRef } from "react";

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

type SectionProps = {
    title: string;
    children: React.ReactNode;
};

function Section({ title, children }: SectionProps) {
    return (
        <div className="flex flex-col gap-2">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mb-1">{title}</h2>
            <div className="flex flex-col">
                {children}
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
                        <p className="text-sm text-slate-500 font-medium">Power through your workflow</p>
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

                {/* Scrollable Grid */}
                <div className="p-8 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-10">
                    <Section title="General Navigation">
                        <ShortcutRow label="Move focus" keys={[<KeyIcon key="arrows" className="px-2">←↑↓→</KeyIcon>]} />
                        <ShortcutRow label="Next item" keys={["Tab"]} />
                        <ShortcutRow label="Previous item" keys={[<KeyIcon key="shift">⇧</KeyIcon>, "Tab"]} />
                    </Section>

                    <Section title="Card Actions">
                        <ShortcutRow label="Open card details" keys={["Enter"]} />
                        <ShortcutRow label="Toggle complete" keys={["Space"]} />
                        <ShortcutRow label="Create next card" keys={["Enter"]} />
                        <ShortcutRow label="Context menu" keys={["Enter (on focus)"]} />
                    </Section>

                    <Section title="Inline Editing">
                        <ShortcutRow label="Start title editing" keys={[<KeyIcon key="cmd">⌘</KeyIcon>, "Enter"]} />
                        <ShortcutRow label="New line" keys={["Enter"]} />
                        <ShortcutRow label="Save changes" keys={[<KeyIcon key="cmd">⌘</KeyIcon>, "Enter"]} />
                        <ShortcutRow label="Cancel editing" keys={["Esc"]} />
                    </Section>

                    <Section title="Scheduling">
                        <ShortcutRow label="Move 5m earlier" keys={[<KeyIcon key="opt">⌥</KeyIcon>, <KeyIcon key="up">↑</KeyIcon>]} />
                        <ShortcutRow label="Move 5m later" keys={[<KeyIcon key="opt">⌥</KeyIcon>, <KeyIcon key="down">↓</KeyIcon>]} />
                        <ShortcutRow label="Jump to Today" keys={["T"]} />
                    </Section>

                    <Section title="Views">
                        <ShortcutRow label="Switch List/Timeline" keys={["L"]} />
                        <ShortcutRow label="Prev day" keys={["["]} />
                        <ShortcutRow label="Next day" keys={["]"]} />
                    </Section>

                    <Section title="Coming Soon...">
                        <div className="h-full min-h-[100px] rounded-2xl border-2 border-dashed border-slate-100 flex items-center justify-center p-4">
                            <span className="text-xs text-slate-300 font-bold uppercase tracking-widest text-center">More shortcuts soon</span>
                        </div>
                    </Section>
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
