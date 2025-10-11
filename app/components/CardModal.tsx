"use client";

import { useEffect, useRef, useState } from "react";
import type { Card, Board, Priority } from "@/lib/supabase";

interface CardModalProps {
  card: Card;
  boards: Board[];
  onSave: (id: string, title: string, description: string, tags?: string[], due_date?: string | null, priority?: Priority, assigned_to?: string | null) => void;
  onDelete: (id: string) => void;
  onMoveToBoard: (cardId: string, targetBoardId: string) => void;
  onClose: () => void;
}

export function CardModal({
  card,
  boards,
  onSave,
  onDelete,
  onMoveToBoard,
  onClose,
}: CardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [tags, setTags] = useState<string[]>(card.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [dueDate, setDueDate] = useState(card.due_date || '');
  const [priority, setPriority] = useState<Priority>(card.priority || 'medium');
  const [assignedTo, setAssignedTo] = useState(card.assigned_to || '');
  const [targetBoardId, setTargetBoardId] = useState(card.board_id);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape key to close + focus trap
  useEffect(() => {
    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

    const focusFirstElement = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const autoFocusTarget = dialog.querySelector<HTMLElement>('[data-autofocus]');
      if (autoFocusTarget) {
        autoFocusTarget.focus();
        return;
      }
      const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelector);
      (focusable[0] ?? dialog).focus();
    };

    const trapFocus = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute("disabled"),
      );

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const isShift = event.shiftKey;

      if (!current) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (!isShift && current === last) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (isShift && current === first) {
        event.preventDefault();
        last.focus();
        return;
      }
    };

    document.addEventListener("keydown", trapFocus);
    focusFirstElement();

    return () => {
      document.removeEventListener("keydown", trapFocus);
    };
  }, [onClose]);

  const handleSave = () => {
    onSave(card.id, title, description, tags, dueDate || null, priority, assignedTo || null);

    if (targetBoardId !== card.board_id) {
      onMoveToBoard(card.id, targetBoardId);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleDelete = () => {
    if (confirm('Delete this card?')) {
      onDelete(card.id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        data-testid="card-modal-overlay"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex justify-between items-start mb-6">
          <h2 id="modal-title" className="text-2xl font-bold text-slate-800 dark:text-gray-100">
            Edit Card
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none"
            aria-label="Close modal"
            data-autofocus
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              placeholder="Card title"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent resize-none"
              placeholder="Add a description..."
              rows={4}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Tags
            </label>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              placeholder="Press Enter to add tag"
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 rounded-md text-xs"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-200"
                      aria-label={`Remove tag ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Due Date */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate ? new Date(dueDate).toISOString().split('T')[0] : ''}
              onChange={(e) => setDueDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
            >
              <option value="low">🟢 Low</option>
              <option value="medium">🟡 Medium</option>
              <option value="high">🔴 High</option>
            </select>
          </div>

          {/* Move to Board */}
          {boards.length > 1 && (
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                Move to Board
              </label>
              <select
                value={targetBoardId}
                onChange={(e) => setTargetBoardId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              >
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name} {board.id === card.board_id ? '(current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Copy Links */}
          {card.short_id && (
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-gray-400 mb-1 block">
                Share Link
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const shortUrl = `${window.location.origin}/c/${card.short_id}`;
                    navigator.clipboard.writeText(shortUrl);
                  }}
                  className="flex-1 px-3 py-1.5 bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-200 rounded-lg text-xs hover:bg-slate-200 dark:hover:bg-gray-600 transition-colors"
                >
                  📋 Copy Short Link
                </button>
                {card.id_short && card.slug && (
                  <button
                    type="button"
                    onClick={() => {
                      const readableUrl = `${window.location.origin}/c/${card.short_id}/${card.id_short}-${card.slug}`;
                      navigator.clipboard.writeText(readableUrl);
                    }}
                    className="flex-1 px-3 py-1.5 bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-200 rounded-lg text-xs hover:bg-slate-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    📋 Copy Full Link
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex gap-2 mt-6 pt-4 border-t border-slate-200 dark:border-gray-700">
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-sky-500 text-white rounded-lg text-sm hover:bg-sky-600 transition-colors font-medium"
          >
            Save
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors font-medium"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-gray-600 text-slate-700 dark:text-gray-200 rounded-lg text-sm hover:bg-slate-300 dark:hover:bg-gray-500 transition-colors font-medium ml-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
