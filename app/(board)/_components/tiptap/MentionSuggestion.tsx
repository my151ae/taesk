/**
 * TipTap Mention Suggestion Component
 * @入力時のサジェストUI
 */

'use client';

import { ReactRenderer } from '@tiptap/react';
import { SuggestionProps } from '@tiptap/suggestion';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import Image from 'next/image';

interface MentionItem {
  id: string;
  name: string;
  handle?: string; // @username or @id
  avatar_url?: string;
}

interface MentionListProps extends SuggestionProps<MentionItem> {
  items: MentionItem[];
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(
  (props, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = (index: number) => {
      const item = props.items[index];
      if (item) {
        props.command({ id: item.id, name: item.name });
      }
    };

    const upHandler = () => {
      setSelectedIndex(
        (selectedIndex + props.items.length - 1) % props.items.length
      );
    };

    const downHandler = () => {
      setSelectedIndex((selectedIndex + 1) % props.items.length);
    };

    const enterHandler = () => {
      selectItem(selectedIndex);
    };

    useEffect(() => {
      setSelectedIndex(0);
    }, [props.items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          upHandler();
          return true;
        }

        if (event.key === 'ArrowDown') {
          downHandler();
          return true;
        }

        if (event.key === 'Enter') {
          enterHandler();
          return true;
        }

        return false;
      },
    }));

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
        {props.items.length ? (
          props.items.map((item, index) => (
            <button
              key={item.id}
              className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-100 ${
                index === selectedIndex ? 'bg-blue-50' : ''
              }`}
              onClick={() => selectItem(index)}
            >
              {/* Avatar */}
              {item.avatar_url ? (
                <Image
                  src={item.avatar_url}
                  alt={item.name}
                  width={32}
                  height={32}
                  className="w-8 h-8 rounded-full flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-sm font-semibold text-gray-600 flex-shrink-0">
                  {item.name.slice(0, 1).toUpperCase()}
                </div>
              )}

              {/* Name and handle in vertical layout */}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-medium text-sm text-gray-900 truncate">
                  {item.name}
                </span>
                {item.handle && (
                  <span className="text-xs text-gray-500 truncate">
                    @{item.handle}
                  </span>
                )}
              </div>
            </button>
          ))
        ) : (
          <div className="px-3 py-2 text-sm text-gray-500">候補なし</div>
        )}
      </div>
    );
  }
);

MentionList.displayName = 'MentionList';

export function createMentionSuggestion(
  searchProfiles: (query: string) => Promise<MentionItem[]>
) {
  return {
    char: '@',
    items: async ({ query }: { query: string }) => {
      return await searchProfiles(query);
    },

    render: () => {
      let component: ReactRenderer<MentionListRef, MentionListProps>;
      let popup: TippyInstance[];

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });

          if (!props.clientRect) {
            return;
          }

          popup = tippy('body', {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          });
        },

        onUpdate(props: SuggestionProps<MentionItem>) {
          component.updateProps(props);

          if (!props.clientRect) {
            return;
          }

          popup[0].setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          });
        },

        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === 'Escape') {
            popup[0].hide();
            return true;
          }

          return component.ref?.onKeyDown(props) || false;
        },

        onExit() {
          popup[0].destroy();
          component.destroy();
        },
      };
    },
  };
}
