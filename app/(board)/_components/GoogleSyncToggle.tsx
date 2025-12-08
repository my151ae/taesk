"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GoogleSyncToggleProps {
    cardId: string;
    initialStatus?: "active" | "unlinked" | "deleted";
    connected: boolean;
    canWrite: boolean;
}

export function GoogleSyncToggle({ cardId, initialStatus, connected, canWrite }: GoogleSyncToggleProps) {
    const [status, setStatus] = useState<"active" | "unlinked" | "deleted" | undefined>(initialStatus);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const isSyncOn = status === "active";

    const statusLabel = (() => {
        if (!connected) return "未接続";
        if (status === "active") return "Google接続";
        if (status === "deleted") return "同期エラー";
        return "未接続";
    })();

    const handleToggle = async () => {
        setLoading(true);
        try {
            if (isSyncOn) {
                // Turn OFF
                const res = await fetch(`/api/calendar-sync/${cardId}?mode=unlinked`, { method: "DELETE" });
                if (!res.ok) throw new Error("Failed to unlink");
                setStatus("unlinked");
            } else {
                // Turn ON
                const res = await fetch(`/api/calendar-sync/${cardId}`, { method: "POST" });
                const body = await res.json().catch(() => null);
                if (!res.ok) {
                    const message = body?.error?.message || "Failed to sync";
                    throw new Error(message);
                }
                setStatus("active");
            }
            router.refresh();
        } catch (e) {
            console.error(e);
            const message = e instanceof Error ? e.message : "Failed to update sync status";
            alert(message);
        } finally {
            setLoading(false);
        }
    };

    if (!connected) {
        return (
            <div className="mt-4 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 dark:bg-gray-800/60 dark:border-gray-700 dark:text-gray-200">
                Google連携が無効です。タイムラインに同期するには再接続してください。
            </div>
        );
    }

    if (!canWrite) {
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
            <button
                onClick={handleToggle}
                disabled={loading}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${isSyncOn ? "bg-sky-500" : "bg-slate-200 dark:bg-gray-600"
                    } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isSyncOn ? "translate-x-6" : "translate-x-1"
                        }`}
                />
            </button>
        </div>
    );
}
