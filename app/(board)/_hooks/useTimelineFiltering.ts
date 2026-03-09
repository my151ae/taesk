"use client";

import { useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { useBoardFilters } from "@/app/(board)/_hooks/useBoardFilters";
import { getTiptapPlainText, normalizeContent } from "@/lib/tiptap";
import { flattenChecklistText } from "@/lib/checklist";
import type { Checklist } from "@/lib/checklist";
import type { TimelineBucketItem, TimelineResponse, TimelineEvent, TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";

export function useTimelineFiltering(data: TimelineResponse | null) {
    const {
        searchQuery,
        setSearchQuery,
        selectedTags,
        setSelectedTags,
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
            content?: JSONContent | Record<string, unknown> | null;
            excerpt?: string | null;
            checklist?: Checklist | null;
        }) => {
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
                const checklistText = flattenChecklistText(item.checklist ?? null);
                const source = `${item.title ?? ''} ${(item.tags ?? []).join(' ')} ${item.excerpt ?? ''} ${contentText} ${checklistText}`.toLowerCase();
                if (!source.includes(query)) return false;
            }
            return true;
        };

        const filteredEvents = data.events.filter(event => filterItem(event));

        const filteredBuckets = Object.entries(data.abBuckets).reduce((acc, [key, items]) => {
            acc[key] = items.filter(item => filterItem(item));
            return acc;
        }, {} as Record<string, TimelineBucketItem[]>);

        const filteredOverdue = data.overdue.filter((item: TimelineOverdueItem) => filterItem(item));

        return {
            ...data,
            events: filteredEvents,
            abBuckets: filteredBuckets,
            overdue: filteredOverdue,
        };
    }, [data, searchQuery, selectedTags]);

    const hasActiveFilters = useMemo(() => {
        return searchQuery.trim() !== '' || selectedTags.length > 0;
    }, [searchQuery, selectedTags]);

    const availableTags = useMemo(() => {
        const tags = new Set<string>();
        data?.events?.forEach((event) => {
            (event.tags ?? []).forEach((tag) => tags.add(tag));
        });
        Object.values(data?.abBuckets ?? {}).forEach((items) => {
            (items ?? []).forEach((item) => (item.tags ?? []).forEach((tag) => tags.add(tag)));
        });
        (data?.overdue ?? []).forEach((item) => {
            (item.tags ?? []).forEach((tag) => tags.add(tag));
        });
        return Array.from(tags).sort();
    }, [data?.events, data?.abBuckets, data?.overdue]);

    return {
        searchQuery,
        setSearchQuery,
        selectedTags,
        setSelectedTags,
        sortBy,
        setSortBy,
        showFilters,
        setShowFilters,
        filteredData,
        hasActiveFilters,
        availableTags,
    };
}
