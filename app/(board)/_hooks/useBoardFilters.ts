import { useState } from 'react';
import { Card } from '@/lib/supabase';
import { flattenChecklistText } from '@/lib/checklist';
import { getTiptapPlainText, normalizeContent } from '@/lib/tiptap';

export type SortOption = 'none' | 'due_date_asc' | 'due_date_desc';

type UseBoardFiltersArgs = {
  initialSearchQuery?: string;
  initialSelectedTags?: string[];
};

export function useBoardFilters({
  initialSearchQuery = '',
  initialSelectedTags = [],
}: UseBoardFiltersArgs = {}) {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialSelectedTags);
  const [sortBy, setSortBy] = useState<SortOption>('none');
  const [showFilters, setShowFilters] = useState(false);

  return {
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    sortBy,
    setSortBy,
    showFilters,
    setShowFilters,
  };
}

export const filterAndSortCards = (
  cards: Card[],
  searchQuery: string,
  selectedTags: string[],
  sortBy: SortOption
): Card[] => {
  let filtered = [...cards];

  // Search filter (title + content/excerpt + checklist text)
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (card) =>
        card.title.toLowerCase().includes(query) ||
        (card.excerpt ?? "").toLowerCase().includes(query) ||
        getTiptapPlainText(normalizeContent(card.content)).toLowerCase().includes(query) ||
        flattenChecklistText(card.checklist).toLowerCase().includes(query)
    );
  }

  // Tag filter
  if (selectedTags.length > 0) {
    filtered = filtered.filter((card) =>
      selectedTags.every((tag) => card.tags?.includes(tag))
    );
  }

  // Sort by due date
  if (sortBy === 'due_date_asc') {
    filtered.sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  } else if (sortBy === 'due_date_desc') {
    filtered.sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(b.due_date).getTime() - new Date(a.due_date).getTime();
    });
  }

  return filtered;
};

export const getAllTags = (cards: Card[]): string[] => {
  const tagsSet = new Set<string>();
  cards.forEach((card) => {
    card.tags?.forEach((tag) => tagsSet.add(tag));
  });
  return Array.from(tagsSet).sort();
};
