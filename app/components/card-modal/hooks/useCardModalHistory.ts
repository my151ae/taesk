"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { JSONContent } from "@tiptap/react";

import type { CardContentHistoryMeta } from "@/lib/supabase";
import { normalizeContent } from "@/lib/tiptap";

type UseCardModalHistoryProps = {
  boardId: string;
  cardId: string;
  showSidebar: boolean;
  activeSidebarTab: "comments" | "history";
};

export function useCardModalHistory({
  boardId,
  cardId,
  showSidebar,
  activeSidebarTab,
}: UseCardModalHistoryProps) {
  const [historyItems, setHistoryItems] = useState<CardContentHistoryMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [previewHistoryContent, setPreviewHistoryContent] = useState<JSONContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const isHistoryPreviewing = useMemo(
    () => previewHistoryContent !== null,
    [previewHistoryContent]
  );

  const resetHistoryState = useCallback(() => {
    setHistoryItems([]);
    setHistoryLoading(false);
    setHistoryError(null);
    setSelectedHistoryId(null);
    setPreviewHistoryContent(null);
    setPreviewLoading(false);
    setPreviewError(null);
  }, []);

  const fetchHistoryList = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/history?limit=50`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || "履歴の取得に失敗しました");
      }
      setHistoryItems(Array.isArray(body?.history) ? body.history : []);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "履歴の取得に失敗しました");
    } finally {
      setHistoryLoading(false);
    }
  }, [boardId, cardId]);

  const selectHistory = useCallback(
    async (historyId: string) => {
      setSelectedHistoryId(historyId);
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/history/${historyId}`);
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error?.message || "履歴の取得に失敗しました");
        }
        const historyContent = normalizeContent(body?.history?.content);
        setPreviewHistoryContent(historyContent);
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : "履歴の取得に失敗しました");
        setPreviewHistoryContent(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [boardId, cardId]
  );

  const cancelHistoryPreview = useCallback(() => {
    setSelectedHistoryId(null);
    setPreviewHistoryContent(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }, []);

  useEffect(() => {
    resetHistoryState();
  }, [boardId, cardId, resetHistoryState]);

  useEffect(() => {
    if (!showSidebar || activeSidebarTab !== "history") return;
    void fetchHistoryList();
  }, [activeSidebarTab, fetchHistoryList, showSidebar]);

  return {
    historyItems,
    historyLoading,
    historyError,
    selectedHistoryId,
    previewHistoryContent,
    previewLoading,
    previewError,
    isHistoryPreviewing,
    resetHistoryState,
    fetchHistoryList,
    selectHistory,
    cancelHistoryPreview,
  };
}
