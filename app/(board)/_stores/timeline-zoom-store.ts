import { create } from 'zustand';

interface TimelineZoomState {
    hourHeight: number;
    setHourHeight: (height: number) => void;
}

export const MIN_HOUR_HEIGHT = 20;
export const MAX_HOUR_HEIGHT = 120;
export const ZOOM_STEP = 5;
export const DEFAULT_HOUR_HEIGHT = 40;

export const useTimelineZoomStore = create<TimelineZoomState>((set) => ({
    hourHeight: DEFAULT_HOUR_HEIGHT,
    setHourHeight: (nextHeight: number) => {
        // Clamp between min and max
        let clamped = Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, nextHeight));

        // Snap to step (optional, but good for UI consistency)
        clamped = Math.round(clamped / ZOOM_STEP) * ZOOM_STEP;

        set({ hourHeight: clamped });
    },
}));
