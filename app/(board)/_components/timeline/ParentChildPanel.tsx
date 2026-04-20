"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Card } from "@/lib/supabase";

type ChildCardItem = {
  id: string;
  short_id: string | null;
  title: string;
  due_date: string | null;
  due_start: string | null;
  due_bucket: "a" | "b" | null;
  created_at: string;
};

type ParentChildPanelProps = {
  parentCard: Card;
  onClose: () => void;
  onOpenAsCardModal: () => void;
  onOpenCardModal: (shortId: string | null, source: string) => void;
};

const formatSchedule = (item: ChildCardItem) => {
  if (!item.due_date) return "日時未設定";
  const date = item.due_date.slice(0, 10);
  const time = item.due_start ? item.due_start.slice(0, 5) : "時刻未設定";
  const bucket = item.due_bucket ? item.due_bucket.toUpperCase() : "-";
  return `${date} / ${bucket} / ${time}`;
};

export default function ParentChildPanel({
  parentCard,
  onClose,
  onOpenAsCardModal,
  onOpenCardModal,
}: ParentChildPanelProps) {
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<ChildCardItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const boardId = parentCard.board_id;
  const parentId = parentCard.id;

  const loadChildren = useCallback(async () => {
    if (!boardId || !parentId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards/${parentId}/children`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "子カードの取得に失敗しました");
      }
      setChildren(Array.isArray(body?.children) ? body.children : []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "子カードの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [boardId, parentId]);

  useEffect(() => {
    void loadChildren();
  }, [loadChildren]);

  const canUnparent = useMemo(() => children.length === 0, [children.length]);

  const handleAddChild = useCallback(async () => {
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards/${parentId}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "子カードの追加に失敗しました");
      }
      await loadChildren();
      const shortId = body?.card?.short_id ?? null;
      if (shortId) onOpenCardModal(shortId, "parent-panel-add");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "子カードの追加に失敗しました");
    }
  }, [boardId, loadChildren, onOpenCardModal, parentId]);

  const handleUnlink = useCallback(
    async (childId: string) => {
      setMessage(null);
      setError(null);
      try {
        const response = await fetch(`/api/boards/${boardId}/cards/${childId}/unlink`, {
          method: "POST",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error?.message ?? "子リンク解除に失敗しました");
        }
        await loadChildren();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "子リンク解除に失敗しました");
      }
    },
    [boardId, loadChildren]
  );

  const handleUnparent = useCallback(async () => {
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards/${parentId}/unparent`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "親解除に失敗しました");
      }
      setMessage("親解除しました。通常カードとして編集できます。");
      onOpenAsCardModal();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "親解除に失敗しました");
    }
  }, [boardId, onOpenAsCardModal, parentId]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative z-10 h-full max-h-[100dvh] w-full max-w-4xl rounded-none bg-white shadow-2xl outline-none sm:h-[90vh] sm:max-h-[90vh] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="parent-child-panel-title"
      >
        <div className="flex h-full flex-col">
          <header className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="parent-child-panel-title" className="truncate text-lg font-semibold text-slate-900">
                  {parentCard.title || "Untitled card"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">親カード / 子カード管理</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenAsCardModal}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  通常編集
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  閉じる
                </button>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAddChild}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
              >
                子カードを追加
              </button>
              <button
                type="button"
                onClick={handleUnparent}
                disabled={!canUnparent}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                親解除
              </button>
              <span className="text-xs text-slate-500">子カード数: {children.length}</span>
            </div>

            {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}

            {loading ? <p className="text-sm text-slate-500">読み込み中...</p> : null}
            {!loading && !children.length ? (
              <p className="text-sm text-slate-500">子カードはまだありません。</p>
            ) : null}

            {!loading && children.length ? (
              <ul className="space-y-2">
                {children.map((child) => (
                  <li key={child.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onOpenCardModal(child.short_id, "parent-panel-child")}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-medium text-slate-900">{child.title || "Untitled card"}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatSchedule(child)}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUnlink(child.id)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        リンク解除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
