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

  // Search profiles for mention suggestion
  const searchProfiles = useMemo(
    () => async (query: string) => {
      // If profiles haven't loaded yet, return empty array
      if (profiles.length === 0) {
        return [];
      }

      const normalizedQuery = query.toLowerCase();

      // If query is empty, show all profiles (up to 10)
      if (!query.trim()) {
        return profiles
          .slice(0, 10)
          .map(p => ({
            id: p.id,
            name: p.full_name || p.email || 'Unknown',
            avatar_url: p.avatar_url || undefined,
          }));
      }

      // Filter by query
      return profiles
        .filter(p => {
          const username = p.username?.toLowerCase() ?? '';
          const display = p.display_name?.toLowerCase() ?? '';
          const name = p.full_name?.toLowerCase() ?? '';
          const email = p.email?.toLowerCase() ?? '';
          return (
            username.includes(normalizedQuery) ||
            display.includes(normalizedQuery) ||
            name.includes(normalizedQuery) ||
            email.includes(normalizedQuery)
          );
        })
        .slice(0, 10)
        .map(p => {
          const identity = resolveProfileIdentity(p, p.email ?? null);
          const label = identity.label.startsWith('@') ? identity.label.slice(1) : identity.label;
          return {
            id: p.id,
            name: label,
            avatar_url: p.avatar_url || undefined,
          };
        });
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
