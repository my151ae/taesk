import { supabase, sanitizeCardForUpload, isAssigneeColumnMissing } from './supabase';
import type { List, Card, CardUpsertPayload } from './supabase';

let supportsAssigneeIdForQueue: boolean | null = null;

const prepareCardPayload = (
  data: Partial<Card> & { id: string },
  includeAssigneeId: boolean
): CardUpsertPayload | Partial<CardUpsertPayload> => {
  const maybeCard = data as Card;
  const hasFullShape =
    typeof maybeCard.title === 'string' &&
    typeof maybeCard.board_id === 'string' &&
    typeof maybeCard.list_id === 'string';

  if (hasFullShape) {
    return sanitizeCardForUpload(maybeCard, includeAssigneeId);
  }

  const payload: Partial<CardUpsertPayload> = { ...data };

  if (!includeAssigneeId) {
    delete payload.assignee_id;
  } else if ('assignee_id' in payload) {
    payload.assignee_id = (payload.assignee_id as string | null | undefined) ?? null;
  }

  if ('assigned_to' in payload) {
    payload.assigned_to = (payload.assigned_to as string | null | undefined) ?? null;
  }

  return payload;
};

const performCardMutation = async (
  data: Partial<Card> & { id: string },
  type: 'INSERT' | 'UPDATE'
): Promise<void> => {
  const includeAssigneeId = supportsAssigneeIdForQueue !== false;

  const attempt = async (include: boolean) => {
    const payload = prepareCardPayload(data, include);
    if (type === 'INSERT') {
      const { error } = await supabase.from('cards').insert(payload as CardUpsertPayload);
      return error ?? null;
    }

    const { error } = await supabase
      .from('cards')
      .update(payload)
      .eq('id', data.id);
    return error ?? null;
  };

  let error = await attempt(includeAssigneeId);

  if (isAssigneeColumnMissing(error ?? undefined)) {
    supportsAssigneeIdForQueue = false;
    console.warn('[syncQueue] assignee_id column missing on Supabase; retrying without that column');
    error = await attempt(false);
  } else if (!error) {
    supportsAssigneeIdForQueue = true;
  }

  if (error) {
    throw error;
  }
};

// Sync action types
export type SyncActionType = 'INSERT' | 'UPDATE' | 'DELETE';
export type SyncTableType = 'lists' | 'cards';
export type SyncActionStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SyncAction {
  id: string;
  type: SyncActionType;
  table: SyncTableType;
  data: Partial<List | Card> & { id: string };
  timestamp: number;
  retryCount: number;
  status: SyncActionStatus;
}

export interface SyncQueue {
  actions: SyncAction[];
  lastSyncedAt: number | null;
}

const SYNC_QUEUE_KEY = 'taesk-sync-queue';

// Load sync queue from localStorage
export const loadSyncQueue = (): SyncQueue => {
  if (typeof window === 'undefined') {
    return { actions: [], lastSyncedAt: null };
  }

  try {
    const data = localStorage.getItem(SYNC_QUEUE_KEY);
    return data ? JSON.parse(data) : { actions: [], lastSyncedAt: null };
  } catch (error) {
    console.error('Failed to load sync queue:', error);
    return { actions: [], lastSyncedAt: null };
  }
};

// Save sync queue to localStorage
export const saveSyncQueue = (queue: SyncQueue): void => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Failed to save sync queue:', error);
  }
};

// Add action to sync queue
export const addToSyncQueue = (
  action: Omit<SyncAction, 'id' | 'timestamp' | 'retryCount' | 'status'>
): void => {
  const queue = loadSyncQueue();
  const newAction: SyncAction = {
    ...action,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retryCount: 0,
    status: 'pending',
  };

  queue.actions.push(newAction);
  saveSyncQueue(queue);

  console.log('Added to sync queue:', newAction);
};

// Execute a single sync action
const executeSyncAction = async (action: SyncAction): Promise<void> => {
  const { type, table, data } = action;

  try {
    switch (type) {
      case 'INSERT':
        if (table === 'lists') {
          const { error } = await supabase.from('lists').insert(data as List);
          if (error) throw error;
        } else {
          await performCardMutation(data as Partial<Card> & { id: string }, 'INSERT');
        }
        break;

      case 'UPDATE':
        if (table === 'lists') {
          const { error } = await supabase
            .from('lists')
            .update(data as Partial<List>)
            .eq('id', data.id);
          if (error) throw error;
        } else {
          await performCardMutation(data as Partial<Card> & { id: string }, 'UPDATE');
        }
        break;

      case 'DELETE':
        if (table === 'lists') {
          const { error } = await supabase.from('lists').delete().eq('id', data.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('cards').delete().eq('id', data.id);
          if (error) throw error;
        }
        break;
    }
  } catch (error) {
    console.error('Failed to execute sync action:', action, error);
    throw error;
  }
};

// Process sync queue
export const syncQueue = async (): Promise<{
  success: number;
  failed: number;
  total: number;
}> => {
  const queue = loadSyncQueue();
  const pendingActions = queue.actions.filter(a => a.status === 'pending' || a.status === 'failed');

  if (pendingActions.length === 0) {
    return { success: 0, failed: 0, total: 0 };
  }

  console.log(`同期開始: ${pendingActions.length}件`);

  let successCount = 0;
  let failedCount = 0;

  for (const action of pendingActions) {
    try {
      // Update status to syncing
      action.status = 'syncing';
      saveSyncQueue(queue);

      // Execute sync action
      await executeSyncAction(action);

      // Mark as synced
      action.status = 'synced';
      successCount++;
      saveSyncQueue(queue);

      console.log('同期成功:', action);
    } catch (error) {
      console.error('同期失敗:', action, error);
      action.status = 'failed';
      action.retryCount++;
      failedCount++;
      saveSyncQueue(queue);

      // Give up after 3 retries
      if (action.retryCount >= 3) {
        console.error('同期を諦めました (3回失敗):', action);
      }
    }
  }

  // Remove synced actions from queue
  queue.actions = queue.actions.filter(a => a.status !== 'synced');
  queue.lastSyncedAt = Date.now();
  saveSyncQueue(queue);

  console.log(`同期完了: 成功 ${successCount}件, 失敗 ${failedCount}件`);

  return {
    success: successCount,
    failed: failedCount,
    total: pendingActions.length,
  };
};

// Get sync queue stats
export const getSyncQueueStats = (): {
  pending: number;
  failed: number;
  total: number;
  lastSyncedAt: number | null;
} => {
  const queue = loadSyncQueue();

  return {
    pending: queue.actions.filter(a => a.status === 'pending').length,
    failed: queue.actions.filter(a => a.status === 'failed').length,
    total: queue.actions.length,
    lastSyncedAt: queue.lastSyncedAt,
  };
};

// Clear synced actions from queue
export const clearSyncedActions = (): void => {
  const queue = loadSyncQueue();
  queue.actions = queue.actions.filter(a => a.status !== 'synced');
  saveSyncQueue(queue);
};

// Clear entire sync queue (use with caution)
export const clearSyncQueue = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SYNC_QUEUE_KEY);
  console.log('Sync queue cleared');
};
