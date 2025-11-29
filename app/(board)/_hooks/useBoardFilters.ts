import { useState } from 'react';
import { Card, Priority } from '@/lib/supabase';
import { flattenChecklistText } from '@/lib/checklist';

export type SortOption = 'none' | 'due_date_asc' | 'due_date_desc';

export function useBoardFilters() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPriority, setSelectedPriority] = useState<Priority | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('none');
  const [showFilters, setShowFilters] = useState(false);

  return {
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    selectedPriority,
    setSelectedPriority,
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
  selectedPriority: Priority | 'all',
  sortBy: SortOption
): Card[] => {
  let filtered = [...cards];

  // Search filter (title + checklist text)
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (card) =>
        card.title.toLowerCase().includes(query) ||
        flattenChecklistText(card.checklist).toLowerCase().includes(query)
    );
  }

  // Tag filter
  if (selectedTags.length > 0) {
    filtered = filtered.filter((card) =>
      selectedTags.every((tag) => card.tags?.includes(tag))
    );
  }

  // Priority filter
  if (selectedPriority !== 'all') {
    filtered = filtered.filter((card) => card.priority === selectedPriority);
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
