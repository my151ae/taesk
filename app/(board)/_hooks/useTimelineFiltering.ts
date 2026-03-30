"use client";

import { useEffect, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { useBoardFilters } from "@/app/(board)/_hooks/useBoardFilters";
import { buildTimelineCardTimeText } from "@/app/(board)/_components/timeline/timeline-card-meta";
import { getTiptapPlainText, normalizeContent } from "@/lib/tiptap";
import { flattenChecklistText } from "@/lib/checklist";
import type { Checklist } from "@/lib/checklist";
import type { TimelineBucketItem, TimelineResponse, TimelineEvent, TimelineOverdueItem } from "@/app/(board)/_utils/timeline-helpers";

type FilterableTimelineItem = {
    title: string;
    tags: string[];
    content?: JSONContent | Record<string, unknown> | null;
    excerpt?: string | null;
    checklist?: Checklist | null;
};

type TimelineSidebarCardItem = TimelineEvent | TimelineBucketItem | TimelineOverdueItem;

export type TimelineSearchResultItem = {
    kind: "event" | "bucket" | "overdue";
    item: TimelineSidebarCardItem;
    badgeLabel: string;
    timeText: string | null;
};

export type TimelineTagSummary = {
    name: string;
    count: number;
};

const matchesSearchQuery = (item: FilterableTimelineItem, searchQuery: string) => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    let contentText = "";
    if (item.content) {
        contentText = getTiptapPlainText(normalizeContent(item.content));
    }
    const checklistText = flattenChecklistText(item.checklist ?? null);
    const source = `${item.title ?? ''} ${(item.tags ?? []).join(' ')} ${item.excerpt ?? ''} ${contentText} ${checklistText}`.toLowerCase();
    return source.includes(query);
};

const compareSearchResults = (a: TimelineSearchResultItem, b: TimelineSearchResultItem) => {
    const dateA = a.item.due_date ?? "9999-12-31";
    const dateB = b.item.due_date ?? "9999-12-31";
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const timeA = a.item.due_start ?? a.item.due_end ?? "99:99";
    const timeB = b.item.due_start ?? b.item.due_end ?? "99:99";
    if (timeA !== timeB) return timeA.localeCompare(timeB);

    const kindRank = { overdue: 0, event: 1, bucket: 2 } as const;
    if (kindRank[a.kind] !== kindRank[b.kind]) {
        return kindRank[a.kind] - kindRank[b.kind];
    }

    return (a.item.title ?? "").localeCompare(b.item.title ?? "");
};

type UseTimelineFilteringArgs = {
    initialSearchQuery?: string;
    initialSelectedTags?: string[];
};

export function useTimelineFiltering(
    data: TimelineResponse | null,
    { initialSearchQuery = "", initialSelectedTags = [] }: UseTimelineFilteringArgs = {},
) {
    const {
        searchQuery,
        setSearchQuery,
        selectedTags,
        setSelectedTags,
        sortBy,
        setSortBy,
        showFilters,
        setShowFilters,
    } = useBoardFilters({
        initialSearchQuery,
        initialSelectedTags,
    });

    useEffect(() => {
        if (searchQuery !== initialSearchQuery) {
            setSearchQuery(initialSearchQuery);
        }
    }, [initialSearchQuery, searchQuery, setSearchQuery]);

    useEffect(() => {
        const current = selectedTags.join("\u0000");
        const next = initialSelectedTags.join("\u0000");
        if (current !== next) {
            setSelectedTags(initialSelectedTags);
        }
    }, [initialSelectedTags, selectedTags, setSelectedTags]);

    const filteredData = useMemo(() => {
        if (!data) return null;
        return data;
    }, [data]);

    const searchResults = useMemo(() => {
        if (!data || !searchQuery.trim()) return [] as TimelineSearchResultItem[];

        const results: TimelineSearchResultItem[] = [];

        data.overdue.forEach((item) => {
            if (!matchesSearchQuery(item, searchQuery)) return;
            results.push({
                kind: "overdue",
                item,
                badgeLabel: item.due_bucket?.toUpperCase() ?? "O",
                timeText: buildTimelineCardTimeText(item, {
                    includeDate: true,
                    includeDuration: true,
                }),
            });
        });

        data.events.forEach((item) => {
            if (!matchesSearchQuery(item, searchQuery)) return;
            results.push({
                kind: "event",
                item,
                badgeLabel: item.due_bucket?.toUpperCase() ?? "T",
                timeText: buildTimelineCardTimeText(item, {
                    includeDate: true,
                    includeDuration: true,
                }),
            });
        });

        Object.entries(data.abBuckets).forEach(([bucketKey, items]) => {
            const badgeLabel = bucketKey.endsWith("_a") ? "A" : bucketKey.endsWith("_b") ? "B" : "L";
            items.forEach((item) => {
                if (!matchesSearchQuery(item, searchQuery)) return;
                results.push({
                    kind: "bucket",
                    item,
                    badgeLabel,
                    timeText: buildTimelineCardTimeText(item, {
                        includeDate: true,
                        includeDuration: true,
                    }),
                });
            });
        });

        return results.sort(compareSearchResults);
    }, [data, searchQuery]);

    const hasActiveFilters = useMemo(() => {
        return searchQuery.trim() !== '';
    }, [searchQuery]);

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

    const tagSummaries = useMemo(() => {
        const counts = new Map<string, Set<string>>();

        data?.events?.forEach((event) => {
            (event.tags ?? []).forEach((tag) => {
                const next = counts.get(tag) ?? new Set<string>();
                next.add(event.card_id);
                counts.set(tag, next);
            });
        });
        Object.values(data?.abBuckets ?? {}).forEach((items) => {
            (items ?? []).forEach((item) => {
                (item.tags ?? []).forEach((tag) => {
                    const next = counts.get(tag) ?? new Set<string>();
                    next.add(item.card_id);
                    counts.set(tag, next);
                });
            });
        });
        (data?.overdue ?? []).forEach((item) => {
            (item.tags ?? []).forEach((tag) => {
                const next = counts.get(tag) ?? new Set<string>();
                next.add(item.card_id);
                counts.set(tag, next);
            });
        });

        return Array.from(counts.entries())
            .map(([name, cardIds]) => ({ name, count: cardIds.size }))
            .sort((left, right) => {
                if (right.count !== left.count) return right.count - left.count;
                return left.name.localeCompare(right.name);
            });
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
        searchResults,
        hasActiveFilters,
        availableTags,
        tagSummaries,
    };
}
