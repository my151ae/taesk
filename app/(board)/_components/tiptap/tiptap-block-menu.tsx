'use client';

import { useEffect, useRef, useState, type Ref } from "react";
import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";
import styles from "./TiptapEditor.module.css";

export type BlockNodeType = "paragraph" | "heading" | "listItem" | "taskItem" | "details";
export type BlockActionType =
  | "move-up"
  | "move-down"
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
  disabled?: boolean;
};

type BlockActionAvailability = {
  canMoveUp: boolean;
  canMoveDown: boolean;
};

function getInitialActiveIndex(items: BlockActionItem[]): number {
  const firstEnabledIndex = items.findIndex((item) => !item.disabled);
  return firstEnabledIndex >= 0 ? firstEnabledIndex : 0;
}

export function getBlockActionItems(
  targetType: BlockNodeType,
  { canMoveUp, canMoveDown }: BlockActionAvailability,
): BlockActionItem[] {
  if (targetType === "details") {
    return [
      { action: "move-up", label: "上へ移動", disabled: !canMoveUp },
      { action: "move-down", label: "下へ移動", disabled: !canMoveDown },
      { action: "unset-details", label: "トグル解除" },
    ];
  }

  return [
    { action: "move-up", label: "上へ移動", disabled: !canMoveUp },
    { action: "move-down", label: "下へ移動", disabled: !canMoveDown },
    { action: "insert-above", label: "上に段落を追加" },
    { action: "insert-below", label: "下に段落を追加" },
    { action: "toggle-details", label: "トグルに変換" },
    { action: "duplicate", label: "複製" },
    { action: "delete", label: "削除", destructive: true },
  ];
}

export function BlockActionMenu({
  anchorRect,
  containerRect,
  items,
  menuRootRef,
  onClose,
  onHoverChange,
  onSelect,
}: {
  anchorRect: DOMRect | null;
  containerRect: DOMRect | null;
  items: BlockActionItem[];
  menuRootRef?: Ref<HTMLDivElement>;
  onClose: () => void;
  onHoverChange?: (hovering: boolean) => void;
  onSelect: (action: BlockActionType) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(() => getInitialActiveIndex(items));
  const initialActiveIndex = getInitialActiveIndex(items);

  useClickOutside(menuRef, () => onClose());

  useEffect(() => {
    const nextActiveIndex = getInitialActiveIndex(items);
    setActiveIndex(nextActiveIndex);
    requestAnimationFrame(() => {
      itemRefs.current[nextActiveIndex]?.focus();
    });
  }, [items]);

  if (!anchorRect || !containerRect) {
    return null;
  }

  const top = Math.max(anchorRect.top - containerRect.top, 4);
  const left = Math.max(anchorRect.left - containerRect.left - 4, 44);

  return (
    <div
      ref={(node) => {
        menuRef.current = node;
        if (!menuRootRef) return;
        if (typeof menuRootRef === "function") {
          menuRootRef(node);
          return;
        }
        menuRootRef.current = node;
      }}
      className={styles.blockActionMenu}
      style={{ top, left }}
      role="menu"
      data-testid="tiptap-block-menu"
      onMouseEnter={() => {
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        onHoverChange?.(false);
      }}
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
          if (activeItem && !activeItem.disabled) {
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
          autoFocus={index === initialActiveIndex}
          tabIndex={index === activeIndex ? 0 : -1}
          data-testid={`tiptap-block-menu-${item.action}`}
          aria-disabled={item.disabled ? "true" : undefined}
          className={`${styles.blockActionMenuItem} ${
            item.destructive ? styles.blockActionMenuItemDanger : ""
          } ${item.disabled ? styles.blockActionMenuItemDisabled : ""}`}
          onClick={(event) => {
            if (item.disabled) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            event.stopPropagation();
            onSelect(item.action);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            if (item.disabled) return;
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
