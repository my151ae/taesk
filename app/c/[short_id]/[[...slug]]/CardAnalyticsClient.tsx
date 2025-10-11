'use client';

import { useEffect } from 'react';

import { page, track } from '@/lib/analytics';

type Props = {
  canonicalPath: string;
  cardShortId: string;
  boardId: string;
};

export default function CardAnalyticsClient({ canonicalPath, cardShortId, boardId }: Props) {
  useEffect(() => {
    page(canonicalPath);
    track('card_page_view', { shortId: cardShortId, boardId });
  }, [canonicalPath, cardShortId, boardId]);

  return null;
}
