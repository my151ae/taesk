"use client";

import { useCallback, useEffect, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/react/style.css";

import {
  BlockNoteDocument,
  ensureTitleBlock,
  normalizeBlockNoteDocument,
} from "@/lib/blocknote";

type CardBlockEditorProps = {
  initialContent: BlockNoteDocument;
  onChange: (next: BlockNoteDocument) => void;
};

export function CardBlockEditor({ initialContent, onChange }: CardBlockEditorProps) {
  const lastCursorBlockRef = useRef<{ id: string; type: string } | null>(null);
  const lastSerializedRef = useRef<string | null>(null);
  const suppressOnChangeRef = useRef(true);
  const editorRootRef = useRef<HTMLDivElement | null>(null);

  const normalizedInitial = ensureTitleBlock(normalizeBlockNoteDocument(initialContent));
  const initialSerialized = JSON.stringify(normalizedInitial);
  if (lastSerializedRef.current === null) {
    lastSerializedRef.current = initialSerialized;
  }

  const editor = useCreateBlockNote({
    initialContent: normalizedInitial,
    _tiptapOptions: {
      editorProps: {
        handleKeyDown: (view, event) => {
          if (event.isComposing || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
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

          return false;
        },
      },
    },
  });

  const handleChange = useCallback(() => {
    const next = ensureTitleBlock(editor.document as BlockNoteDocument);
    const serialized = JSON.stringify(next);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
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
  }, [editor, onChange]);

  useEffect(() => {
    return editor.onChange(() => handleChange());
  }, [editor, handleChange]);

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
    window.setTimeout(() => {
      suppressOnChangeRef.current = false;
    }, 0);
  }, [editor, initialContent]);

  useEffect(() => {
    const element = editorRootRef.current;
    if (!element) return;
    editor.mount(element);
    return () => {
      editor.unmount();
    };
  }, [editor]);

  // key handling is configured via _tiptapOptions to avoid double-handling

  return (
    <div className="card-block-editor bg-white">
      <div className="bn-container light" data-color-scheme="light">
        <div ref={editorRootRef} className="bn-editor min-h-[240px]" />
      </div>
      <style jsx global>{`
        .card-block-editor .bn-editor {
          padding-inline: 20px;
        }
      `}</style>
    </div>
  );
}
