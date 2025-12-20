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
  const editor = useCreateBlockNote({
    initialContent: ensureTitleBlock(normalizeBlockNoteDocument(initialContent)),
  });
  const lastSerializedRef = useRef<string>("");
  const editorRootRef = useRef<HTMLDivElement | null>(null);

  const handleChange = useCallback(() => {
    const next = ensureTitleBlock(editor.document as BlockNoteDocument);
    lastSerializedRef.current = JSON.stringify(next);
    onChange(next);
  }, [editor, onChange]);

  useEffect(() => {
    return editor.onChange(() => handleChange());
  }, [editor, handleChange]);

  useEffect(() => {
    const normalized = ensureTitleBlock(normalizeBlockNoteDocument(initialContent));
    const serialized = JSON.stringify(normalized);
    if (serialized === lastSerializedRef.current) return;
    editor.replaceBlocks(editor.document, normalized);
    lastSerializedRef.current = serialized;
  }, [editor, initialContent]);

  useEffect(() => {
    const element = editorRootRef.current;
    if (!element) return;
    editor.mount(element);
    return () => {
      editor.unmount();
    };
  }, [editor]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="bn-container light" data-color-scheme="light">
        <div ref={editorRootRef} className="bn-editor min-h-[240px]" />
      </div>
    </div>
  );
}
