'use client';

import { useState } from 'react';
import { featureFlags } from '@/lib/featureFlags';

interface ShareDialogProps {
  boardId: string;
  onClose: () => void;
}

export default function ShareDialog({ boardId, onClose }: ShareDialogProps) {
  if (!featureFlags.boardPermissions) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Share Board</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Share this board with team members (Phase 3 - Coming Soon)
          </p>

          {/* Placeholder for member list */}
          <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
            <p className="text-sm text-gray-500">Member management UI will be implemented here</p>
          </div>

          {/* Placeholder for invite input */}
          <div className="border border-gray-200 dark:border-gray-700 rounded p-4">
            <p className="text-sm text-gray-500">Invite by email UI will be implemented here</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
