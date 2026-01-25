'use client';

import { Extension, useEditor, EditorContent, JSONContent } from '@tiptap/react';
import { TextSelection, Plugin, PluginKey, EditorState, Transaction } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import styles from './TiptapEditor.module.css';
import { useEffect, useRef } from 'react';
import { ensureTitleTask } from '@/lib/tiptap';

/**
 * 先頭ブロックが空でないテキストを持つ場合、自動的に taskItem に変換する拡張
 */
const AutoTaskFirstLine = Extension.create({
    name: 'autoTaskFirstLine',

    addOptions() {
        return {
            enabled: true,
        };
    },

    addGlobalAttributes() {
        return [];
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('autoTaskFirstLine'),
                appendTransaction: (transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) => {
                    // 安全ガード: newState がない場合は何もしない
                    if (!newState || !newState.doc) return;

                    // 変更がない、またはメタフラグがある場合はスキップ
                    if (!transactions.some(tr => tr.docChanged) || transactions.some(tr => tr.getMeta('autoTaskFirstLine'))) {
                        return;
                    }

                    const { doc, schema } = newState;
                    const firstNode = doc.firstChild;

                    // 先頭が taskList 構造でない場合のみ変換対象
                    if (firstNode && firstNode.type.name !== 'taskList') {
                        const textContent = firstNode.textContent.trim();

                        // 合意A: 空なら何もしない
                        if (textContent !== "") {
                            // 厳密仕様B: 先頭ブロックの内容を抽出し、taskItem(paragraph) に変換
                            const tr = newState.tr;

                            const newTaskItem = schema.nodes.taskItem.create(
                                { checked: false },
                                [schema.nodes.paragraph.create({}, schema.text(textContent))]
                            );
                            const newTaskList = schema.nodes.taskList.create({}, [newTaskItem]);

                            // 先頭ブロックを置換
                            tr.replaceWith(0, firstNode.nodeSize, newTaskList);

                            // メタフラグ付与と履歴除外
                            tr.setMeta('autoTaskFirstLine', true);
                            tr.setMeta('addToHistory', false);

                            // セレクションの復元（入力した文字の直後にカーソルを置く）
                            try {
                                const endOfFirstBlock = tr.doc.firstChild!.nodeSize - 1;
                                tr.setSelection(TextSelection.near(tr.doc.resolve(endOfFirstBlock), -1));
                            } catch (e) {
                                // ignore
                            }

                            return tr;
                        }
                    }
                },
            }),
        ];
    },
});

type TiptapEditorProps = {
    initialContent?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    placeholder?: string;
    editable?: boolean;
    'data-autofocus'?: boolean;
};

export default function TiptapEditor({
    initialContent,
    onChange,
    placeholder = "Type '/' for commands…",
    editable = true,
    'data-autofocus': dataAutofocus
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
            AutoTaskFirstLine,
            Placeholder.configure({
                placeholder: ({ node }) => {
                    if (node.type.name === 'heading') {
                        return `H${node.attrs.level ?? 1}`;
                    }
                    if (node.type.name === 'paragraph') {
                        return 'Text';
                    }
                    return '';
                },
                showOnlyCurrent: true,
            }),
        ],
        content: initialContent || { type: 'doc', content: [] },
        editorProps: {
            attributes: {
                class: 'prose prose-slate max-w-none focus:outline-none pl-6 pr-4 pt-4 pb-4',
                ...(dataAutofocus ? { 'data-autofocus': 'true' } : {}),
            },
            handlePaste: (view, event, slice) => {
                const text = event.clipboardData?.getData('text/plain');
                if (text && (text.includes('\n') || text.includes('\r'))) {
                    const lines = text.split(/\r\n|\r|\n/);
                    const firstLine = lines[0];
                    const bodyLines = lines.slice(1);

                    const { state, dispatch } = view;
                    const { selection, schema } = state;
                    const $pos = selection.$from;

                    // 1. リスト内でのペーストか判定 (taskItem の中か)
                    // depth が 0 の場合はドキュメントトップなので除外
                    let tr = state.tr;
                    let isInsideTask = false;
                    let taskDepth = 0;

                    for (let d = $pos.depth; d > 0; d--) {
                        if (state.doc.nodeAt($pos.before(d))?.type.name === 'taskItem') {
                            isInsideTask = true;
                            taskDepth = d;
                            break;
                        }
                    }

                    if (isInsideTask && bodyLines.length > 0) {
                        console.log('[Tiptap] multiline paste in list detected, escaping list for body lines');

                        // 1行目を現在位置へ挿入（選択範囲を置換）
                        tr = tr.insertText(firstLine, selection.from, selection.to);

                        // 2行目以降は現在の taskItem を抜けてその直後に挿入
                        // 1行目挿入後の selection.to から解決し直すと安全
                        const $newPos = tr.doc.resolve(tr.mapping.map(selection.to));
                        const insertPos = $newPos.after(taskDepth);

                        const newParagraphs = bodyLines.map(line =>
                            schema.nodes.paragraph.create({}, line ? schema.text(line) : [])
                        );

                        tr = tr.insert(insertPos, newParagraphs);
                        dispatch(tr);
                        return true;
                    }

                    // リスト外の場合や1行のみの場合は標準挙動に任せる
                    return false;
                }
                return false;
            }
        },
        onUpdate: ({ editor }) => {
            if (isUpdatingRef.current) return;
            if (onChange) {
                onChange(editor.getJSON());
            }
        },
        autofocus: 'start', // 'start' に設定して初期化時に先頭へフォーカス
        onCreate: ({ editor }) => {
            // 補正：先頭行をタイトルタスクに強制
            const currentContent = editor.getJSON();
            const { content: correctedContent, changed } = ensureTitleTask(currentContent);
            if (changed) {
                isUpdatingRef.current = true;
                editor.commands.setContent(correctedContent, { emitUpdate: false });
                isUpdatingRef.current = false;
            }

            // 初期フォーカス位置を「1行目（タイトル行）の末尾」に設定
            if (editor.state && editor.state.doc.firstChild) {
                const firstNode = editor.state.doc.firstChild;
                // TextSelection.near を使用して、1行目の末尾（ノードの内側）にフォーカス
                // 1 + content.size はタイトル行の末尾の内部位置
                const endOfFirstBlock = 1 + firstNode.content.size;
                const tr = editor.state.tr.setSelection(
                    TextSelection.near(editor.state.doc.resolve(Math.min(endOfFirstBlock, editor.state.doc.content.size)), -1)
                );
                editor.view.dispatch(tr);
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
        <div className={`w-full bg-white dark:bg-gray-800 rounded-lg cursor-text ${styles.editor}`} onClick={() => editor.chain().focus().run()}>
            <EditorContent editor={editor} />
        </div>
    );
}
