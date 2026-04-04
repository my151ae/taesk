"use client";

import clsx from "clsx";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";

type ToolbarMenuSelectOption<T extends string> = {
  value: T;
  label: string;
};

type ToolbarMenuSelectProps<T extends string> = {
  value: T;
  options: readonly ToolbarMenuSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  buttonTestId?: string;
  className?: string;
  menuClassName?: string;
};

export function ToolbarMenuSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  buttonTestId,
  className,
  menuClassName,
}: ToolbarMenuSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const suppressNextClickRef = useRef(false);
  const keyboardTogglePendingRef = useRef(false);
  const listboxId = useId();

  useClickOutside(rootRef, (event) => {
    const target = event.target as Node | null;
    if (target && menuRef.current?.contains(target)) {
      return;
    }
    setOpen(false);
  });

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0] ?? null,
    [options, value]
  );

  const closeMenu = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  const selectOption = useCallback((nextValue: T) => {
    // 変更処理側が押下元ボタンを識別できるよう、先にフォーカスを戻す
    buttonRef.current?.focus();
    onChange(nextValue);
    setOpen(false);
  }, [onChange]);

  const selectedIndex = useMemo(() => {
    const index = options.findIndex((option) => option.value === value);
    return index >= 0 ? index : 0;
  }, [options, value]);

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.bottom + 8,
        left: rect.left,
        minWidth: rect.width,
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const frame = window.requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedIndex]);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    setOpen((current) => !current);
  }, [disabled]);

  const handleButtonKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      keyboardTogglePendingRef.current = true;
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }, [disabled]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        data-testid={buttonTestId}
        data-focus-group="toolbar"
        data-focus-part="control"
        onClick={(event) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          handleToggle();
        }}
        onKeyDown={handleButtonKeyDown}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            if (!keyboardTogglePendingRef.current) return;
            keyboardTogglePendingRef.current = false;
            suppressNextClickRef.current = true;
            setOpen((current) => !current);
          }
        }}
        onBlur={() => {
          keyboardTogglePendingRef.current = false;
          suppressNextClickRef.current = false;
        }}
        className={clsx(
          "inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
      >
        <span>{selectedOption?.label ?? ""}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-3 w-3 text-slate-500"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 7.5 5 5 5-5" />
        </svg>
      </button>

      {open && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              tabIndex={-1}
              data-arrow-skip="true"
              className={clsx(
                "fixed z-[80] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-xl",
                menuClassName
              )}
              style={{
                top: menuPosition.top,
                left: menuPosition.left,
                minWidth: menuPosition.minWidth,
              }}
              onKeyDown={(event) => {
                if (!options.length) return;

                if (event.key === "Escape") {
                  event.preventDefault();
                  closeMenu();
                  return;
                }

                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  const nextIndex = (activeIndex + direction + options.length) % options.length;
                  setActiveIndex(nextIndex);
                  optionRefs.current[nextIndex]?.focus();
                  return;
                }

                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  const activeOption = options[activeIndex];
                  if (!activeOption) return;
                  selectOption(activeOption.value);
                }
              }}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-arrow-skip="true"
                    tabIndex={index === activeIndex ? 0 : -1}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => {
                      selectOption(option.value);
                    }}
                    className={clsx(
                      "flex w-full items-center rounded-xl px-3 py-2 text-left text-[11px] font-medium transition-colors",
                      isSelected
                        ? "bg-sky-50 text-sky-700"
                        : "text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
