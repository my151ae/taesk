'use client';

import { useEffect, useRef, useState } from "react";
import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";
import styles from "./TiptapEditor.module.css";

export type BlockNodeType = "paragraph" | "heading" | "listItem" | "taskItem" | "details";
export type BlockActionType =
  | "insert-above"
  | "insert-below"
  | "duplicate"
  | "delete"
  | "toggle-details"
  | "unset-details";

export type BlockActionItem = {
  action: BlockActionType;
  label: string;
  destructive?: boolean;
};

export function getBlockActionItems(targetType: BlockNodeType): BlockActionItem[] {
  if (targetType === "details") {
    return [{ action: "unset-details", label: "トグル解除" }];
  }

  return [
    { action: "insert-above", label: "上に段落を追加" },
    { action: "insert-below", label: "下に段落を追加" },
    { action: "toggle-details", label: "トグルに変換" },
    { action: "duplicate", label: "複製" },
    { action: "delete", label: "削除", destructive: true },
  ];
}

export function BlockActionMenu({
  top,
  left,
  items,
  onClose,
  onSelect,
}: {
  top: number;
  left: number;
  items: BlockActionItem[];
  onClose: () => void;
  onSelect: (action: BlockActionType) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useClickOutside(menuRef, () => onClose());

  useEffect(() => {
    setActiveIndex(0);
    requestAnimationFrame(() => {
      itemRefs.current[0]?.focus();
    });
  }, [items]);

  return (
    <div
      ref={menuRef}
      className={styles.blockActionMenu}
      style={{ top, left }}
      role="menu"
      data-testid="tiptap-block-menu"
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (!items.length) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = (activeIndex + direction + items.length) % items.length;
          setActiveIndex(nextIndex);
          itemRefs.current[nextIndex]?.focus();
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex(0);
          itemRefs.current[0]?.focus();
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          const lastIndex = items.length - 1;
          setActiveIndex(lastIndex);
          itemRefs.current[lastIndex]?.focus();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          const activeItem = items[activeIndex];
          if (activeItem) {
            onSelect(activeItem.action);
          }
        }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          autoFocus={index === 0}
          tabIndex={index === activeIndex ? 0 : -1}
          data-testid={`tiptap-block-menu-${item.action}`}
          className={`${styles.blockActionMenuItem} ${
            item.destructive ? styles.blockActionMenuItemDanger : ""
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(item.action);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onSelect(item.action);
          }}
          onFocus={() => {
            if (activeIndex !== index) {
              setActiveIndex(index);
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
