"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export interface ContextMenuItem {
    label: string;
    onClick: () => void;
    variant?: "default" | "danger";
    children?: ContextMenuItem[];
}

interface CardContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: (reason: "action" | "dismiss") => void;
}

export function CardContextMenu({ x, y, items, onClose }: CardContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const submenuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [activeSubmenuIndex, setActiveSubmenuIndex] = useState<number | null>(null);
    const [submenuFocusIndex, setSubmenuFocusIndex] = useState<number | null>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose("dismiss");
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose("dismiss");
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    useEffect(() => {
        if (!items.length) return;
        setActiveIndex(0);
        setActiveSubmenuIndex(null);
        setSubmenuFocusIndex(null);
        requestAnimationFrame(() => {
            itemRefs.current[0]?.focus();
        });
    }, [items.length]);

    // Viewport clamping
    const menuWidth = 160;
    const submenuWidth = 160;
    const menuHeight = items.length * 36 + 16;
    const clampedX = typeof window !== "undefined" ? Math.min(x, window.innerWidth - menuWidth - 8) : x;
    const clampedY = typeof window !== "undefined" ? Math.min(y, window.innerHeight - menuHeight - 8) : y;
    const submenuOpensLeft = typeof window !== "undefined" && clampedX + menuWidth + submenuWidth + 8 > window.innerWidth;
    const activeSubmenuItems = activeSubmenuIndex === null ? [] : items[activeSubmenuIndex]?.children ?? [];

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
                className="min-w-[160px] overflow-visible rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
                onContextMenu={(e) => e.preventDefault()}
                data-arrow-skip="true"
                role="menu"
                aria-label="カード操作メニュー"
                onKeyDown={(e) => {
                    if (!items.length) return;
                    if (submenuFocusIndex !== null && activeSubmenuItems.length) {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            const direction = e.key === "ArrowDown" ? 1 : -1;
                            const nextIndex = (submenuFocusIndex + direction + activeSubmenuItems.length) % activeSubmenuItems.length;
                            setSubmenuFocusIndex(nextIndex);
                            submenuItemRefs.current[nextIndex]?.focus();
                            return;
                        }
                        if (e.key === "ArrowLeft") {
                            e.preventDefault();
                            setSubmenuFocusIndex(null);
                            if (activeSubmenuIndex !== null) {
                                itemRefs.current[activeSubmenuIndex]?.focus();
                            }
                            return;
                        }
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            submenuItemRefs.current[submenuFocusIndex]?.click();
                            return;
                        }
                    }
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const direction = e.key === "ArrowDown" ? 1 : -1;
                        const nextIndex = (activeIndex + direction + items.length) % items.length;
                        setActiveIndex(nextIndex);
                        setActiveSubmenuIndex(items[nextIndex]?.children?.length ? nextIndex : null);
                        setSubmenuFocusIndex(null);
                        itemRefs.current[nextIndex]?.focus();
                    } else if (e.key === "ArrowRight") {
                        const activeItem = items[activeIndex];
                        if (activeItem?.children?.length) {
                            e.preventDefault();
                            setActiveSubmenuIndex(activeIndex);
                            setSubmenuFocusIndex(0);
                            requestAnimationFrame(() => submenuItemRefs.current[0]?.focus());
                        }
                    } else if (e.key === "Enter") {
                        e.preventDefault();
                        const activeItem = items[activeIndex];
                        if (activeItem) {
                            itemRefs.current[activeIndex]?.click();
                        }
                    } else if (e.key === " ") {
                        e.preventDefault();
                        const activeItem = items[activeIndex];
                        if (activeItem) {
                            itemRefs.current[activeIndex]?.click();
                        }
                    }
                }}
            >
                <div className="relative flex flex-col gap-0.5">
                    {items.map((item, idx) => (
                        <div
                            key={idx}
                            className="relative"
                            onMouseEnter={() => {
                                setActiveIndex(idx);
                                setActiveSubmenuIndex(item.children?.length ? idx : null);
                                setSubmenuFocusIndex(null);
                            }}
                        >
                            <button
                                ref={(node) => {
                                    itemRefs.current[idx] = node;
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-[13px] font-medium transition-colors
                ${item.variant === "danger"
                                        ? "text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
                                        : "text-slate-700 hover:bg-slate-100 focus:bg-slate-100"
                                    }`}
                                tabIndex={idx === activeIndex && submenuFocusIndex === null ? 0 : -1}
                                role="menuitem"
                                aria-haspopup={item.children?.length ? "menu" : undefined}
                                aria-expanded={item.children?.length ? activeSubmenuIndex === idx : undefined}
                                onFocus={() => {
                                    setActiveIndex(idx);
                                    setActiveSubmenuIndex(item.children?.length ? idx : null);
                                    setSubmenuFocusIndex(null);
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    item.onClick();
                                    onClose("action");
                                }}
                            >
                                <span>{item.label}</span>
                                {item.children?.length ? <span aria-hidden="true" className="text-slate-400">›</span> : null}
                            </button>
                            {item.children?.length && activeSubmenuIndex === idx ? (
                                <div
                                    className="absolute top-0 z-10 min-w-[160px] overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
                                    style={submenuOpensLeft ? { right: "calc(100% + 4px)" } : { left: "calc(100% + 4px)" }}
                                    role="menu"
                                    aria-label={`${item.label}の移動先`}
                                >
                                    <div className="flex flex-col gap-0.5">
                                        {item.children.map((child, childIdx) => (
                                            <button
                                                key={childIdx}
                                                ref={(node) => {
                                                    submenuItemRefs.current[childIdx] = node;
                                                }}
                                                className={`flex w-full items-center rounded-md px-3 py-1.5 text-left text-[13px] font-medium transition-colors
                ${child.variant === "danger"
                                                        ? "text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
                                                        : "text-slate-700 hover:bg-slate-100 focus:bg-slate-100"
                                                    }`}
                                                tabIndex={submenuFocusIndex === childIdx ? 0 : -1}
                                                role="menuitem"
                                                onFocus={() => setSubmenuFocusIndex(childIdx)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        const siblingItems = item.children ?? [];
                                                        if (!siblingItems.length) return;
                                                        const direction = e.key === "ArrowDown" ? 1 : -1;
                                                        const nextIndex = (childIdx + direction + siblingItems.length) % siblingItems.length;
                                                        setSubmenuFocusIndex(nextIndex);
                                                        submenuItemRefs.current[nextIndex]?.focus();
                                                        return;
                                                    }
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        child.onClick();
                                                        onClose("action");
                                                    }
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    child.onClick();
                                                    onClose("action");
                                                }}
                                            >
                                                {child.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            </motion.div>
        </AnimatePresence>,
        document.body
    );
}
