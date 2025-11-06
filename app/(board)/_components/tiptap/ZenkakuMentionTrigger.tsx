/**
 * Full-width ＠ Mention Trigger Extension
 * 全角＠専用のSuggestion拡張
 *
 * This extension adds support for full-width ＠ (U+FF20) as a mention trigger,
 * working alongside the existing half-width @ trigger.
 */

import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { createMentionSuggestion } from './MentionSuggestion';

export interface ZenkakuMentionTriggerOptions {
  searchProfiles: (query: string) => Promise<Array<{
    id: string;
    name: string;
    handle?: string;
    avatar_url?: string;
  }>>;
  onInsertMention: (props: { id: string; name: string }) => void;
}

export const ZenkakuMentionTrigger = Extension.create<ZenkakuMentionTriggerOptions>({
  name: 'zenkakuMentionTrigger',

  addOptions() {
    return {
      searchProfiles: async () => [],
      onInsertMention: () => {},
    };
  },

  addProseMirrorPlugins() {
    const { searchProfiles, onInsertMention } = this.options;

    return [
      Suggestion({
        editor: this.editor,
        ...createMentionSuggestion(async (query: string) => {
          // NFKC normalization for consistent matching
          const normalizedQuery = query.normalize('NFKC');
          return await searchProfiles(normalizedQuery);
        }),
        char: '＠', // Full-width at sign (U+FF20)
        pluginKey: new PluginKey('zenkakuMention'),
        command: ({ editor, range, props }) => {
          // Insert mention node (same as half-width @)
          onInsertMention(props);

          // Delete the trigger character (＠) and insert Mention node
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: 'mention',
              attrs: props,
            })
            .run();
        },
      }),
    ];
  },
});
