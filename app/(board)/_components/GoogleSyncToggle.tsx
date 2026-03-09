"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface GoogleSyncToggleProps {
    cardId: string;
    initialStatus?: "active" | "unlinked" | "deleted";
    connected: boolean;
    canWrite: boolean;
    onResyncRequest?: () => void;
    hasResyncCandidate?: boolean;
    onStatusChange?: (status: "active" | "unlinked" | "deleted") => void;
    displayMode?: "panel" | "inline" | "menu";
}

export function GoogleSyncToggle({
    cardId,
    initialStatus,
    connected,
    canWrite,
    onResyncRequest,
    hasResyncCandidate,
    onStatusChange,
    displayMode = "panel",
}: GoogleSyncToggleProps) {
    const [status, setStatus] = useState<"active" | "unlinked" | "deleted" | undefined>(initialStatus);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setStatus(initialStatus);
        console.log("[GoogleSyncToggle] status prop changed", { cardId, initialStatus });
    }, [cardId, initialStatus]);

    const isSyncOn = status === "active";

    const statusLabel = (() => {
        if (!connected) return "未接続";
        if (status === "active") return "Google接続";
        if (status === "deleted") return "同期エラー";
        if (status === "unlinked" && hasResyncCandidate) return "再接続候補あり";
        return "未接続";
    })();

    const handleToggle = async () => {
        setLoading(true);
        try {
            console.log("[GoogleSyncToggle] toggle start", { cardId, isSyncOn, connected, canWrite, status });
            if (isSyncOn) {
                // Turn OFF
                const res = await fetch(`/api/calendar-sync/${cardId}?mode=unlinked`, { method: "DELETE" });
                if (!res.ok) throw new Error("Failed to unlink");
                setStatus("unlinked");
                onStatusChange?.("unlinked");
                console.log("[GoogleSyncToggle] unlink success", { cardId });
            } else {
                // Turn ON
                const res = await fetch(`/api/calendar-sync/${cardId}`, { method: "POST" });
                const body = await res.json().catch(() => null);
                if (!res.ok) {
                    const message = body?.error?.message || "Failed to sync";
                    throw new Error(message);
                }
                setStatus("active");
                onStatusChange?.("active");
                console.log("[GoogleSyncToggle] link success", { cardId, body });
            }
            router.refresh();
        } catch (e) {
            console.error(e);
            const message = e instanceof Error ? e.message : "Failed to update sync status";
            alert(message);
            console.warn("[GoogleSyncToggle] toggle failed", { cardId, error: e });
        } finally {
            setLoading(false);
        }
    };

    const renderToggle = (size: "small" | "default") => (
        <button
            onClick={handleToggle}
            disabled={loading}
            className={`relative inline-flex items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${size === "small"
                ? `h-4 w-8 focus:ring-offset-1 dark:focus:ring-offset-gray-800 ${isSyncOn ? "bg-sky-500" : "bg-slate-200 dark:bg-gray-600"}`
                : `h-6 w-11 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${isSyncOn ? "bg-sky-500" : "bg-slate-200 dark:bg-gray-600"}`
                } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        >
            <span
                className={`inline-block rounded-full bg-white transition-transform ${size === "small"
                    ? `h-3 w-3 ${isSyncOn ? "translate-x-4" : "translate-x-1"}`
                    : `h-4 w-4 ${isSyncOn ? "translate-x-6" : "translate-x-1"}`
                    }`}
            />
        </button>
    );

    if (!connected) {
        if (displayMode === "inline") {
            return (
                <a
                    href="/api/integrations/google-calendar/connect"
                    className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    data-testid="card-modal-google-sync-inline"
                >
                    Google 接続
                </a>
            );
        }
        if (displayMode === "menu") {
            return (
                <div className="space-y-2">
                    <p className="text-xs text-slate-600 dark:text-gray-200">
                        Google連携が無効です。タイムラインに同期するには再接続してください。
                    </p>
                    <a
                        href="/api/integrations/google-calendar/connect"
                        className="inline-flex rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                    >
                        Googleを接続
                    </a>
                </div>
            );
        }
        return (
            <div className="mt-4 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 dark:bg-gray-800/60 dark:border-gray-700 dark:text-gray-200">
                Google連携が無効です。タイムラインに同期するには再接続してください。
            </div>
        );
    }

    if (!canWrite) {
        if (displayMode === "inline") {
            return (
                <a
                    href="/api/integrations/google-calendar/connect"
                    className="inline-flex h-9 items-center rounded-full border border-orange-200 bg-orange-50 px-3 text-xs font-medium text-orange-700 shadow-sm transition-colors hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-200 dark:hover:bg-orange-900/30"
                    data-testid="card-modal-google-sync-inline"
                >
                    Write Access
                </a>
            );
        }
        if (displayMode === "menu") {
            return (
                <div className="space-y-2 rounded-lg bg-orange-50 p-3 dark:bg-orange-900/20">
                    <p className="text-xs text-orange-800 dark:text-orange-200">
                        Two-way sync requires write permissions.
                    </p>
                    <a
                        href="/api/integrations/google-calendar/connect"
                        className="text-xs font-semibold text-orange-600 hover:underline dark:text-orange-300"
                    >
                        Enable Write Access
                    </a>
                </div>
            );
        }
        return (
            <div className="mt-4 bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg border border-orange-200 dark:border-orange-800">
                <p className="text-xs text-orange-800 dark:text-orange-200 mb-2">
                    Two-way sync requires write permissions.
                </p>
                <a
                    href="/api/integrations/google-calendar/connect"
                    className="text-xs font-semibold text-orange-600 dark:text-orange-300 hover:underline"
                >
                    Enable Write Access
                </a>
            </div>
        );
    }

    if (displayMode === "inline") {
        return (
            <div className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 shadow-sm dark:border-gray-600 dark:bg-gray-800" data-testid="card-modal-google-sync-inline">
                <span className={`text-[10px] font-medium ${isSyncOn ? "text-emerald-600" : "text-slate-400"}`}>
                    {statusLabel}
                </span>
                {renderToggle("small")}
            </div>
        );
    }

    if (displayMode === "menu") {
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 dark:text-gray-200">
                            Google Calendar Sync
                        </p>
                        <span className={`text-xs ${isSyncOn ? "text-emerald-600" : "text-slate-400"}`}>
                            {statusLabel}
                        </span>
                    </div>
                    {renderToggle("default")}
                </div>
                {hasResyncCandidate && status === "unlinked" && onResyncRequest && (
                    <button
                        type="button"
                        onClick={onResyncRequest}
                        className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-300"
                    >
                        再接続候補を確認
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center justify-between py-2 mt-2 border-t border-slate-100 dark:border-gray-700">
            <div className="flex flex-col">
                <label className="text-sm font-medium text-slate-600 dark:text-gray-400">
                    Google Calendar Sync
                </label>
                <span className={`text-xs ${isSyncOn ? "text-emerald-600" : "text-slate-400"}`}>
                    {statusLabel}
                </span>
            </div>
            {renderToggle("default")}
        </div>
    );
}
