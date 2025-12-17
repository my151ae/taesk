import { useState, useEffect, useCallback } from 'react';
import { syncQueue, getSyncQueueStats } from '@/lib/syncQueue';
import { useAuth } from '@/app/contexts/AuthContext';

export function useSyncQueue() {
    const { user } = useAuth();
    const [isOnline, setIsOnline] = useState(true);
    const [syncQueueStats, setSyncQueueStats] = useState({ pending: 0, failed: 0, total: 0, lastSyncedAt: null as number | null });

    const refreshStats = useCallback(() => {
        const next = getSyncQueueStats();
        setSyncQueueStats((prev) => {
            if (
                prev.pending === next.pending &&
                prev.failed === next.failed &&
                prev.total === next.total &&
                prev.lastSyncedAt === next.lastSyncedAt
            ) {
                return prev;
            }
            return next;
        });
    }, []);

    // Online/Offline detection with auto-sync
    useEffect(() => {
        const handleOnline = async () => {
            console.log('オンライン復帰 - 同期開始');
            setIsOnline(true);

            // Sync pending queue when coming back online
            const result = await syncQueue();
            if (result.total > 0) {
                console.log(`同期完了: ${result.success}件成功, ${result.failed}件失敗`);
            }
            // Update stats after sync
            refreshStats();
        };

        const handleOffline = () => {
            console.log('オフライン検出');
            setIsOnline(false);
        };

        // Set initial online state
        if (typeof window !== 'undefined') {
            setIsOnline(navigator.onLine);
        }

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [refreshStats]);

    // Sync queue on app load if online
    useEffect(() => {
        const syncOnLoad = async () => {
            if (typeof window !== 'undefined' && navigator.onLine && user) {
                console.log('アプリ起動時 - 同期キューをチェック');
                const result = await syncQueue();
                if (result.total > 0) {
                    console.log(`起動時同期完了: ${result.success}件成功, ${result.failed}件失敗`);
                }
                // Update stats after sync
                refreshStats();
            }
        };

        syncOnLoad();
    }, [refreshStats, user]);

    // Update sync queue stats periodically
    useEffect(() => {
        const updateStats = () => {
            refreshStats();
        };

        // Update immediately
        updateStats();

        // Update every 2 seconds
        const interval = setInterval(updateStats, 2000);

        return () => clearInterval(interval);
    }, [refreshStats]);

    return { isOnline, syncQueueStats };
}
