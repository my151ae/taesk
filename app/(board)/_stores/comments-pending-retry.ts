import { createComment } from '@/lib/api/comments';
import type { CommentWithAuthor } from '@/lib/supabase';

import type { PendingComment } from '@/app/(board)/_stores/comments-pending-queue';

type RetrySuccessInput = {
  entry: PendingComment;
  comment: CommentWithAuthor;
};

type RetryFailureInput = {
  entry: PendingComment;
  errorMessage: string;
};

type RetryPendingQueueArgs = {
  queue: PendingComment[];
  onSuccess: (input: RetrySuccessInput) => void | Promise<void>;
  onFailure: (input: RetryFailureInput) => void | Promise<void>;
};

export async function retryPendingCommentsQueue({
  queue,
  onSuccess,
  onFailure,
}: RetryPendingQueueArgs): Promise<PendingComment[]> {
  if (queue.length === 0) return [];

  const remaining: PendingComment[] = [];

  for (const entry of queue) {
    const result = await createComment(entry.params);
    if (result?.comment) {
      await onSuccess({ entry, comment: result.comment });
      continue;
    }

    const message = result?.error?.message ?? '再送信に失敗しました';
    remaining.push(entry);
    await onFailure({ entry, errorMessage: message });
  }

  return remaining;
}
