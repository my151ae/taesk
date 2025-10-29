/**
 * TipTap Mention Extension
 * インラインMentionノード（atom）の定義
 */

import { mergeAttributes, Node } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>;
  renderText: (props: { node: ProseMirrorNode }) => string;
  suggestion: {
    char: string;
    pluginKey: PluginKey;
    command: (props: {
      editor: unknown;
      range: { from: number; to: number };
      props: { id: string; name: string };
    }) => void;
  };
}

export const Mention = Node.create<MentionOptions>({
  name: 'mention',

  // インラインノード（行内に配置可能）
  inline: true,

  // アトミック（分割不可能、カーソルは前後のみ）
  atom: true,

  // グループ: inline（段落内に配置可能）
  group: 'inline',

  // 属性定義
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-mention-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {};
          }
          return {
            'data-mention-id': attributes.id,
          };
        },
      },
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-mention-name'),
        renderHTML: (attributes) => {
          if (!attributes.name) {
            return {};
          }
          return {
            'data-mention-name': attributes.name,
          };
        },
      },
    };
  },

  // HTML解析ルール
  parseHTML() {
    return [
      {
        tag: 'span[data-mention-id]',
      },
    ];
  },

  // HTML生成ルール
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { class: 'mention' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `@${node.attrs.name}`,
    ];
  },

  // テキスト表示（コピー時など）
  renderText({ node }) {
    return this.options.renderText({ node });
  },

  // Suggestion（@サジェスト）の設定
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

export default Mention;
