'use client';

import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import styles from './TiptapEditor.module.css';
import { useEffect, useRef } from 'react';

type TiptapEditorProps = {
    initialContent?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    placeholder?: string;
    editable?: boolean;
};

export default function TiptapEditor({
    initialContent,
    onChange,
    placeholder = "Type '/' for commands…",
    editable = true
}: TiptapEditorProps) {
    // Use a ref to track if we're silently updating content to avoid trigger loops
    const isUpdatingRef = useRef(false);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                // The History extension is enabled by default
                heading: {
                    levels: [1, 2, 3]
                }
            }),
            TaskList,
            TaskItem.configure({
                nested: true,
            }),
            Placeholder.configure({
                placeholder,
            }),
        ],
        content: initialContent || { type: 'doc', content: [] },
        editorProps: {
            attributes: {
                class: 'prose prose-slate max-w-none focus:outline-none min-h-[200px] px-2 py-2',
            },
        },
        onUpdate: ({ editor }) => {
            if (isUpdatingRef.current) return;
            if (onChange) {
                onChange(editor.getJSON());
            }
        },
    });

    // Handle external updates to initialContent
    // Note: Deep comparison might be expensive, so we trust React key="" or explicit reset
    // But CardModal updates content based on prop change (switching cards).
    useEffect(() => {
        if (!editor) return;

        // Check if content is actually different to avoid cursor jumps
        // Allow naive stringify check for now or just trust the parent to mount a new instance for a new card
        // Since CardModal uses `key={card.id}`, this component will unmount/remount on card switch.
        // So we only need to handle if the SAME card updates content from outside (Realtime).
        // For now, let's assuming remount-on-key-change strategy from CardModal is primary.
        // But we still sync when content is different (e.g. realtime updates).
        const nextContent = initialContent ?? { type: 'doc', content: [] };
        const current = editor.getJSON();
        if (JSON.stringify(current) !== JSON.stringify(nextContent)) {
            isUpdatingRef.current = true;
            editor.commands.setContent(nextContent, { emitUpdate: false });
            isUpdatingRef.current = false;
        }
    }, [initialContent, editor]);

    // Update editable state
    useEffect(() => {
        if (editor && editor.isEditable !== editable) {
            editor.setEditable(editable);
        }
    }, [editor, editable]);

    if (!editor) {
        return null;
    }

    return (
        <div className={`w-full bg-white dark:bg-gray-800 rounded-lg min-h-[200px] cursor-text ${styles.editor}`} onClick={() => editor.chain().focus().run()}>
            <EditorContent editor={editor} />
        </div>
    );
}
