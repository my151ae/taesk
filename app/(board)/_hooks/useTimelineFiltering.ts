"use client";

import { useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { useBoardFilters } from "@/app/(board)/_hooks/useBoardFilters";
import { getTiptapPlainText, normalizeContent } from "@/lib/tiptap";
import { flattenChecklistText } from "@/lib/checklist";
import type { TimelineBucketItem, TimelineResponse, TimelineEvent } from "@/app/(board)/_utils/timeline-helpers";

export function useTimelineFiltering(data: TimelineResponse | null) {
    const {
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
    } = useBoardFilters();

    const filteredData = useMemo(() => {
        if (!data) return null;

        const filterItem = (item: {
            title: string;
            tags: string[];
            priority?: string | null;
            content?: JSONContent | Record<string, any> | null;
            excerpt?: string | null;
            checklist?: unknown;
        }) => {
            // Priority
            if (selectedPriority !== 'all' && item.priority !== selectedPriority) return false;

            // Tags
            if (selectedTags.length > 0) {
                const tagSet = new Set(item.tags ?? []);
                if (!selectedTags.every((tag: string) => tagSet.has(tag))) return false;
            }

            // Search
            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase();
                let contentText = "";
                if (item.content) {
                    contentText = getTiptapPlainText(normalizeContent(item.content));
                }
                const checklistText = flattenChecklistText((item as any).checklist ?? null);
                const source = `${item.title ?? ''} ${(item.tags ?? []).join(' ')} ${item.excerpt ?? ''} ${contentText} ${checklistText}`.toLowerCase();
                if (!source.includes(query)) return false;
            }
            return true;
        };

        const filteredEvents = data.events.filter(event => filterItem(event));

        const filteredBuckets = Object.entries(data.abBuckets).reduce((acc, [key, items]) => {
            acc[key] = items.filter(item => filterItem({ ...item, priority: null }));
            return acc;
        }, {} as Record<string, TimelineBucketItem[]>);

        return {
            ...data,
            events: filteredEvents,
            abBuckets: filteredBuckets,
        };
    }, [data, searchQuery, selectedTags, selectedPriority]);

    const hasActiveFilters = useMemo(() => {
        return searchQuery.trim() !== '' || selectedTags.length > 0 || selectedPriority !== 'all';
    }, [searchQuery, selectedTags, selectedPriority]);

    const availableTags = useMemo(() => {
        const tags = new Set<string>();
        data?.events?.forEach((event) => {
            (event.tags ?? []).forEach((tag) => tags.add(tag));
        });
        Object.values(data?.abBuckets ?? {}).forEach((items) => {
            (items ?? []).forEach((item) => (item.tags ?? []).forEach((tag) => tags.add(tag)));
        });
        return Array.from(tags).sort();
    }, [data?.events, data?.abBuckets]);

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
        filteredData,
        hasActiveFilters,
        availableTags,
    };
}
