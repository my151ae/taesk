"use client";

export function getTagsSectionPresentation({
  selectedTag,
  tagSummariesCount,
  tagResultsCount,
}: {
  selectedTag: string | null;
  tagSummariesCount: number;
  tagResultsCount: number;
}) {
  return {
    label: "Tags",
    count: selectedTag ? tagResultsCount : tagSummariesCount,
    triggerLabel: selectedTag ? `#${selectedTag}` : "Tags",
  };
}
