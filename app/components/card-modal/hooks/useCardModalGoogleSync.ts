"use client";

import { useCallback, useEffect, useState } from "react";

import type { Card } from "@/lib/supabase";
import { fetchResyncCandidates, type ResyncCandidate } from "@/app/(board)/_utils/resync";

type SyncStatus = "active" | "unlinked" | "deleted" | undefined;

type UseCardModalGoogleSyncProps = {
  card: Card;
  title: string;
  dueDate: string;
  dueStart: string;
  dueEnd: string;
  googleConnected: boolean;
  googleCanWrite: boolean;
};

export function useCardModalGoogleSync({
  card,
  title,
  dueDate,
  dueStart,
  dueEnd,
  googleConnected,
  googleCanWrite,
}: UseCardModalGoogleSyncProps) {
  const syncData = (card as Card & {
    calendar_sync?:
      | { status?: SyncStatus; last_google_event_id?: string | null }
      | Array<{ status?: SyncStatus; last_google_event_id?: string | null }>;
  }).calendar_sync;
  const syncStatusFromCard = Array.isArray(syncData) ? syncData[0]?.status : syncData?.status;
  const lastGoogleEventIdFromCard = Array.isArray(syncData)
    ? syncData[0]?.last_google_event_id
    : syncData?.last_google_event_id;

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncStatusFromCard);
  const [lastGoogleEventId, setLastGoogleEventId] = useState<string | undefined | null>(
    lastGoogleEventIdFromCard
  );
  const [resyncCandidates, setResyncCandidates] = useState<ResyncCandidate[]>([]);
  const [resyncLoading, setResyncLoading] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [resyncFetched, setResyncFetched] = useState(false);
  const [syncNowLoading, setSyncNowLoading] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    setSyncStatus(syncStatusFromCard);
    setLastGoogleEventId(lastGoogleEventIdFromCard);
  }, [card.id, lastGoogleEventIdFromCard, syncStatusFromCard]);

  const handleResyncRequest = useCallback(async () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setResyncLoading(true);
    setResyncError(null);
    setResyncFetched(false);
    try {
      const candidates = await fetchResyncCandidates({
        title: nextTitle,
        start: dueDate ?? undefined,
        end: dueDate ?? undefined,
      });
      setResyncCandidates(candidates);
      setResyncFetched(true);
    } catch (error) {
      console.error("resync candidates error", error);
      setResyncError(error instanceof Error ? error.message : "候補の取得に失敗しました");
      setResyncCandidates([]);
      setResyncFetched(true);
    } finally {
      setResyncLoading(false);
    }
  }, [title, dueDate]);

  const handleResyncSelect = useCallback(
    async (googleEventId?: string) => {
      setResyncLoading(true);
      setResyncError(null);
      setSyncToast("Google同期中...");
      try {
        const url = googleEventId
          ? `/api/calendar-sync/${card.id}?google_event_id=${encodeURIComponent(googleEventId)}`
          : `/api/calendar-sync/${card.id}`;
        const res = await fetch(url, { method: "POST" });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(body?.error?.message || "再シンクに失敗しました");
        }
        setSyncStatus("active");
        setLastGoogleEventId((prev) => googleEventId ?? prev ?? lastGoogleEventIdFromCard ?? null);
        setSyncToast("Google同期が完了しました");
      } catch (error) {
        const message = error instanceof Error ? error.message : "再シンクに失敗しました";
        setResyncError(message);
        setSyncToast(message);
      } finally {
        setResyncLoading(false);
        window.setTimeout(() => setSyncToast(null), 3000);
      }
    },
    [card.id, lastGoogleEventIdFromCard]
  );

  const handleSyncNow = useCallback(async () => {
    if (!dueDate || !dueStart || !dueEnd) {
      setSyncToast("開始・終了時刻を設定してください");
      window.setTimeout(() => setSyncToast(null), 2500);
      return;
    }
    if (!googleConnected || !googleCanWrite || syncStatus !== "active") {
      setSyncToast("Googleとシンクを有効にしてください");
      window.setTimeout(() => setSyncToast(null), 2500);
      return;
    }
    setSyncNowLoading(true);
    setSyncToast("Google同期中...");
    try {
      const res = await fetch(`/api/calendar-sync/${card.id}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message || "同期に失敗しました");
      }
      setSyncToast("Google同期が完了しました");
    } catch (error) {
      setSyncToast(error instanceof Error ? error.message : "同期に失敗しました");
    } finally {
      setSyncNowLoading(false);
      window.setTimeout(() => setSyncToast(null), 3000);
    }
  }, [card.id, dueDate, dueEnd, dueStart, googleCanWrite, googleConnected, syncStatus]);

  return {
    syncStatus,
    setSyncStatus,
    lastGoogleEventId,
    resyncCandidates,
    resyncLoading,
    resyncError,
    resyncFetched,
    syncNowLoading,
    syncToast,
    handleResyncRequest,
    handleResyncSelect,
    handleSyncNow,
  };
}
