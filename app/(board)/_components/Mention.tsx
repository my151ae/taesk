'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { ProfileSummary } from '@/lib/supabase';
import { resolveProfileIdentity, getProfileInitial } from '@/lib/usernames';

interface MentionProps {
  userId: string;
  profile?: ProfileSummary | null;
}

export function Mention({ userId, profile }: MentionProps) {
  const [showCard, setShowCard] = useState(false);

  const identity = profile ? resolveProfileIdentity(profile, profile.email ?? null) : null;
  const baseLabel = identity ? identity.label : 'Unknown User';
  const mentionLabel = identity
    ? identity.source === 'username' || baseLabel.startsWith('@')
      ? baseLabel
      : `@${baseLabel}`
    : '@Unknown User';
  const hoverTitle = identity ? identity.label : 'Unknown User';
  const hoverSecondary = identity?.secondary && identity.secondary !== identity.label
    ? identity.secondary
    : (profile?.email && profile.email !== identity?.label ? profile.email : null);
  const avatarInitial = profile ? getProfileInitial(profile, profile.email ?? null) : 'U';

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setShowCard(true)}
      onMouseLeave={() => setShowCard(false)}
    >
      <span
        className="text-sky-600 dark:text-sky-400 font-medium cursor-pointer hover:underline"
        data-mention-id={userId}
      >
        {mentionLabel}
      </span>

      {/* Hover card */}
      {showCard && profile && (
        <span className="absolute bottom-full left-0 mb-2 z-10 w-64 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={hoverTitle}
                width={40}
                height={40}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-semibold">
                {avatarInitial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{hoverTitle}</div>
              {hoverSecondary && (
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {hoverSecondary}
                </div>
              )}
            </div>
          </div>
        </span>
      )}
    </span>
  );
}

interface RenderCommentBodyProps {
  body: string;
  mentions: string[];
  profiles: ProfileSummary[];
}

/**
 * Render comment body with highlighted mentions
 * Uses mention-utils to parse <@id> tokens and render @display_name
 */
export function RenderCommentBody({ body, mentions, profiles }: RenderCommentBodyProps) {
  // Import mention-utils functions locally
  const { MENTION_REGEX } = require('@/lib/mention-utils');

  // Create a map of user IDs to profiles for quick lookup
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Find all <@id> mentions and replace with Mention components
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;

  const regex = new RegExp(MENTION_REGEX);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    const userId = match[1]; // Extract ID from <@id>
    const profile = profileMap.get(userId);

    // Add text before mention
    if (match.index > lastIndex) {
      parts.push(body.substring(lastIndex, match.index));
    }

    // Add Mention component (displays @display_name)
    parts.push(
      <Mention
        key={`mention-${match.index}-${userId}`}
        userId={userId}
        profile={profile || null}
      />
    );

    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < body.length) {
    parts.push(body.substring(lastIndex));
  }

  // If no mentions were matched, return plain text
  if (parts.length === 0) {
    return <span className="whitespace-pre-wrap">{body}</span>;
  }

  return <span className="whitespace-pre-wrap">{parts}</span>;
}
