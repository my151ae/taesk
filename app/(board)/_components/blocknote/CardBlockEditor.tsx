"use client";

import { useCallback, useEffect, useRef } from "react";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import "@blocknote/react/style.css";

import {
  BlockNoteDocument,
  ensureTitleBlock,
  getBlockPlainText,
  normalizeBlockNoteDocument,
} from "@/lib/blocknote";

type CardBlockEditorProps = {
  initialContent: BlockNoteDocument;
  onChange: (next: BlockNoteDocument) => void;
};

export function CardBlockEditor({ initialContent, onChange }: CardBlockEditorProps) {
  const lastCursorBlockRef = useRef<{ id: string; type: string } | null>(null);
  const lastSerializedRef = useRef<string | null>(null);
  const lastDocumentRef = useRef<BlockNoteDocument>([]);
  const restoringChecklistRef = useRef(false);
  const suppressOnChangeRef = useRef(true);

  const normalizedInitial = ensureTitleBlock(normalizeBlockNoteDocument(initialContent));
  const initialSerialized = JSON.stringify(normalizedInitial);
  if (lastSerializedRef.current === null) {
    lastSerializedRef.current = initialSerialized;
  }
  if (lastDocumentRef.current.length === 0) {
    lastDocumentRef.current = normalizedInitial;
  }

  const findBlockById = useCallback((blocks: BlockNoteDocument, id: string): BlockNoteDocument[number] | null => {
    for (const block of blocks) {
      if (block && typeof block === "object" && "id" in block && block.id === id) {
        return block;
      }
      if (block && typeof block === "object" && "children" in block) {
        const children = Array.isArray(block.children) ? (block.children as BlockNoteDocument) : [];
        const found = findBlockById(children, id);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const stripChecklistShortcut = useCallback((text: string) => {
    return text.replace(/^\s*(?:[-*]\s+)?\[\s*[xX ]\]\s*/, "").trimStart();
  }, []);

  const editor = useCreateBlockNote({
    initialContent: normalizedInitial,
    _tiptapOptions: {
      editorProps: {
        handleKeyDown: (view, event) => {
          if (
            event.isComposing ||
            !["ArrowUp", "ArrowDown", "ArrowLeft"].includes(event.key)
          ) {
            return false;
          }
          const { selection } = view.state;
          if (!selection.empty) return false;
          const cursor = editor.getTextCursorPosition();
          if (cursor.block.type !== "checkListItem") return false;

          const atStart =
            selection.$from.pos <= selection.$from.start() + 1 ||
            selection.$from.parentOffset <= 1 ||
            view.endOfTextblock("up");
          const atEnd =
            selection.$from.pos >= selection.$from.end() - 1 ||
            selection.$from.parentOffset >= selection.$from.parent.content.size - 1 ||
            view.endOfTextblock("down");

          if (event.key === "ArrowUp" && atStart) {
            const prev =
              editor.getPrevBlock(cursor.block) ??
              cursor.parentBlock;
            if (!prev) return false;
            editor.setTextCursorPosition(prev, "end");
            return true;
          }

          if (event.key === "ArrowDown" && atEnd) {
            if (cursor.block.children && cursor.block.children.length > 0) {
              editor.setTextCursorPosition(cursor.block.children[0], "start");
              return true;
            }
            const next =
              editor.getNextBlock(cursor.block) ??
              (cursor.parentBlock ? editor.getNextBlock(cursor.parentBlock) : undefined);
            if (!next) return false;
            editor.setTextCursorPosition(next, "start");
            return true;
          }

          if (event.key === "ArrowLeft" && selection.$from.parentOffset === 0) {
            const prev =
              editor.getPrevBlock(cursor.block) ??
              cursor.parentBlock;
            if (!prev) return false;
            editor.setTextCursorPosition(prev, "end");
            return true;
          }

          return false;
        },
      },
    },
  });

  const handleChange = useCallback(() => {
    const next = ensureTitleBlock(editor.document as BlockNoteDocument);
    const serialized = JSON.stringify(next);
    if (serialized === lastSerializedRef.current) return;
    const previous = lastDocumentRef.current;

    if (!suppressOnChangeRef.current && !restoringChecklistRef.current) {
      const lastCursor = lastCursorBlockRef.current;
      if (lastCursor?.id) {
        const currentBlock = findBlockById(next, lastCursor.id);
        const prevBlock = findBlockById(previous, lastCursor.id);
        if (currentBlock?.type === "checkListItem") {
          const currentText = getBlockPlainText(currentBlock);
          const prevText = prevBlock ? getBlockPlainText(prevBlock) : "";
          const restored = prevText ? stripChecklistShortcut(prevText) : "";
          if (!currentText && restored) {
            restoringChecklistRef.current = true;
            editor.updateBlock(lastCursor.id, {
              content: [{ type: "text", text: restored, styles: {} }],
            });
            window.setTimeout(() => {
              restoringChecklistRef.current = false;
            }, 0);
            return;
          }
        }
      }
    }

    lastSerializedRef.current = serialized;
    lastDocumentRef.current = next;
    if (suppressOnChangeRef.current) return;
    onChange(next);
    const lastCursor = lastCursorBlockRef.current;
    if (!lastCursor) return;
    const updatedBlock = editor.getBlock(lastCursor.id);
    if (!updatedBlock) return;
    if (lastCursor.type !== "checkListItem" && updatedBlock.type === "checkListItem") {
      const current = editor.getTextCursorPosition();
      if (current.block.id !== updatedBlock.id) {
        editor.setTextCursorPosition(updatedBlock, "end");
      }
    }
  }, [editor, findBlockById, onChange, stripChecklistShortcut]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      suppressOnChangeRef.current = false;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return editor.onBeforeChange(() => {
      const cursor = editor.getTextCursorPosition();
      lastCursorBlockRef.current = { id: cursor.block.id, type: cursor.block.type };
    });
  }, [editor]);

  useEffect(() => {
    const normalized = ensureTitleBlock(normalizeBlockNoteDocument(initialContent));
    const serialized = JSON.stringify(normalized);
    if (!lastSerializedRef.current) {
      lastSerializedRef.current = serialized;
    }
    if (serialized === lastSerializedRef.current) return;
    suppressOnChangeRef.current = true;
    editor.replaceBlocks(editor.document, normalized);
    lastSerializedRef.current = serialized;
    lastDocumentRef.current = normalized;
    window.setTimeout(() => {
      suppressOnChangeRef.current = false;
    }, 50); // 微調整：初期化時の非同期発火を確実にブロックするため、少しだけ余裕を持たせる
  }, [editor, initialContent]);

  // key handling is configured via _tiptapOptions to avoid double-handling

  return (
    <div className="card-block-editor bg-white">
      <BlockNoteViewRaw
        editor={editor}
        theme="light"
        onChange={handleChange}
        className="bn-card-editor"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        emojiPicker={false}
        sideMenu={false}
        filePanel={false}
        tableHandles={false}
        comments={false}
      />
      <style jsx global>{`
        .card-block-editor .bn-editor {
          padding-inline: 20px;
          min-height: 240px;
        }
      `}</style>
    </div>
  );
}
