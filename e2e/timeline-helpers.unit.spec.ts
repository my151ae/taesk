import { test, expect } from '@playwright/test';
import {
    calculateStackedEventLayout,
    getIsoDateJst,
    getMsUntilNextTimelineBoundary,
    getTimelineIsoDateJst,
    NormalizedTimelineLayoutItem,
} from '../app/(board)/_utils/timeline-helpers';
import { buildDesktopAllDayState, buildMobileTimelineViewState, buildVisibleDays } from '../app/(board)/_components/timeline/timeline-render-model';
import { hasPrefetchedNeighborsForDay, resolveAnchorDayFromPayload } from '../app/(board)/_hooks/useTimelineNavigation';
import {
    formatShortcutKeyLabel,
    resolveShortcutBarPayload,
    sliceShortcutItems,
} from '../app/(board)/_components/timeline/shortcut-bar-registry';

test.describe('calculateStackedEventLayout - Time Overlap Logic', () => {
    test('水平方向の重なりで 2 番目以降のアイテムの isTimeOverlapped が true になること', async () => {
        const items: NormalizedTimelineLayoutItem[] = [
            {
                kind: 'card',
                id: '1',
                key: 'card:1',
                listIndex: 0,
                startMinutes: 600, // 10:00
                durationMinutes: 60,
                entry: {}
            },
            {
                kind: 'card',
                id: '2',
                key: 'card:2',
                listIndex: 1,
                startMinutes: 610, // 10:10 (重なり)
                durationMinutes: 60,
                entry: {}
            }
        ];

        const layout = calculateStackedEventLayout(items, { device: 'desktop' });
        
        // アイテム1は false, アイテム2は水平重なり（half-overlap）により true
        expect(layout['card:1'].isTimeOverlapped).toBe(false);
        expect(layout['card:2'].isTimeOverlapped).toBe(true);
    });

    test('垂直方向の近接（16px相当以内）で isTimeOverlapped が true になること', async () => {
        const items: NormalizedTimelineLayoutItem[] = [
            {
                kind: 'card',
                id: '1',
                key: 'card:1',
                listIndex: 0,
                startMinutes: 600, // 10:00
                durationMinutes: 60, // 終了 11:00
                entry: {}
            },
            {
                kind: 'card',
                id: '2',
                key: 'card:2',
                listIndex: 1,
                startMinutes: 660, // 11:00 (ちょうど終了時刻)
                durationMinutes: 60,
                entry: {}
            }
        ];

        // hourHeight = 40 のとき、16px = 24分
        const layout = calculateStackedEventLayout(items, { 
            device: 'desktop', 
            hourHeight: 40, 
            timeLabelHeightPx: 16 
        });

        expect(layout['card:1'].isTimeOverlapped).toBe(false);
        expect(layout['card:2'].isTimeOverlapped).toBe(true);
    });

    test('垂直方向に離れている場合は isTimeOverlapped が false になること', async () => {
        const items: NormalizedTimelineLayoutItem[] = [
            {
                kind: 'card',
                id: '1',
                key: 'card:1',
                listIndex: 0,
                startMinutes: 600, // 10:00
                durationMinutes: 60, // 終了 11:00
                entry: {}
            },
            {
                kind: 'card',
                id: '2',
                key: 'card:2',
                listIndex: 1,
                startMinutes: 700, // 11:40 (40分空き > 24分)
                durationMinutes: 60,
                entry: {}
            }
        ];

        const layout = calculateStackedEventLayout(items, { 
            device: 'desktop', 
            hourHeight: 40, 
            timeLabelHeightPx: 16 
        });

        expect(layout['card:1'].isTimeOverlapped).toBe(false);
        expect(layout['card:2'].isTimeOverlapped).toBe(false);
    });

    test('ズーム（hourHeight）の変更に応じてしきい値が変わること', async () => {
        const items: NormalizedTimelineLayoutItem[] = [
            {
                kind: 'card',
                id: '1',
                key: 'card:1',
                listIndex: 0,
                startMinutes: 600,
                durationMinutes: 60, // 終了 11:00
                entry: {}
            },
            {
                kind: 'card',
                id: '2',
                key: 'card:2',
                listIndex: 1,
                startMinutes: 680, // 11:20
                durationMinutes: 60,
                entry: {}
            }
        ];

        // hourHeight = 40 のとき、16px = 24分。20分空きなので true。
        const layout1 = calculateStackedEventLayout(items, { hourHeight: 40, timeLabelHeightPx: 16 });
        expect(layout1['card:2'].isTimeOverlapped).toBe(true);

        // hourHeight = 80 のとき、16px = 12分。20分空きなので false。
        const layout2 = calculateStackedEventLayout(items, { hourHeight: 80, timeLabelHeightPx: 16 });
        expect(layout2['card:2'].isTimeOverlapped).toBe(false);
    });

    test('runningMaxEnd により、複数の前の要素のうち最も遅いものと比較されること', async () => {
        const items: NormalizedTimelineLayoutItem[] = [
            {
                kind: 'card',
                id: 'short',
                key: 'card:short',
                listIndex: 0,
                startMinutes: 600,
                durationMinutes: 10, // 10:00 - 10:10
                entry: {}
            },
            {
                kind: 'card',
                id: 'long',
                key: 'card:long',
                listIndex: 1,
                startMinutes: 600,
                durationMinutes: 120, // 10:00 - 12:00
                entry: {}
            },
            {
                kind: 'card',
                id: 'target',
                key: 'card:target',
                listIndex: 2,
                startMinutes: 700, // 11:40 (12:00の20分前)
                durationMinutes: 30,
                entry: {}
            }
        ];

        const layout = calculateStackedEventLayout(items, { hourHeight: 40, timeLabelHeightPx: 16 });
        // target は long (12:00終了) に近接しているため true
        expect(layout['card:target'].isTimeOverlapped).toBe(true);
    });
});

