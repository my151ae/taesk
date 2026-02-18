"use client";

import { useCallback } from "react";

export function useSpatialArrowFocus() {
  return useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const target = event.target as HTMLElement;
    const tagName = target.tagName;

    // コンテキストメニュー等、独自の矢印操作を持つUIでは介入しない
    if (target.closest('[data-arrow-skip="true"]')) return;

    // テキスト入力フィールドでのみ矢印キーの標準動作を許可
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable) {
      return;
    }

    const container = event.currentTarget;
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return;

    // フォーカス可能な要素を取得
    const tabStops = Array.from(
      container.querySelectorAll(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]):not([disabled])'
      )
    ).filter((el): el is HTMLElement => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        el.getBoundingClientRect().width > 0
      );
    });

    if (!tabStops.length) return;

    // 現在の要素の矩形情報を取得
    const activeRect = active.getBoundingClientRect();
    const activeCenter = {
      x: activeRect.left + activeRect.width / 2,
      y: activeRect.top + activeRect.height / 2,
    };

    let bestCandidate: HTMLElement | null = null;
    let minScore = Infinity;

    for (const candidate of tabStops) {
      if (candidate === active) continue;

      const rect = candidate.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };

      const dx = center.x - activeCenter.x;
      const dy = center.y - activeCenter.y;

      // キーの方向と一致するか確認
      let isCorrectDirection = false;
      let primaryDist = 0;
      let secondaryDist = 0;

      switch (event.key) {
        case "ArrowRight":
          isCorrectDirection = dx > 0 && Math.abs(dx) > Math.abs(dy) * 0.5;
          primaryDist = dx;
          secondaryDist = dy;
          break;
        case "ArrowLeft":
          isCorrectDirection = dx < 0 && Math.abs(dx) > Math.abs(dy) * 0.5;
          primaryDist = -dx;
          secondaryDist = dy;
          break;
        case "ArrowDown":
          isCorrectDirection = dy > 0 && Math.abs(dy) > Math.abs(dx) * 0.5;
          primaryDist = dy;
          secondaryDist = dx;
          break;
        case "ArrowUp":
          isCorrectDirection = dy < 0 && Math.abs(dy) > Math.abs(dx) * 0.5;
          primaryDist = -dy;
          secondaryDist = dx;
          break;
      }

      if (isCorrectDirection) {
        // スコア計算: 直進方向の距離 + 垂直方向のズレ（重み付け）
        const score = primaryDist + Math.abs(secondaryDist) * 2.5;
        if (score < minScore) {
          minScore = score;
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate) {
      event.preventDefault();
      event.stopPropagation();
      bestCandidate.focus();
      bestCandidate.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);
}
