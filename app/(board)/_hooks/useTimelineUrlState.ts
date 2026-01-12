"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDayDiff, getIsoDateJst, getNowMinutesJst } from "@/app/(board)/_utils/timeline-helpers";

type UseTimelineUrlStateArgs = {
  initialDayRange?: number | null;
};

export const useTimelineUrlState = ({ initialDayRange }: UseTimelineUrlStateArgs) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date");
  const urlRange = searchParams.get("range");
  const urlTime = searchParams.get("time");

  const [dayWindowStart, setDayWindowStart] = useState(0);
  const dayWindowStartRef = useRef(0);

  const updateUrl = useCallback(
    (date: string | null, range: number, time?: number | null) => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);

      if (date) {
        params.set("date", date);
      } else {
        params.delete("date");
      }

      params.set("range", String(range));

      if (time != null && time >= 0) {
        params.set("time", String(Math.round(time)));
      } else {
        params.delete("time");
      }

      const current = new URLSearchParams(window.location.search);
      const currentDate = current.get("date");
      const currentRange = current.get("range");
      const currentTime = current.get("time");
      const nextDate = params.get("date");
      const nextRange = params.get("range");
      const nextTime = params.get("time");

      if (currentDate === nextDate && currentRange === nextRange && currentTime === nextTime) {
        return;
      }

      const query = params.toString();
      const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
      router.replace(newUrl, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    if (urlDate) {
      const todayJst = getIsoDateJst(new Date().toISOString());
      const start = getDayDiff(urlDate, todayJst);
      if (!isNaN(start)) {
        setDayWindowStart(start);
        dayWindowStartRef.current = start;
      }
    }
  }, [urlDate]);

  useEffect(() => {
    if (!urlDate && !urlRange && !urlTime) {
      const todayJst = getIsoDateJst(new Date().toISOString());
      const nowMinutes = getNowMinutesJst(new Date().toISOString());
      const defaultRange = initialDayRange ?? 2;
      updateUrl(todayJst, defaultRange, nowMinutes);
    }
  }, [urlDate, urlRange, urlTime, initialDayRange, updateUrl]);

  const initialRange = useMemo(() => {
    const urlRangeValue = urlRange ? parseInt(urlRange, 10) : null;
    if (urlRangeValue && urlRangeValue >= 1 && urlRangeValue <= 120) {
      return urlRangeValue;
    }
    return initialDayRange ?? 2;
  }, [urlRange, initialDayRange]);

  return {
    urlDate,
    urlRange,
    urlTime,
    initialRange,
    dayWindowStart,
    setDayWindowStart,
    dayWindowStartRef,
    updateUrl,
  };
};