test.describe('timeline day boundary helpers', () => {
    test('getIsoDateJst keeps calendar date on JST midnight boundary', async () => {
        expect(getIsoDateJst('2026-03-29T15:10:00.000Z')).toBe('2026-03-30');
    });

    test('getTimelineIsoDateJst shifts today until timeline start hour passes', async () => {
        expect(getTimelineIsoDateJst('2026-03-29T15:10:00.000Z', 5)).toBe('2026-03-29');
        expect(getTimelineIsoDateJst('2026-03-29T20:10:00.000Z', 5)).toBe('2026-03-30');
    });

    test('getMsUntilNextTimelineBoundary returns remaining time until next timeline day turnover', async () => {
        expect(getMsUntilNextTimelineBoundary('2026-03-29T19:30:00.000Z', 5)).toBe(30 * 60 * 1000);
        expect(getMsUntilNextTimelineBoundary('2026-03-29T20:10:00.000Z', 5)).toBe(23 * 60 * 60 * 1000 + 50 * 60 * 1000);
    });
});

test.describe('timeline-render-model helpers', () => {
    test('buildVisibleDays slices the active window and returns the desktop grid template', async () => {
        const days = [
            { key: '2026-03-19', label: 'Today 03/19 (Thu)', isoDate: '2026-03-19' },
            { key: '2026-03-20', label: '03/20 (Fri)', isoDate: '2026-03-20' },
            { key: '2026-03-21', label: '03/21 (Sat)', isoDate: '2026-03-21' },
        ];

        const result = buildVisibleDays({
            days,
            activeDayIndex: 1,
            dayRange: 2,
        });

        expect(result.visibleDays.map((day) => day.isoDate)).toEqual(['2026-03-20', '2026-03-21']);
        expect(result.dayCount).toBe(2);
        expect(result.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    });

    test('buildDesktopAllDayState returns empty layout when no all-day events are visible', async () => {
        const visibleDays = [
            { key: '2026-03-19', label: 'Today 03/19 (Thu)', isoDate: '2026-03-19' },
            { key: '2026-03-20', label: '03/20 (Fri)', isoDate: '2026-03-20' },
        ];

        const result = buildDesktopAllDayState({
            visibleDays,
            calendarAllDayByDay: {},
            rowHeight: 36,
        });

        expect(result.hasAllDayEvents).toBe(false);
        expect(result.allDayLayout.rows).toBe(0);
        expect(result.allDayLayout.segments).toEqual([]);
        expect(result.allDayMinHeight).toBe(48);
    });

    test('buildMobileTimelineViewState centers a 3-day window around the anchor day', async () => {
        const days = [
            { key: '2026-04-06', label: '04/06 (Mon)', isoDate: '2026-04-06' },
            { key: '2026-04-07', label: 'Today 04/07 (Tue)', isoDate: '2026-04-07' },
            { key: '2026-04-08', label: '04/08 (Wed)', isoDate: '2026-04-08' },
            { key: '2026-04-09', label: '04/09 (Thu)', isoDate: '2026-04-09' },
        ];

        const result = buildMobileTimelineViewState({
            days,
            anchorDayIso: '2026-04-08',
            eventsByDay: {},
            calendarEventsByDay: {},
            calendarAllDayByDay: {},
            abBuckets: {},
            overdue: [],
            indicatorTop: null,
            indicatorDayIso: null,
            activeDragCardId: null,
        });

        expect(result.anchorDayIso).toBe('2026-04-08');
        expect(result.anchorWindowIndex).toBe(1);
        expect(result.windowDayStates.map((state) => state.day.isoDate)).toEqual([
            '2026-04-07',
            '2026-04-08',
            '2026-04-09',
        ]);
    });

    test('buildMobileTimelineViewState right-shifts when the anchor is at the start edge', async () => {
        const days = [
            { key: '2026-04-07', label: 'Today 04/07 (Tue)', isoDate: '2026-04-07' },
            { key: '2026-04-08', label: '04/08 (Wed)', isoDate: '2026-04-08' },
            { key: '2026-04-09', label: '04/09 (Thu)', isoDate: '2026-04-09' },
        ];

        const result = buildMobileTimelineViewState({
            days,
            anchorDayIso: '2026-04-07',
            eventsByDay: {},
            calendarEventsByDay: {},
            calendarAllDayByDay: {},
            abBuckets: {},
            overdue: [],
            indicatorTop: null,
            indicatorDayIso: null,
            activeDragCardId: null,
        });

        expect(result.anchorWindowIndex).toBe(0);
        expect(result.windowDayStates.map((state) => state.day.isoDate)).toEqual([
            '2026-04-07',
            '2026-04-08',
            '2026-04-09',
        ]);
    });
});

test.describe('timeline navigation helpers', () => {
    test('resolveAnchorDayFromPayload snaps to the closest fetched day when the target is missing', async () => {
        const payloadDays = [
            { key: '2026-04-07', label: 'Today 04/07 (Tue)', isoDate: '2026-04-07' },
            { key: '2026-04-08', label: '04/08 (Wed)', isoDate: '2026-04-08' },
            { key: '2026-04-09', label: '04/09 (Thu)', isoDate: '2026-04-09' },
        ];

        const result = resolveAnchorDayFromPayload({
            targetIso: '2026-04-10',
            payloadDays,
            currentTimelineIso: '2026-04-07',
        });

        expect(result.resolvedAnchorDayIso).toBe('2026-04-09');
        expect(result.anchorIndex).toBe(2);
        expect(result.windowStartIndex).toBe(2);
    });

    test('hasPrefetchedNeighborsForDay returns true only when the previous and next day are already loaded', async () => {
        const completeDays = [
            { key: '2026-04-06', label: '04/06 (Mon)', isoDate: '2026-04-06' },
            { key: '2026-04-07', label: 'Today 04/07 (Tue)', isoDate: '2026-04-07' },
            { key: '2026-04-08', label: '04/08 (Wed)', isoDate: '2026-04-08' },
        ];
        const incompleteDays = [
            { key: '2026-04-07', label: 'Today 04/07 (Tue)', isoDate: '2026-04-07' },
            { key: '2026-04-08', label: '04/08 (Wed)', isoDate: '2026-04-08' },
        ];

        expect(hasPrefetchedNeighborsForDay({
            targetIso: '2026-04-07',
            payloadDays: completeDays,
            currentTimelineIso: '2026-04-07',
        })).toBe(true);

        expect(hasPrefetchedNeighborsForDay({
            targetIso: '2026-04-07',
            payloadDays: incompleteDays,
            currentTimelineIso: '2026-04-07',
        })).toBe(false);
    });
});

test.describe('shortcut bar registry helpers', () => {
    test('formatShortcutKeyLabel preserves mac shift symbol', async () => {
        expect(formatShortcutKeyLabel('⇧')).toBe('⇧');
        expect(formatShortcutKeyLabel('Enter')).toBe('Enter');
    });

    test('board sidebar overdue card payload resolves', async () => {
        const payload = resolveShortcutBarPayload({
            scope: 'board',
            region: 'sidebar',
            section: 'overdue',
            part: 'card',
            state: 'active',
        });

        expect(payload).not.toBeNull();
        expect(payload?.contextLabel).toBe('期限超過');
        expect(payload?.items.map((item) => item.id)).toEqual([
            'board-sidebar-card-open-details',
            'board-sidebar-card-toggle-complete',
            'board-sidebar-card-open-menu',
        ]);
    });

    test('board sidebar search card payload resolves', async () => {
        const payload = resolveShortcutBarPayload({
            scope: 'board',
            region: 'sidebar',
            section: 'search',
            part: 'card',
            state: 'active',
        });

        expect(payload?.contextLabel).toBe('検索');
        expect(payload?.items.map((item) => item.id)).toEqual([
            'board-sidebar-card-open-details',
            'board-sidebar-card-toggle-complete',
            'board-sidebar-card-open-menu',
        ]);
    });

    test('board main timeline card payload resolves in priority/display order', async () => {
        const payload = resolveShortcutBarPayload({
            scope: 'board',
            region: 'main-panel',
            view: 'timeline',
            part: 'card',
            legacyContext: 'timeline-card',
            state: 'active',
        });

        expect(payload).not.toBeNull();
        expect(payload?.contextLabel).toBe('タイムライン');
        expect(payload?.items.map((item) => item.id)).toEqual([
            'board-main-timeline-open-details',
            'board-main-timeline-toggle-complete',
            'board-main-timeline-create-next',
            'board-main-timeline-open-menu',
        ]);
    });

    test('board main list card payload resolves', async () => {
        const payload = resolveShortcutBarPayload({
            scope: 'board',
            region: 'main-panel',
            view: 'list',
            part: 'card',
            state: 'active',
        });

        expect(payload?.contextLabel).toBe('リスト');
        expect(payload?.items.map((item) => item.id)).toEqual([
            'board-main-list-open-details',
            'board-main-list-toggle-complete',
        ]);
    });

    test('modal title payload resolves', async () => {
        const payload = resolveShortcutBarPayload({
            scope: 'modal',
            region: 'modal-title',
            part: 'title',
            legacyContext: 'cardmodal-title',
            state: 'active',
        });

        expect(payload?.contextLabel).toBe('カードタイトル');
        expect(payload?.items.map((item) => item.id)).toEqual([
            'modal-title-focus-body-column',
            'modal-title-focus-body-start',
            'modal-title-undo',
            'modal-title-redo',
            'modal-title-close',
        ]);
    });

    test('modal body payload resolves with capability-aware shortcuts', async () => {
        const payload = resolveShortcutBarPayload({
            scope: 'modal',
            region: 'modal-body',
            part: 'editor',
            legacyContext: 'cardmodal-editor',
            capabilities: {
                canUndo: true,
                canRedo: true,
                canIndent: true,
                canOutdent: false,
            },
            state: 'active',
        });

        expect(payload?.contextLabel).toBe('カード本文');
        expect(payload?.items.map((item) => item.id)).toEqual([
            'modal-body-focus-title-column',
            'modal-body-focus-title-end',
            'modal-body-undo',
            'modal-body-redo',
            'modal-body-indent',
            'modal-body-outdent',
            'modal-body-close',
        ]);
        expect(payload?.items.map((item) => item.enabled)).toEqual([
            true,
            true,
            true,
            true,
            true,
            false,
            true,
        ]);
    });

    test('shortcuts modal payload resolves under modal scope', async () => {
        const payload = resolveShortcutBarPayload({
            scope: 'modal',
            region: 'shortcuts-modal',
            state: 'active',
        });

        expect(payload?.contextLabel).toBe('ショートカット一覧');
        expect(payload?.items.map((item) => item.id)).toEqual([
            'shortcuts-modal-close',
        ]);
    });

    test('ambiguous bucket-like descriptors resolve to null until section or view is provided', async () => {
        const sidebarPayload = resolveShortcutBarPayload({
            scope: 'board',
            region: 'sidebar',
            part: 'card',
            state: 'active',
        });
        const mainPanelPayload = resolveShortcutBarPayload({
            scope: 'board',
            region: 'main-panel',
            part: 'card',
            state: 'active',
        });

        expect(sidebarPayload).toBeNull();
        expect(mainPanelPayload).toBeNull();
    });

    test('readonly payload resolves to null', async () => {
        const payload = resolveShortcutBarPayload({
            scope: 'modal',
            region: 'modal-body',
            part: 'editor',
            legacyContext: 'cardmodal-editor',
            state: 'readonly',
        });

        expect(payload).toBeNull();
    });

    test('sliceShortcutItems returns visible items and overflow count', async () => {
        const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const result = sliceShortcutItems(input, 5);

        expect(result.visibleItems).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(result.overflowCount).toBe(2);
    });
});
