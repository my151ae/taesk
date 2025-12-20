"use client";

import { useCallback, useEffect, useRef } from "react";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
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
  const editor = useCreateBlockNote({
    initialContent: ensureTitleBlock(normalizeBlockNoteDocument(initialContent)),
  });
  const lastSerializedRef = useRef<string>("");

  const handleChange = useCallback(() => {
    const next = ensureTitleBlock(editor.document as BlockNoteDocument);
    lastSerializedRef.current = JSON.stringify(next);
    onChange(next);
  }, [editor, onChange]);

  useEffect(() => {
    const normalized = ensureTitleBlock(normalizeBlockNoteDocument(initialContent));
    const serialized = JSON.stringify(normalized);
    if (serialized === lastSerializedRef.current) return;
    editor.replaceBlocks(editor.document, normalized);
    lastSerializedRef.current = serialized;
  }, [editor, initialContent]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <BlockNoteViewRaw
        editor={editor}
        onChange={handleChange}
        className="min-h-[240px]"
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        emojiPicker={false}
        sideMenu={false}
        filePanel={false}
        tableHandles={false}
        comments={false}
      />
    </div>
  );
}
