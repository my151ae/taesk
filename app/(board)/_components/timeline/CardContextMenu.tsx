"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

interface ContextMenuItem {
    label: string;
    onClick: () => void;
    variant?: "default" | "danger";
}

interface CardContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export function CardContextMenu({ x, y, items, onClose }: CardContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    // Viewport clamping
    const menuWidth = 160;
    const menuHeight = items.length * 36 + 16;
    const clampedX = typeof window !== "undefined" ? Math.min(x, window.innerWidth - menuWidth - 8) : x;
    const clampedY = typeof window !== "undefined" ? Math.min(y, window.innerHeight - menuHeight - 8) : y;

    return createPortal(
        <AnimatePresence>
            <motion.div
                ref={menuRef}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                style={{
                    position: "fixed",
                    top: clampedY,
                    left: clampedX,
                    zIndex: 9999,
                }}
                className="min-w-[160px] overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
                onContextMenu={(e) => e.preventDefault()}
            >
                <div className="flex flex-col gap-0.5">
                    {items.map((item, idx) => (
                        <button
                            key={idx}
                            className={`flex w-full items-center px-3 py-1.5 text-left text-[13px] font-medium transition-colors rounded-md
                ${item.variant === "danger"
                                    ? "text-rose-600 hover:bg-rose-50"
                                    : "text-slate-700 hover:bg-slate-100"
                                }`}
                            onClick={(e) => {
                                e.stopPropagation();
                                item.onClick();
                                onClose();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </motion.div>
        </AnimatePresence>,
        document.body
    );
}
