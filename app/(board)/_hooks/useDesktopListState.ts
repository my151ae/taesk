"use client";

import { useEffect, useState } from "react";

type UseDesktopListStateArgs = {
  listBaseDate?: string | null;
  fallbackBaseDate?: string;
};

export function useDesktopListState({
  listBaseDate,
  fallbackBaseDate = "",
}: UseDesktopListStateArgs) {
  const [showUnchecked, setShowUnchecked] = useState(true);
  const [showGoogle, setShowGoogle] = useState(false);
  const [showChecked, setShowChecked] = useState(true);
  const baseDateValue = listBaseDate ?? fallbackBaseDate;
  const [draftBaseDate, setDraftBaseDate] = useState(baseDateValue);

  useEffect(() => {
    setDraftBaseDate(baseDateValue);
  }, [baseDateValue]);

  return {
    showUnchecked,
    setShowUnchecked,
    showGoogle,
    setShowGoogle,
    showChecked,
    setShowChecked,
    draftBaseDate,
    setDraftBaseDate,
    baseDateValue,
  };
}
