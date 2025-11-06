/**
 * TipTap Comment Editor Component
 * コメント編集用のエディタ（fromStorage/toStorage統合）
 */

'use client';

import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Mention } from './Mention';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { createMentionSuggestion } from './MentionSuggestion';
import { ZenkakuMentionTrigger } from './ZenkakuMentionTrigger';
import { fromStorage, toStorage, getCachedProfileName, cacheProfiles } from '@/lib/mention-utils';
import { useEffect, useMemo } from 'react';
import type { ProfileSummary } from '@/lib/supabase';
import type { Range } from '@tiptap/core';
import { resolveProfileIdentity } from '@/lib/usernames';

interface CommentEditorProps {
  initialValue: string; // Storage format: "<@id>" tokens
  onChange: (value: string) => void; // Returns storage format
  onSubmit?: () => void;
  placeholder?: string;
  profiles: ProfileSummary[]; // For name resolution and search
  boardId: string;
  className?: string;
  autoFocus?: boolean;
}

export default function CommentEditor({
  initialValue,
  onChange,
  onSubmit,
  placeholder = 'コメントを入力...',
  profiles,
  boardId,
  className = '',
  autoFocus = false,
}: CommentEditorProps) {
  // Cache profiles for name resolution
  useEffect(() => {
    cacheProfiles(
      profiles.map(p => {
        const identity = resolveProfileIdentity(p, p.email ?? null);
        const label = identity.label.startsWith('@') ? identity.label.slice(1) : identity.label;
        return {
          id: p.id,
          name: label,
        };
      })
    );
  }, [profiles]);

  // ResolveName function: ID → display name
  const resolveName = useMemo(
    () => (id: string) => {
      const cached = getCachedProfileName(id);
      if (cached) return cached;

      // Fallback: search in profiles prop
      const profile = profiles.find(p => p.id === id);
      if (!profile) return id;
      const identity = resolveProfileIdentity(profile, profile.email ?? null);
      return identity.label.startsWith('@') ? identity.label.slice(1) : identity.label;
    },
    [profiles]
  );

  // Search profiles for mention suggestion with scoring
  const searchProfiles = useMemo(
    () => async (query: string) => {
      // If profiles haven't loaded yet, return empty array
      if (profiles.length === 0) {
        return [];
      }

      // NFKC normalization for consistent matching (half/full-width characters)
      const normalize = (s: string) => s.normalize('NFKC').toLowerCase();
      const normalizedQuery = normalize(query);

      // If query is empty, show all profiles sorted by name
      if (!query.trim()) {
        return profiles
          .slice(0, 10)
          .map(p => {
            const identity = resolveProfileIdentity(p, p.email ?? null);
            const displayName = identity.label.startsWith('@') ? identity.label.slice(1) : identity.label;
            return {
              id: p.id,
              name: displayName,
              handle: p.username || p.id.slice(0, 8),
              avatar_url: p.avatar_url || undefined,
            };
          });
      }

      // Score-based search: startsWith > includes
      const scored = profiles.map(p => {
        const identity = resolveProfileIdentity(p, p.email ?? null);
        const displayName = identity.label.startsWith('@') ? identity.label.slice(1) : identity.label;
        const handle = p.username || p.id.slice(0, 8);

        const normName = normalize(displayName);
        const normHandle = normalize(handle);
        const normFullName = normalize(p.full_name || '');
        const normEmail = normalize(p.email || '');

        let score = 0;
        // Highest priority: prefix match on username/handle
        if (normHandle.startsWith(normalizedQuery)) score = 30;
        // High priority: prefix match on display name
        else if (normName.startsWith(normalizedQuery)) score = 20;
        // Medium priority: prefix match on full name
        else if (normFullName.startsWith(normalizedQuery)) score = 15;
        // Lower priority: contains in handle
        else if (normHandle.includes(normalizedQuery)) score = 10;
        // Lower priority: contains in display name
        else if (normName.includes(normalizedQuery)) score = 8;
        // Lower priority: contains in full name
        else if (normFullName.includes(normalizedQuery)) score = 5;
        // Lowest priority: contains in email
        else if (normEmail.includes(normalizedQuery)) score = 2;

        return {
          profile: p,
          displayName,
          handle,
          score,
        };
      });

      // Filter, sort by score (desc) then by name (asc), and take top 10
      return scored
        .filter(item => item.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.displayName.localeCompare(b.displayName, 'ja');
        })
        .slice(0, 10)
        .map(item => ({
          id: item.profile.id,
          name: item.displayName,
          handle: item.handle,
          avatar_url: item.profile.avatar_url || undefined,
        }));
    },
    [profiles]
  );

  const editor = useEditor({
    immediatelyRender: false, // Fix SSR hydration mismatch
    extensions: [
      StarterKit.configure({
        // Disable default paragraph handling (we handle it in mention-utils)
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'mention',
        },
        renderText({ node }) {
          return `@${node.attrs.name}`;
        },
        suggestion: {
          ...createMentionSuggestion(searchProfiles),
          pluginKey: new PluginKey('mention'),
          command: ({ editor, range, props }) => {
            // Delete the trigger character (@) and insert Mention node
            (editor as Editor)
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: 'mention',
                attrs: props,
              })
              .run();
          },
        },
      }),
      // Full-width ＠ trigger support
      ZenkakuMentionTrigger.configure({
        searchProfiles,
        onInsertMention: (props) => {
          // Optional: track full-width mention insertions
          console.debug('[ZenkakuMention] Inserted:', props);
        },
      }),
    ],
    content: fromStorage(initialValue, resolveName),
    onUpdate: ({ editor }) => {
      const doc = editor.getJSON();
      const storageText = toStorage(doc as never);
      onChange(storageText);
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm max-w-none focus:outline-none ${className}`,
      },
      handleKeyDown: (view, event) => {
        // Submit on Shift+Enter (changed from Enter)
        if (event.key === 'Enter' && event.shiftKey && onSubmit) {
          event.preventDefault();
          onSubmit();
          return true;
        }
        // Let Enter work normally for mention selection and line breaks
        return false;
      },
    },
    autofocus: autoFocus ? 'end' : false,
  });

  // Update content when initialValue changes (e.g., switching to edit mode)
  useEffect(() => {
    if (editor && initialValue !== toStorage(editor.getJSON() as never)) {
      const doc = fromStorage(initialValue, resolveName);
      editor.commands.setContent(doc);
    }
  }, [initialValue, editor, resolveName]);

  return (
    <div className="border border-gray-300 rounded-md p-2 min-h-[100px] bg-white">
      <EditorContent editor={editor} placeholder={placeholder} />
      <style jsx global>{`
        .mention {
          color: #0066cc;
          background-color: #e6f2ff;
          border-radius: 0.25rem;
          padding: 0.125rem 0.25rem;
          font-weight: 600;
          cursor: default;
          user-select: none;
        }

        .ProseMirror {
          min-height: 60px;
          outline: none;
        }

        .ProseMirror p.is-editor-empty:first-child::before {
          color: #adb5bd;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }

        .ProseMirror p {
          margin: 0;
          padding: 0.25rem 0;
        }
      `}</style>
    </div>
  );
}
