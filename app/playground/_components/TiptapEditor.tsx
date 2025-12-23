'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Extension, wrappingInputRule } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { clsx } from 'clsx';
import './TiptapEditor.css'; // We will create this file for specific Tiptap styles

const content = `
<h1>Heading 1</h1>
<h2>Heading 2</h2>
<h3>Heading 3</h3>
<p>
  This is a paragraph with <strong>bold</strong>, <em>italic</em>, and <strike>strike</strike> text.
</p>
<p>
  You can use <code>inline code</code> as well.
</p>
<hr>
<h3>Lists</h3>
<ul>
  <li>Bullet list item 1</li>
  <li>Bullet list item 2</li>
</ul>
<ol>
  <li>Ordered list item 1</li>
  <li>Ordered list item 2</li>
</ol>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false">Task item 1</li>
  <li data-type="taskItem" data-checked="true">Task item 2 (checked)</li>
</ul>
<blockquote>
  This is a blockquote.
</blockquote>
<pre><code>// This is a code block
console.log('Hello world');</code></pre>
`;

export default function TiptapEditor() {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // The History extension is enabled by default
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      // Custom Input Rule to ensure [ ] converts to TaskList
      Extension.create({
        name: 'checkboxInputRule',
        addInputRules() {
          return [
            wrappingInputRule({
              find: /^\s*(\[ \]|\[\])\s$/,
              type: this.editor.schema.nodes.taskList,
            }),
          ];
        },
      }),
      Placeholder.configure({
        placeholder: "Type '/' for commands…",
      }),
      Link.configure({
        openOnClick: false,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none min-h-[500px] px-4 py-2',
      },
    },
  });

  if (!editor) {
    return null;
  }

  return (
    <div className="w-full bg-white rounded-lg min-h-[600px] cursor-text" onClick={() => editor.chain().focus().run()}>
      <EditorContent editor={editor} />
    </div>
  );
}
