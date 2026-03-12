import { test, expect } from '@playwright/test';
import { calculateStackedEventLayout, NormalizedTimelineLayoutItem } from '../app/(board)/_utils/timeline-helpers';

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
