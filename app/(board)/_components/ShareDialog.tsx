'use client';

import { featureFlags } from '@/lib/featureFlags';
import BoardAccessSettings from '@/app/(board)/_components/BoardAccessSettings';

interface ShareDialogProps {
  boardId: string;
  onClose: () => void;
  onMemberAdded?: () => void | Promise<void>;
  canManage?: boolean;
}

export default function ShareDialog({ boardId, onClose, onMemberAdded, canManage = false }: ShareDialogProps) {
  if (!featureFlags.boardPermissions) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-labelledby="share-dialog-title" className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 id="share-dialog-title" className="text-xl font-semibold">Board Access</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        <BoardAccessSettings boardId={boardId} canManage={canManage} onUpdated={onMemberAdded} />

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
