'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { ProfileSummary } from '@/lib/supabase';

interface MentionProps {
  userId: string;
  profile?: ProfileSummary | null;
}

export function Mention({ userId, profile }: MentionProps) {
  const [showCard, setShowCard] = useState(false);

  const displayName = profile?.full_name || profile?.email || 'Unknown User';

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
        @{displayName}
      </span>

      {/* Hover card */}
      {showCard && profile && (
        <span className="absolute bottom-full left-0 mb-2 z-10 w-64 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={displayName}
                width={40}
                height={40}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-semibold">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{displayName}</div>
              {profile.email && (
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {profile.email}
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
 * Expects mentions to be stored as UUIDs in the database
 * Handles both legacy format (@username<@uuid>) and standard format (@username)
 */
export function RenderCommentBody({ body, mentions, profiles }: RenderCommentBodyProps) {
  if (!mentions || mentions.length === 0) {
    return <span className="whitespace-pre-wrap">{body}</span>;
  }

  // Create a map of user IDs to profiles for quick lookup
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Find all @mentions in the text and replace with Mention components
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;

  // Regex to match @username<@uuid> or @username patterns
  // Captures: @(username)<@uuid> or @(username)
  // Uses (?:(?!<@).)+ to match any character except the start of <@ tag
  // Matches until we hit <@ or a boundary (space/end of string/non-word character)
  const mentionRegex = /@((?:(?!<@).)+?)(?:<@([0-9a-f-]{36})>)/gu;
  let match;

  while ((match = mentionRegex.exec(body)) !== null) {
    const mentionText = match[1].trim();
    const mentionUuid = match[2]; // UUID from <@uuid> if present

    // Try to find matching profile
    // First try by UUID if available, then by name
    let profile: ProfileSummary | null | undefined = null;

    if (mentionUuid) {
      profile = profileMap.get(mentionUuid);
    }

    if (!profile) {
      profile = mentions
        .map((id) => profileMap.get(id))
        .find((p) =>
          p?.full_name?.toLowerCase().includes(mentionText.toLowerCase()) ||
          p?.email?.toLowerCase().includes(mentionText.toLowerCase())
        );
    }

    if (profile) {
      // Add text before mention
      if (match.index > lastIndex) {
        parts.push(body.substring(lastIndex, match.index));
      }

      // Add Mention component (displays only @username, hiding <@uuid>)
      parts.push(
        <Mention
          key={`mention-${match.index}-${profile.id}`}
          userId={profile.id}
          profile={profile}
        />
      );

      lastIndex = match.index + match[0].length;
    }
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
