import { test, expect, type Locator, type Page } from '@playwright/test';
import { parseMarkdownToTiptapContent, serializeTiptapContentToMarkdown } from '@/lib/tiptap';
import type { JSONContent } from '@tiptap/react';
import {
  ensureBoardFixtures,
  isoDateJst,
  resolveTestUserId,
  shiftIsoDateJst,
  supabaseAdmin,
  supportsDueColumns,
  type TimelineBoardContext,
} from './helpers/timeline-fixtures';
import {
  pasteHtmlImageFromDataUrl,
  pasteHtmlWithPlainText,
  pasteImageBySize,
  pasteImageFromBytes,
  pastePlainText,
} from './helpers/timeline-editor';

async function dispatchCopyEvent(page: Page): Promise<{ plainText: string; htmlText: string; defaultPrevented: boolean }> {
  return page.evaluate(() => {
    const target = document.querySelector('.ProseMirror[data-autofocus="true"]');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Missing ProseMirror root for copy');
    }

    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);

    return {
      plainText: data.getData('text/plain'),
      htmlText: data.getData('text/html'),
      defaultPrevented: event.defaultPrevented,
    };
  });
}

type BlockMenuAction =
  | 'move-up'
  | 'move-down'
  | 'insert-above'
  | 'insert-below'
  | 'duplicate'
  | 'delete'
  | 'toggle-details'
  | 'unset-details';

async function openBlockActionMenu(
  page: Page,
  modal: Locator,
  handle: Locator,
  initialFocusAction?: BlockMenuAction,
): Promise<void> {
  await expect(handle).toBeVisible();
  await handle.click();
  const menu = modal.getByTestId('tiptap-block-menu');
  await expect(menu).toBeVisible();
  if (initialFocusAction) {
    const initialItem = modal.getByTestId(`tiptap-block-menu-${initialFocusAction}`);
    await expect(initialItem).toBeFocused();
  }
  await page.waitForTimeout(50);
}

async function triggerBlockAction(
  page: Page,
  modal: Locator,
  handle: Locator,
  action: BlockMenuAction,
  initialFocusAction?: BlockMenuAction,
): Promise<void> {
  await openBlockActionMenu(page, modal, handle, initialFocusAction);
  await modal.getByTestId(`tiptap-block-menu-${action}`).click();
  await expect(modal.getByTestId('tiptap-block-menu')).toHaveCount(0);
}

async function clearLastBlockAction(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as typeof window & {
      __TAESK_LAST_BLOCK_ACTION__?: unknown;
    }).__TAESK_LAST_BLOCK_ACTION__;
  });
}

async function fetchSavedCard(cardId: string): Promise<{ content: unknown; excerpt: string | null; title: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('cards')
    .select('content, excerpt, title')
    .eq('id', cardId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch saved card ${cardId}: ${error.message}`);
  }

  return data ? { content: data.content, excerpt: data.excerpt ?? null, title: data.title ?? null } : null;
}

async function readLastBlockAction(page: Page): Promise<{
  action: string;
  menuTargetPos: number;
  menuTargetNodeType: string;
  resolvedTargetPos: number | null;
  resolvedNodeType: string | null;
} | null> {
  return page.evaluate(() => {
    return (window as typeof window & {
      __TAESK_LAST_BLOCK_ACTION__?: {
        action: string;
        menuTargetPos: number;
        menuTargetNodeType: string;
        resolvedTargetPos: number | null;
        resolvedNodeType: string | null;
      };
    }).__TAESK_LAST_BLOCK_ACTION__ ?? null;
  });
}

async function dragLocatorToPoint(
  page: Page,
  locator: Locator,
  target: { x: number; y: number }
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Failed to resolve draggable locator bounds');
  }

  const sourceX = box.x + Math.min(Math.max(box.width * 0.5, 24), box.width - 12);
  const sourceY = box.y + Math.min(Math.max(box.height * 0.35, 18), box.height - 12);

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 24, sourceY + 12, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 16 });
}

function collectStoragePathsFromContent(content: unknown): string[] {
  const result = new Set<string>();

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as {
      type?: unknown;
      attrs?: { storagePath?: unknown };
      content?: unknown[];
    };

    if (record.type === 'image' && typeof record.attrs?.storagePath === 'string') {
      result.add(record.attrs.storagePath);
    }

    if (Array.isArray(record.content)) {
      record.content.forEach((child) => visit(child));
    }
  };

  visit(content);
  return [...result];
}

let dueColumnsAvailable = true;
let boardContext: TimelineBoardContext | null = null;
let testUserId: string | null = null;

test.describe('Markdown serializer helpers', () => {
  test('serializes mixed content to markdown', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Heading' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fourth' }] }],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Done' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'details',
          attrs: { open: true },
          content: [
            {
              type: 'detailsSummary',
              content: [{ type: 'text', text: 'Summary' }],
            },
            {
              type: 'detailsContent',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Hidden body' }],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'u1', name: 'alice' } }],
        },
        {
          type: 'image',
          attrs: { alt: 'img', src: 'https://example.com/image.png' },
        },
      ],
    };

    expect(serializeTiptapContentToMarkdown(content)).toBe(
      [
        '## Heading',
        '',
        '**Bold** and [link](https://example.com)',
        '',
        '3. Third',
        '4. Fourth',
        '',
        '- [x] Done',
        '  - Nested',
        '',
        ':::details',
        'Summary',
        '',
        'Hidden body',
        ':::',
        '',
        '@alice',
        '',
        '![img](https://example.com/image.png)',
      ].join('\n')
    );
  });

  test('suppresses block prefixes for partial textblock selections', async () => {
    const content: JSONContent = {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Partial heading' }],
    };

    expect(serializeTiptapContentToMarkdown(content, { suppressBlockFormatting: true })).toBe('Partial heading');
  });

  test('omits empty details summary wrapper', async () => {
    const content: JSONContent = {
      type: 'details',
      content: [
        {
          type: 'detailsSummary',
          content: [],
        },
        {
          type: 'detailsContent',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Body only' }],
            },
          ],
        },
      ],
    };

    expect(serializeTiptapContentToMarkdown(content)).toBe('Body only');
  });

  test('parses markdown v2 structures into tiptap content', async () => {
    const parsed = parseMarkdownToTiptapContent(
      [
        '## Heading',
        '',
        '- [x] Done',
        '- [ ] Todo',
        '',
        ':::details',
        'Summary',
        '',
        'Body line 1',
        '',
        'Body line 2',
        ':::',
      ].join('\n')
    );

    expect(parsed).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Heading' }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Todo' }] }],
            },
          ],
        },
        {
          type: 'details',
          attrs: { open: true },
          content: [
            {
              type: 'detailsSummary',
              content: [{ type: 'text', text: 'Summary' }],
            },
            {
              type: 'detailsContent',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Body line 1' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Body line 2' }] },
              ],
            },
          ],
        },
      ],
    });
  });

  test('falls back for ambiguous details compat text', async () => {
    expect(parseMarkdownToTiptapContent('Summary\n\n- [x] Body')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Summary' }] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
            },
          ],
        },
      ],
    });
    expect(parseMarkdownToTiptapContent(':::details\n\nBody\n:::')).toBeNull();
  });

  test('keeps blank-line plain text out of markdown parsing', async () => {
    expect(
      parseMarkdownToTiptapContent(
        [
          'Article',
          '',
          'See new posts',
          'Conversation',
          '内向哲学',
          '@naikoutetsugaku',
          '本を読む人と読まない人では、圧倒的な思考格差が生まれる',
        ].join('\n')
      )
    ).toBeNull();
  });
});

test.describe('@feature:timeline Timeline view', () => {
  test.beforeAll(async () => {
    testUserId = await resolveTestUserId();
    boardContext = await ensureBoardFixtures(testUserId);
    dueColumnsAvailable = await supportsDueColumns();
    if (!dueColumnsAvailable) {
      console.warn('Skipping timeline spec: cards table missing due_* columns. Run supabase/migrations/20251113090000_add_due_fields.sql');
    }
  });

  test.afterAll(async () => {
    if (boardContext?.boardId) {
      await supabaseAdmin.from('boards').delete().eq('id', boardContext.boardId);
    }
    boardContext = null;
  });

  test('renders timeline events and emits metrics', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }
    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Timeline focus card',
      checklist: { version: 1, lines: [] },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1500,
      tags: [],
      due_date: isoDay,
      due_start: '09:00:00',
      due_end: '10:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 501,
      slug: 'timeline-focus-card',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      const focusEvent = page.getByTestId('timeline-event').filter({ hasText: 'Timeline focus card' }).first();
      await expect(focusEvent).toBeVisible({ timeout: 20_000 });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('keeps fixed columns for 3-way overlaps and preserves overlap modes on desktop and mobile', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const cards = [
      {
        id: crypto.randomUUID(),
        title: 'Overlap split 1',
        checklist: { version: 1, lines: [] },
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1510,
        tags: [],
        due_date: isoDay,
        due_start: '17:00:00',
        due_end: '19:00:00',
        due_bucket: null,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 510,
        slug: 'overlap-split-1',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: crypto.randomUUID(),
        title: 'Overlap split 2',
        checklist: { version: 1, lines: [] },
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1520,
        tags: [],
        due_date: isoDay,
        due_start: '17:00:00',
        due_end: '18:00:00',
        due_bucket: null,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 511,
        slug: 'overlap-split-2',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: crypto.randomUUID(),
        title: 'Overlap split 3',
        checklist: { version: 1, lines: [] },
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1530,
        tags: [],
        due_date: isoDay,
        due_start: '17:00:00',
        due_end: '18:00:00',
        due_bucket: null,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 512,
        slug: 'overlap-split-3',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: crypto.randomUUID(),
        title: 'Overlap widen 1',
        checklist: { version: 1, lines: [] },
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1535,
        tags: [],
        due_date: isoDay,
        due_start: '18:10:00',
        due_end: '18:50:00',
        due_bucket: null,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 5125,
        slug: 'overlap-widen-1',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: crypto.randomUUID(),
        title: 'Overlap half 1',
        checklist: { version: 1, lines: [] },
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1540,
        tags: [],
        due_date: isoDay,
        due_start: '19:00:00',
        due_end: '20:00:00',
        due_bucket: null,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 513,
        slug: 'overlap-half-1',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: crypto.randomUUID(),
        title: 'Overlap half 2',
        checklist: { version: 1, lines: [] },
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1550,
        tags: [],
        due_date: isoDay,
        due_start: '19:25:00',
        due_end: '20:10:00',
        due_bucket: null,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 514,
        slug: 'overlap-half-2',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: crypto.randomUUID(),
        title: 'Overlap light 1',
        checklist: { version: 1, lines: [] },
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1560,
        tags: [],
        due_date: isoDay,
        due_start: '20:30:00',
        due_end: '21:30:00',
        due_bucket: null,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 515,
        slug: 'overlap-light-1',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: crypto.randomUUID(),
        title: 'Overlap light 2',
        checklist: { version: 1, lines: [] },
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1570,
        tags: [],
        due_date: isoDay,
        due_start: '21:10:00',
        due_end: '22:10:00',
        due_bucket: null,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 516,
        slug: 'overlap-light-2',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];

    const { error: insertError } = await supabaseAdmin.from('cards').insert(cards);

    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const split1 = page.getByTestId('timeline-event').filter({ hasText: 'Overlap split 1' }).first();
      const split2 = page.getByTestId('timeline-event').filter({ hasText: 'Overlap split 2' }).first();
      const split3 = page.getByTestId('timeline-event').filter({ hasText: 'Overlap split 3' }).first();
      const widen1 = page.getByTestId('timeline-event').filter({ hasText: 'Overlap widen 1' }).first();
      const half2 = page.getByTestId('timeline-event').filter({ hasText: 'Overlap half 2' }).first();
      const light2 = page.getByTestId('timeline-event').filter({ hasText: 'Overlap light 2' }).first();
      await expect(split1).toBeVisible({ timeout: 20_000 });
      await expect(split2).toBeVisible({ timeout: 20_000 });
      await expect(split3).toBeVisible({ timeout: 20_000 });
      await expect(widen1).toBeVisible({ timeout: 20_000 });
      await expect(half2).toBeVisible({ timeout: 20_000 });
      await expect(light2).toBeVisible({ timeout: 20_000 });

      const desktopMetrics = await Promise.all([
        split1.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
            zIndex: host ? window.getComputedStyle(host).zIndex : '',
          };
        }),
        split2.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
            zIndex: host ? window.getComputedStyle(host).zIndex : '',
          };
        }),
        split3.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
          };
        }),
        widen1.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
            columnSpan: host?.dataset.columnSpan ?? '',
            clusterColumns: host?.dataset.clusterColumns ?? '',
          };
        }),
        half2.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
          };
        }),
        light2.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
          };
        }),
      ]);

      expect(desktopMetrics[0]?.mode).toBe('split');
      expect(desktopMetrics[1]?.mode).toBe('split');
      expect(desktopMetrics[2]?.mode).toBe('split');
      expect(desktopMetrics[3]?.mode).toBe('light-overlap');
      expect(desktopMetrics[4]?.mode).toBe('half-overlap');
      expect(desktopMetrics[5]?.mode).toBe('light-overlap');

      const splitLeftsDesktop = desktopMetrics.slice(0, 3).map((metric) => Number.parseFloat(metric.left));
      const splitWidthsDesktop = desktopMetrics.slice(0, 3).map((metric) => Number.parseFloat(metric.width));
      const sortedSplitLeftsDesktop = [...splitLeftsDesktop].sort((a, b) => a - b);

      expect(sortedSplitLeftsDesktop[0]).toBeGreaterThanOrEqual(0);
      expect(sortedSplitLeftsDesktop[1]).toBeGreaterThan(20);
      expect(sortedSplitLeftsDesktop[2]).toBeGreaterThan(50);
      splitWidthsDesktop.forEach((width) => {
        expect(width).toBeGreaterThan(25);
        expect(width).toBeLessThan(35);
      });

      const desktopWidenWidth = Number.parseFloat(desktopMetrics[3]?.width ?? '0');
      const desktopWidenLeft = Number.parseFloat(desktopMetrics[3]?.left ?? '0');
      expect(desktopMetrics[3]?.columnSpan).toBe('2');
      expect(desktopMetrics[3]?.clusterColumns).toBe('3');
      expect(desktopWidenLeft).toBeGreaterThan(20);
      expect(desktopWidenLeft).toBeLessThan(28);
      expect(desktopWidenWidth).toBeGreaterThan(70);

      const desktopHalfLeft = Number.parseFloat(desktopMetrics[4]?.left ?? '0');
      const desktopLightLeft = Number.parseFloat(desktopMetrics[5]?.left ?? '0');
      expect(desktopHalfLeft).toBeGreaterThan(20);
      expect(desktopHalfLeft).toBeLessThan(30);
      expect(desktopLightLeft).toBeGreaterThan(30);
      expect(desktopLightLeft).toBeLessThan(40);

      // Verify time text visibility for overlaps on desktop
      // split mode should show time
      await expect(split1).toContainText(/(\d{2}:\d{2})/);
      // half-overlap and light-overlap slotIndex > 0 should hide time
      // The text inside TimelineCard is roughly "Timeline focus card" etc.
      // detailedTimeLabel returns like "17:00 - 18:00[1h]"
      await expect(half2).not.toContainText(/\d{2}:\d{2} - \d{2}:\d{2}\[\d+h( \d+m)?\]/);
      await expect(light2).not.toContainText(/\d{2}:\d{2} - \d{2}:\d{2}\[\d+h( \d+m)?\]/);

      await split1.click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 500 });

      const split1AfterFocus = await split1.evaluate((el) => {
        const host = el.parentElement as HTMLElement | null;
        return host ? window.getComputedStyle(host).zIndex : '';
      });
      const split2AfterFocus = await split2.evaluate((el) => {
        const host = el.parentElement as HTMLElement | null;
        return host ? window.getComputedStyle(host).zIndex : '';
      });

      expect(Number(split1AfterFocus)).toBeGreaterThan(Number(split2AfterFocus));

      await split1.click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(boardContext.canonicalPath);

      const mobileSplit1 = page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: 'Overlap split 1' }).first();
      const mobileSplit2 = page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: 'Overlap split 2' }).first();
      const mobileSplit3 = page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: 'Overlap split 3' }).first();
      const mobileWiden1 = page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: 'Overlap widen 1' }).first();
      const mobileHalf2 = page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: 'Overlap half 2' }).first();
      const mobileLight2 = page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: 'Overlap light 2' }).first();
      await expect(mobileSplit1).toBeVisible({ timeout: 20_000 });
      await expect(mobileSplit2).toBeVisible({ timeout: 20_000 });
      await expect(mobileSplit3).toBeVisible({ timeout: 20_000 });
      await expect(mobileWiden1).toBeVisible({ timeout: 20_000 });
      await expect(mobileHalf2).toBeVisible({ timeout: 20_000 });
      await expect(mobileLight2).toBeVisible({ timeout: 20_000 });

      const mobileMetrics = await Promise.all([
        mobileSplit1.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
          };
        }),
        mobileSplit2.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
          };
        }),
        mobileSplit3.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
          };
        }),
        mobileWiden1.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
            columnSpan: host?.dataset.columnSpan ?? '',
            clusterColumns: host?.dataset.clusterColumns ?? '',
          };
        }),
        mobileHalf2.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
          };
        }),
        mobileLight2.evaluate((el) => {
          const host = el.parentElement as HTMLElement | null;
          return {
            mode: host?.dataset.stackMode ?? '',
            left: host?.style.left ?? '',
            width: host?.style.width ?? '',
          };
        }),
      ]);

      expect(mobileMetrics[0]?.mode).toBe('split');
      expect(mobileMetrics[1]?.mode).toBe('split');
      expect(mobileMetrics[2]?.mode).toBe('split');
      expect(mobileMetrics[3]?.mode).toBe('light-overlap');
      expect(mobileMetrics[4]?.mode).toBe('half-overlap');
      expect(mobileMetrics[5]?.mode).toBe('light-overlap');

      const splitLeftsMobile = mobileMetrics.slice(0, 3).map((metric) => Number.parseFloat(metric.left));
      const splitWidthsMobile = mobileMetrics.slice(0, 3).map((metric) => Number.parseFloat(metric.width));
      const sortedSplitLeftsMobile = [...splitLeftsMobile].sort((a, b) => a - b);

      expect(sortedSplitLeftsMobile[0]).toBeGreaterThanOrEqual(0);
      expect(sortedSplitLeftsMobile[1]).toBeGreaterThan(20);
      expect(sortedSplitLeftsMobile[2]).toBeGreaterThan(50);
      splitWidthsMobile.forEach((width) => {
        expect(width).toBeGreaterThan(25);
        expect(width).toBeLessThan(35);
      });

      const mobileWidenWidth = Number.parseFloat(mobileMetrics[3]?.width ?? '0');
      const mobileWidenLeft = Number.parseFloat(mobileMetrics[3]?.left ?? '0');
      expect(mobileMetrics[3]?.columnSpan).toBe('2');
      expect(mobileMetrics[3]?.clusterColumns).toBe('3');
      expect(mobileWidenLeft).toBeGreaterThan(25);
      expect(mobileWidenLeft).toBeLessThan(35);
      expect(mobileWidenWidth).toBeGreaterThan(70);

      const mobileHalfLeft = Number.parseFloat(mobileMetrics[4]?.left ?? '0');
      const mobileLightLeft = Number.parseFloat(mobileMetrics[5]?.left ?? '0');
      expect(mobileHalfLeft).toBeGreaterThan(30);
      expect(mobileHalfLeft).toBeLessThan(35);
      expect(mobileLightLeft).toBeGreaterThan(40);
      expect(mobileLightLeft).toBeLessThan(45);

      // Verify time text visibility for overlaps on mobile
      await expect(mobileSplit1).toContainText(/(\d{2}:\d{2})/);
      await expect(mobileHalf2).not.toContainText(/\d{2}:\d{2} - \d{2}:\d{2}\[\d+h( \d+m)?\]/);
      // await expect(mobileLight2).not.toContainText(/\d{2}:\d{2} - \d{2}:\d{2}\[\d+h( \d+m)?\]/);
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', cards.map((card) => card.id));
    }
  });

  test('can create a date-only card from A/B list by click', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }

    await page.goto(boardContext.canonicalPath);
    await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

    const createResponsePromise = page.waitForResponse((res) => {
      const url = res.url();
      return (
        res.request().method() === 'POST' &&
        url.includes(`/api/boards/${boardContext.boardId}/cards`)
      );
    }, { timeout: 20_000 });

    const [response] = await Promise.all([
      createResponsePromise,
      page.locator('[data-testid^="ab-add-"]').first().click(),
    ]);
    expect(response.ok(), `create card API failed: ${response.status()}`).toBeTruthy();
    const body = await response.json().catch(() => null);
    const createdCardId = body?.card?.id as string | undefined;

    if (createdCardId) {
      await expect(page.getByTestId(`ab-card-${createdCardId}`).first()).toBeVisible();
    } else {
      await expect(page.locator('[data-testid^="ab-card-"]').first()).toBeVisible();
    }

    if (createdCardId) {
      await supabaseAdmin.from('cards').delete().eq('id', createdCardId);
    }
  });

  test('shows A/B and overdue previews up to 3 lines without fixed card height', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const todayIso = isoDateJst();
    const yesterdayIso = shiftIsoDateJst(-1);
    const abCardId = crypto.randomUUID();
    const overdueCardId = crypto.randomUUID();
    const abShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const overdueShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const baseIdShort = Math.floor(Math.random() * 100000) + 600;

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      {
        id: abCardId,
        title: 'A/B preview height card',
        checklist: { version: 1, lines: [] },
        excerpt: 'line 1\nline 2\nline 3\nline 4',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1600,
        tags: [],
        due_date: todayIso,
        due_start: null,
        due_end: null,
        due_bucket: 'a',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: abShortId,
        id_short: baseIdShort,
        slug: 'ab-preview-height-card',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: overdueCardId,
        title: 'Overdue preview height card',
        checklist: { version: 1, lines: [] },
        excerpt: 'line 1\nline 2\nline 3\nline 4',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1650,
        tags: [],
        due_date: yesterdayIso,
        due_start: null,
        due_end: null,
        due_bucket: 'b',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: overdueShortId,
        id_short: baseIdShort + 1,
        slug: 'overdue-preview-height-card',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);

    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const abCard = page.getByTestId(`ab-card-${abCardId}`).first();
      const overdueCard = page.locator(`[data-testid="overdue-card-${overdueCardId}"]:visible`).first();
      await expect(abCard).toBeVisible({ timeout: 20_000 });
      await expect(overdueCard).toBeVisible({ timeout: 20_000 });

      await expect(abCard.locator('.line-clamp-3').first()).toBeVisible();
      await expect(overdueCard.locator('.line-clamp-3').first()).toBeVisible();

    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [abCardId, overdueCardId]);
    }
  });

  test('shows desktop menu accordions and lists search matches in the sidebar', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const todayIso = isoDateJst();
    const yesterdayIso = shiftIsoDateJst(-1);
    const tomorrowIso = shiftIsoDateJst(1);
    const overdueCardId = crypto.randomUUID();
    const bucketCardId = crypto.randomUUID();
    const overdueShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const bucketShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      {
        id: overdueCardId,
        title: 'Sidebar Search Overdue',
        checklist: { version: 1, lines: [] },
        excerpt: 'desktop menu overdue search target',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1800,
        tags: [],
        due_date: yesterdayIso,
        due_start: null,
        due_end: null,
        due_bucket: 'b',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: overdueShortId,
        id_short: Math.floor(Math.random() * 100000) + 910,
        slug: 'sidebar-search-overdue',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: bucketCardId,
        title: 'Sidebar Search Bucket',
        checklist: { version: 1, lines: [] },
        excerpt: 'desktop menu bucket search target',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1900,
        tags: [],
        due_date: tomorrowIso || todayIso,
        due_start: null,
        due_end: null,
        due_bucket: 'a',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: bucketShortId,
        id_short: Math.floor(Math.random() * 100000) + 920,
        slug: 'sidebar-search-bucket',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const overdueToggle = page.getByTestId('desktop-sidebar-overdue-panel-toggle');
      const overduePanel = page.getByTestId('desktop-sidebar-overdue-panel');
      const overdueCount = page.getByTestId('desktop-sidebar-overdue-panel-count');
      const searchToggle = page.getByTestId('desktop-sidebar-search-panel-toggle');

      await expect(overdueToggle).toBeVisible();
      await expect(overdueCount).toHaveText('1');
      await expect(overduePanel).toBeVisible();
      await expect(page.locator(`[data-testid="overdue-card-${overdueCardId}"]:visible`).first()).toBeVisible();

      await overdueToggle.click();
      await expect(overduePanel).toBeHidden();
      await overdueToggle.click();
      await expect(overduePanel).toBeVisible();

      const searchPanel = page.getByTestId('desktop-sidebar-search-panel');
      const searchCount = page.getByTestId('desktop-sidebar-search-panel-count');
      const searchInput = page.getByTestId('desktop-sidebar-search-input');

      await expect(searchPanel).toBeHidden();
      await expect(searchCount).toHaveText('0');

      await searchToggle.click();
      await expect(searchPanel).toBeVisible();
      await expect(searchInput).toBeVisible();
      await expect(overduePanel).toBeHidden();

      await searchInput.fill('Sidebar Search');

      await expect(searchCount).toHaveText('2');
      await expect(overdueCount).toHaveText('1');
      await expect(page.locator(`[data-testid="search-card-overdue-${overdueCardId}"]:visible`).first()).toBeVisible();
      await expect(page.locator(`[data-testid="search-card-bucket-${bucketCardId}"]:visible`).first()).toBeVisible();

      await overdueToggle.click();
      await expect(overduePanel).toBeVisible();
      await expect(overdueCount).toHaveText('1');
      await expect(searchPanel).toBeHidden();
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [overdueCardId, bucketCardId]);
    }
  });

  test('toggles overdue sort order in the desktop sidebar', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const olderOverdueCardId = crypto.randomUUID();
    const newerOverdueCardId = crypto.randomUUID();
    const olderShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const newerShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      {
        id: olderOverdueCardId,
        title: 'Desktop overdue oldest',
        checklist: { version: 1, lines: [] },
        excerpt: 'desktop overdue oldest card',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1810,
        tags: [],
        due_date: shiftIsoDateJst(-3),
        due_start: null,
        due_end: null,
        due_bucket: 'a',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: olderShortId,
        id_short: Math.floor(Math.random() * 100000) + 930,
        slug: 'desktop-overdue-oldest',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: newerOverdueCardId,
        title: 'Desktop overdue newest',
        checklist: { version: 1, lines: [] },
        excerpt: 'desktop overdue newest card',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1820,
        tags: [],
        due_date: shiftIsoDateJst(-1),
        due_start: null,
        due_end: null,
        due_bucket: 'b',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: newerShortId,
        id_short: Math.floor(Math.random() * 100000) + 940,
        slug: 'desktop-overdue-newest',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const overdueCards = page.locator('[data-testid^="overdue-card-"]:visible');
      const sortToggle = page.getByTestId('desktop-sidebar-overdue-sort-toggle');

      await expect(overdueCards).toHaveCount(2);
      await expect(sortToggle).toHaveAttribute('data-order', 'newest');
      await expect(overdueCards.nth(0)).toContainText('Desktop overdue newest');
      await expect(overdueCards.nth(1)).toContainText('Desktop overdue oldest');

      await sortToggle.click();

      await expect(sortToggle).toHaveAttribute('data-order', 'oldest');
      await expect(overdueCards.nth(0)).toContainText('Desktop overdue oldest');
      await expect(overdueCards.nth(1)).toContainText('Desktop overdue newest');
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [olderOverdueCardId, newerOverdueCardId]);
    }
  });

  test('collapses overdue into a mobile sheet and keeps overdue drag working', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const todayIso = isoDateJst();
    const yesterdayIso = shiftIsoDateJst(-1);
    const overdueCardId = crypto.randomUUID();
    const overdueShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const idShort = Math.floor(Math.random() * 100000) + 900;

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: overdueCardId,
      title: 'Mobile overdue drag card',
      checklist: { version: 1, lines: [] },
      excerpt: 'mobile overdue card for drag regression',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1750,
      tags: [],
      due_date: yesterdayIso,
      due_start: null,
      due_end: null,
      due_bucket: 'b',
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: overdueShortId,
      id_short: idShort,
      slug: 'mobile-overdue-drag-card',
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const overdueToggle = page.getByTestId('mobile-overdue-toggle');
      const overdueSheet = page.getByTestId('mobile-overdue-sheet');
      const overdueCount = page.getByTestId('mobile-overdue-count');

      await expect(overdueToggle).toBeVisible();
      await expect(overdueCount).toHaveText('1');
      await expect(overdueToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(overdueSheet).toHaveAttribute('aria-hidden', 'true');

      await overdueToggle.click();
      await expect(overdueToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(overdueSheet).toHaveAttribute('aria-hidden', 'false');

      const overdueCard = page.locator(`[data-testid="overdue-card-${overdueCardId}"]:visible`).first();
      await expect(overdueCard).toBeVisible();

      const overdueBox = await overdueCard.boundingBox();
      if (!overdueBox) {
        throw new Error('Missing overdue card bounds');
      }

      await dragLocatorToPoint(page, overdueCard, {
        x: overdueBox.x + overdueBox.width - 10,
        y: overdueBox.y + Math.max(18, overdueBox.height * 0.5),
      });
      const overdueOverlay = page.locator(
        '[data-testid="timeline-drag-overlay-mobile"][data-overlay-kind="overdue"]'
      );
      await expect(overdueOverlay).toBeVisible();
      await page.mouse.up();
      await expect(overdueOverlay).toHaveCount(0);
      await expect(overdueCard).toBeVisible();

      const timelineGrid = page.locator('[data-testid="timeline-grid"]:visible').first();
      const timelineBox = await timelineGrid.boundingBox();
      if (!timelineBox) {
        throw new Error('Missing mobile timeline grid bounds');
      }

      const patchResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'PATCH' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${overdueCardId}`)
        );
      }, { timeout: 20_000 });

      await dragLocatorToPoint(page, overdueCard, {
        x: timelineBox.x + timelineBox.width * 0.25,
        y: timelineBox.y + 220,
      });
      await expect(page.locator('[data-testid="timeline-drag-overlay-mobile"][data-overlay-kind="overdue"]')).toBeVisible();
      const [patchResponse] = await Promise.all([
        patchResponsePromise,
        page.mouse.up(),
      ]);
      expect(patchResponse.ok(), `mobile overdue PATCH failed: ${patchResponse.status()}`).toBeTruthy();

      await expect.poll(async () => {
        const { data, error } = await supabaseAdmin
          .from('cards')
          .select('due_date,due_start,due_end')
          .eq('id', overdueCardId)
          .maybeSingle();
        if (error) return `error:${error.message}`;
        if (!data?.due_start || !data?.due_end) return 'pending';
        return `${data.due_date}|${data.due_start}|${data.due_end}`;
      }, { timeout: 20_000 }).not.toBe('pending');

      await expect.poll(async () => {
        const { data } = await supabaseAdmin
          .from('cards')
          .select('due_date,due_start,due_end')
          .eq('id', overdueCardId)
          .maybeSingle();
        if (typeof data?.due_date !== 'string') return false;
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(data.due_date)) === todayIso;
      }, { timeout: 20_000 }).toBe(true);

      await expect(page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: 'Mobile overdue drag card' }).first()).toBeVisible();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', overdueCardId);
    }
  });

  test('toggles overdue sort order in the mobile overdue sheet', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const olderOverdueCardId = crypto.randomUUID();
    const newerOverdueCardId = crypto.randomUUID();
    const olderShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const newerShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      {
        id: olderOverdueCardId,
        title: 'Mobile overdue oldest',
        checklist: { version: 1, lines: [] },
        excerpt: 'mobile overdue oldest card',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1830,
        tags: [],
        due_date: shiftIsoDateJst(-4),
        due_start: null,
        due_end: null,
        due_bucket: 'a',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: olderShortId,
        id_short: Math.floor(Math.random() * 100000) + 950,
        slug: 'mobile-overdue-oldest',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: newerOverdueCardId,
        title: 'Mobile overdue newest',
        checklist: { version: 1, lines: [] },
        excerpt: 'mobile overdue newest card',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1840,
        tags: [],
        due_date: shiftIsoDateJst(-1),
        due_start: null,
        due_end: null,
        due_bucket: 'b',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: newerShortId,
        id_short: Math.floor(Math.random() * 100000) + 960,
        slug: 'mobile-overdue-newest',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const overdueToggle = page.getByTestId('mobile-overdue-toggle');
      const sortToggle = page.getByTestId('mobile-overdue-sort-toggle');
      const overdueCards = page.locator('[data-testid^="overdue-card-"]:visible');

      await overdueToggle.click();

      await expect(overdueCards).toHaveCount(2);
      await expect(sortToggle).toHaveAttribute('data-order', 'newest');
      await expect(overdueCards.nth(0)).toContainText('Mobile overdue newest');
      await expect(overdueCards.nth(1)).toContainText('Mobile overdue oldest');

      await sortToggle.click();

      await expect(sortToggle).toHaveAttribute('data-order', 'oldest');
      await expect(overdueCards.nth(0)).toContainText('Mobile overdue oldest');
      await expect(overdueCards.nth(1)).toContainText('Mobile overdue newest');
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [olderOverdueCardId, newerOverdueCardId]);
    }
  });

  test('copies selected body content as markdown while preserving html payload', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Copy Heading' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Body ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 2 },
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second item' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third item' }] }],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Checklist done' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested child' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'details',
          content: [
            {
              type: 'detailsSummary',
              content: [{ type: 'text', text: 'Detail summary' }],
            },
            {
              type: 'detailsContent',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Hidden copy body' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Markdown copy baseline',
      checklist: { version: 1, lines: [] },
      content,
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1510,
      tags: [],
      due_date: isoDay,
      due_start: '09:30:00',
      due_end: '10:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5011,
      slug: 'markdown-copy-baseline',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();

      await bodyEditor.click();
      const selectAllModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${selectAllModifier}+A`);

      const payload = await dispatchCopyEvent(page);
      expect(payload.defaultPrevented).toBeTruthy();
      expect(payload.htmlText.length).toBeGreaterThan(0);
      expect(payload.plainText).toBe(
        [
          '## Copy Heading',
          '',
          'Body **bold**',
          '',
          '2. Second item',
          '3. Third item',
          '',
          '- [x] Checklist done',
          '  - Nested child',
          '',
          ':::details',
          'Detail summary',
          '',
          'Hidden copy body',
          ':::',
        ].join('\n')
      );
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('captures markdown copy on user shortcut and skips title input copies', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Shortcut copy title',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Shortcut heading' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Shortcut body text' }],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1515,
      tags: [],
      due_date: isoDay,
      due_start: '10:30:00',
      due_end: '11:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5012,
      slug: 'markdown-copy-shortcut',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      const copyModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

      await page.evaluate(() => {
        (window as Window & { __taeskCopyPayload?: { plainText: string; htmlText: string; targetTag: string | null } | null }).__taeskCopyPayload = null;
        const handler = (event: ClipboardEvent) => {
          const clipboardData = event.clipboardData;
          (window as Window & { __taeskCopyPayload?: { plainText: string; htmlText: string; targetTag: string | null } | null }).__taeskCopyPayload = {
            plainText: clipboardData?.getData('text/plain') ?? '',
            htmlText: clipboardData?.getData('text/html') ?? '',
            targetTag: event.target instanceof HTMLElement ? event.target.tagName : null,
          };
        };
        document.addEventListener('copy', handler, { capture: true, once: true });
      });

      await bodyEditor.click();
      await page.keyboard.press(`${copyModifier}+A`);
      await page.keyboard.press(`${copyModifier}+C`);

      const bodyPayload = await page.evaluate(() => {
        return (window as Window & { __taeskCopyPayload?: { plainText: string; htmlText: string; targetTag: string | null } | null }).__taeskCopyPayload;
      });

      expect(bodyPayload?.plainText).toBe('## Shortcut heading\n\nShortcut body text');
      expect(bodyPayload?.htmlText?.length ?? 0).toBeGreaterThan(0);

      await titleInput.click();
      await page.evaluate(() => {
        const input = document.querySelector('[data-sticky-title] textarea');
        if (!(input instanceof HTMLTextAreaElement)) {
          throw new Error('Missing title input');
        }
        input.setSelectionRange(0, input.value.length);
      });

      const titlePayload = await page.evaluate(() => {
        const input = document.querySelector('[data-sticky-title] textarea');
        if (!(input instanceof HTMLTextAreaElement)) {
          throw new Error('Missing title input');
        }
        const data = new DataTransfer();
        const event = new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        });
        input.dispatchEvent(event);
        return {
          plainText: data.getData('text/plain'),
          htmlText: data.getData('text/html'),
          defaultPrevented: event.defaultPrevented,
        };
      });

      expect(titlePayload.plainText).toBe('');
      expect(titlePayload.htmlText).toBe('');
      expect(titlePayload.defaultPrevented).toBeFalsy();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('keeps raw title text when multiline markdown-like text is inserted into title row', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Paste baseline',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body stays unchanged' }] }],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1516,
      tags: [],
      due_date: isoDay,
      due_start: '10:40:00',
      due_end: '11:40:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5013,
      slug: 'title-paste-sanitize',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();

      await titleInput.fill('## Pasted title\n- [ ] follow up');

      await expect(titleInput).toHaveValue('## Pasted title\n- [ ] follow up');
      await expect(bodyEditor).toContainText('Body stays unchanged');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('flushes title-only edits when closing the modal immediately', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Title flush baseline',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body remains unchanged' }] }],
      },
      excerpt: 'Body remains unchanged',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1519,
      tags: [],
      due_date: isoDay,
      due_start: '10:55:00',
      due_end: '11:55:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5016,
      slug: 'title-close-flush',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      await expect(titleInput).toHaveValue('Title flush baseline');

      await titleInput.fill('Title flush updated');
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);

      await expect
        .poll(async () => {
          return fetchSavedCard(cardId);
        }, { timeout: 20_000, intervals: [250, 500, 1000, 2000] })
        .toMatchObject({
          title: 'Title flush updated',
          excerpt: 'Body remains unchanged',
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('keeps long title wrapped after reopening modal', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const longTitle = 'Long title '.repeat(20).trim();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: longTitle,
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1517,
      tags: [],
      due_date: isoDay,
      due_start: '10:50:00',
      due_end: '11:50:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5014,
      slug: 'title-wrap-reopen',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    const readMetrics = async (modal: Locator) => {
      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      await expect(titleInput).toBeVisible();

      return titleInput.evaluate((input) => {
        if (!(input instanceof HTMLTextAreaElement)) {
          throw new Error('Missing title textarea');
        }
        const styles = window.getComputedStyle(input);
        const lineHeight = Number.parseFloat(styles.lineHeight);
        return {
          clientHeight: input.clientHeight,
          scrollHeight: input.scrollHeight,
          clientWidth: input.clientWidth,
          scrollWidth: input.scrollWidth,
          lineHeight,
        };
      });
    };

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      let modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const firstMetrics = await readMetrics(modal);
      expect(firstMetrics.clientHeight).toBeGreaterThan(firstMetrics.lineHeight * 1.5);
      expect(firstMetrics.scrollWidth).toBeLessThanOrEqual(firstMetrics.clientWidth + 2);

      await page.goto(boardContext.canonicalPath);
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const reopenedMetrics = await readMetrics(modal);
      expect(reopenedMetrics.clientHeight).toBeGreaterThan(reopenedMetrics.lineHeight * 1.5);
      expect(reopenedMetrics.scrollWidth).toBeLessThanOrEqual(reopenedMetrics.clientWidth + 2);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('pastes markdown and restores heading checklist and details blocks', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Markdown paste target',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1516,
      tags: [],
      due_date: isoDay,
      due_start: '11:30:00',
      due_end: '12:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5013,
      slug: 'markdown-paste-target',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();

      await bodyEditor.click();
      await pastePlainText(page, [
        '## Pasted Heading',
        '',
        '- [x] Done',
        '- [ ] Todo',
        '',
        ':::details',
        'Pasted Summary',
        '',
        'Details body line 1',
        '',
        'Details body line 2',
        ':::',
      ].join('\n'));

      await expect(bodyEditor.locator('h2').first()).toHaveText('Pasted Heading');
      await expect(bodyEditor.locator('ul[data-type="taskList"] li').first()).toContainText('Done');
      await expect(bodyEditor.locator('summary').first()).toHaveText('Pasted Summary');
      await expect(bodyEditor.locator('div[data-type="detailsContent"] p').first()).toHaveText('Details body line 1');

      await expect.poll(async () => {
        const { data } = await supabaseAdmin
          .from('cards')
          .select('content')
          .eq('id', cardId)
          .eq('board_id', boardContext.boardId)
          .maybeSingle();
        return Array.isArray((data?.content as { content?: Array<{ type?: string }> } | null)?.content)
          ? (data?.content as { content: Array<{ type?: string }> }).content.map((node) => node.type)
          : [];
      }, { timeout: 20_000 }).toEqual(expect.arrayContaining(['heading', 'taskList', 'details']));
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('round-trips taesk markdown copy into restored details blocks', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const isoDay = isoDateJst();
    const sourceCardId = crypto.randomUUID();
    const targetCardId = crypto.randomUUID();
    const sourceShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const targetShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const sourceInsert = await supabaseAdmin.from('cards').insert({
      id: sourceCardId,
      title: 'Markdown source',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Roundtrip Heading' }],
          },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Roundtrip Task' }] }],
              },
            ],
          },
          {
            type: 'details',
            attrs: { open: true },
            content: [
              {
                type: 'detailsSummary',
                content: [{ type: 'text', text: 'Roundtrip Summary' }],
              },
              {
                type: 'detailsContent',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Roundtrip Body' }] }],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1517,
      tags: [],
      due_date: isoDay,
      due_start: '12:30:00',
      due_end: '13:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: sourceShortId,
      id_short: 5014,
      slug: 'markdown-roundtrip-source',
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(sourceInsert.error).toBeNull();

    const targetInsert = await supabaseAdmin.from('cards').insert({
      id: targetCardId,
      title: 'Markdown target',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1518,
      tags: [],
      due_date: isoDay,
      due_start: '13:30:00',
      due_end: '14:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: targetShortId,
      id_short: 5015,
      slug: 'markdown-roundtrip-target',
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(targetInsert.error).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${sourceShortId}`);
      const sourceModal = page.getByRole('dialog');
      await expect(sourceModal).toBeVisible();
      const sourceEditor = sourceModal.locator('.ProseMirror[data-autofocus="true"]').first();

      await sourceEditor.click();
      const selectAllModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${selectAllModifier}+A`);
      const payload = await dispatchCopyEvent(page);
      expect(payload.plainText).toContain(':::details');

      await page.goto(`${boardContext.canonicalPath}?card=${targetShortId}`);
      const targetModal = page.getByRole('dialog');
      await expect(targetModal).toBeVisible();
      const targetEditor = targetModal.locator('.ProseMirror[data-autofocus="true"]').first();

      await targetEditor.click();
      await pastePlainText(page, payload.plainText);

      await expect(targetEditor.locator('h2').first()).toHaveText('Roundtrip Heading');
      await expect(targetEditor.locator('ul[data-type="taskList"] li').first()).toContainText('Roundtrip Task');
      await expect(targetEditor.locator('summary').first()).toHaveText('Roundtrip Summary');
      await expect(targetEditor.locator('div[data-type="detailsContent"] p').first()).toHaveText('Roundtrip Body');
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [sourceCardId, targetCardId]);
    }
  });

  test('keeps card title independent when multiline text is pasted in body', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const initialTitle = 'Paste baseline';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: initialTitle,
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1700,
      tags: [],
      due_date: isoDay,
      due_start: '11:00:00',
      due_end: '12:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 502,
      slug: 'paste-baseline',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();

      await bodyEditor.click();
      const selectAllModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${selectAllModifier}+A`);
      await pastePlainText(page, 'A\nB\nC');

      await expect(modal.locator('[data-sticky-title] textarea')).toHaveValue(initialTitle);

      const nodeSummary = await bodyEditor.evaluate((root) => {
        const textContent = root.textContent ?? '';
        return {
          textContent,
        };
      });

      expect(nodeSummary.textContent).toContain('A');
      expect(nodeSummary.textContent).toContain('B');
      expect(nodeSummary.textContent).toContain('C');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('pastes image in body editor, stores storagePath, and refreshes signed URL on reopen', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const initialTitle = 'Image paste baseline';
    let uploadedPaths: string[] = [];

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: initialTitle,
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: initialTitle }],
                  },
                ],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1800,
      tags: [],
      due_date: isoDay,
      due_start: '13:00:00',
      due_end: '14:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 503,
      slug: 'image-paste-baseline',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();

      const uploadResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'POST' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${cardId}/images`)
        );
      }, { timeout: 20_000 });

      await bodyEditor.click();
      await pasteImageFromBytes(page, {
        bytes: [
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
          0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
          0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
          251, 3, 253, 160, 157, 164, 70, 0, 0, 0, 0, 73, 69, 78, 68,
          174, 66, 96, 130,
        ],
        mimeType: 'image/png',
        fileName: 'paste.png',
      });

      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.ok(), `image upload API failed: ${uploadResponse.status()}`).toBeTruthy();
      await expect(modal.locator('[data-sticky-title] textarea')).toHaveValue(initialTitle);
      await expect(bodyEditor.locator('img')).toHaveCount(1);

      await expect.poll(async () => {
        const { data } = await supabaseAdmin
          .from('cards')
          .select('content')
          .eq('id', cardId)
          .eq('board_id', boardContext.boardId)
          .maybeSingle();
        return collectStoragePathsFromContent(data?.content).length;
      }, { timeout: 20_000 }).toBeGreaterThan(0);

      const { data: savedCard } = await supabaseAdmin
        .from('cards')
        .select('content')
        .eq('id', cardId)
        .eq('board_id', boardContext.boardId)
        .maybeSingle();
      uploadedPaths = collectStoragePathsFromContent(savedCard?.content);

      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();

      const signResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'POST' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${cardId}/images/sign`)
        );
      }, { timeout: 20_000 });

      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const reopenedModal = page.getByRole('dialog');
      await expect(reopenedModal).toBeVisible();
      const signResponse = await signResponsePromise;
      expect(signResponse.ok(), `image sign API failed: ${signResponse.status()}`).toBeTruthy();
      await expect(reopenedModal.locator('.ProseMirror[data-autofocus="true"] img').first()).toBeVisible();
    } finally {
      if (uploadedPaths.length > 0) {
        await supabaseAdmin.storage.from('card-images').remove(uploadedPaths);
      }
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('keeps caret stable when typing around a pasted body image', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    let uploadedPaths: string[] = [];

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Image caret stability',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'before' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'after' }],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1810,
      tags: [],
      due_date: isoDay,
      due_start: '13:00:00',
      due_end: '14:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5030,
      slug: 'image-caret-stability',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const firstParagraph = modal.locator('.ProseMirror > p').nth(0);
      const secondParagraph = modal.locator('.ProseMirror > p').nth(1);

      await expect(firstParagraph).toHaveText('before');
      await expect(secondParagraph).toHaveText('after');

      const uploadResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'POST' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${cardId}/images`)
        );
      }, { timeout: 20_000 });

      await firstParagraph.click();
      await page.keyboard.press('End');
      await pasteImageFromBytes(page, {
        bytes: [
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
          0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
          0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
          251, 3, 253, 160, 157, 164, 70, 0, 0, 0, 0, 73, 69, 78, 68,
          174, 66, 96, 130,
        ],
        mimeType: 'image/png',
        fileName: 'caret-stability.png',
      });

      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.ok(), `image upload API failed: ${uploadResponse.status()}`).toBeTruthy();
      await expect(bodyEditor.locator('img')).toHaveCount(1);

      const firstParagraphAfterPaste = modal.locator('.ProseMirror > p').nth(0);
      const secondParagraphAfterPaste = modal.locator('.ProseMirror > p').nth(1);

      await firstParagraphAfterPaste.click();
      await page.keyboard.press('End');
      await page.keyboard.type('-UP');
      await expect(firstParagraphAfterPaste).toHaveText('before-UP');
      await expect(secondParagraphAfterPaste).toHaveText('after');

      await secondParagraphAfterPaste.click();
      await page.keyboard.press('Home');
      await page.keyboard.type('DOWN-');
      await expect(firstParagraphAfterPaste).toHaveText('before-UP');
      await expect(secondParagraphAfterPaste).toHaveText('DOWN-after');

      await expect.poll(async () => {
        const { data } = await supabaseAdmin
          .from('cards')
          .select('content')
          .eq('id', cardId)
          .eq('board_id', boardContext.boardId)
          .maybeSingle();
        return collectStoragePathsFromContent(data?.content).length;
      }, { timeout: 20_000 }).toBeGreaterThan(0);

      const { data: savedCard } = await supabaseAdmin
        .from('cards')
        .select('content')
        .eq('id', cardId)
        .eq('board_id', boardContext.boardId)
        .maybeSingle();
      uploadedPaths = collectStoragePathsFromContent(savedCard?.content);
    } finally {
      if (uploadedPaths.length > 0) {
        await supabaseAdmin.storage.from('card-images').remove(uploadedPaths);
      }
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('pastes image from first checklist row when multiple checklist rows exist', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const initialTitle = 'Checklist image title';
    let uploadedPaths: string[] = [];

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: initialTitle,
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: initialTitle }],
                  },
                ],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'line 2' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1850,
      tags: [],
      due_date: isoDay,
      due_start: '14:00:00',
      due_end: '15:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5031,
      slug: 'image-paste-multi-checklist',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();
      await expect(firstChecklistLine).toBeVisible();

      const uploadResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'POST' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${cardId}/images`)
        );
      }, { timeout: 20_000 });

      await firstChecklistLine.click();
      await pasteImageFromBytes(page, {
        bytes: [
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
          0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
          0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
          251, 3, 253, 160, 157, 164, 70, 0, 0, 0, 0, 73, 69, 78, 68,
          174, 66, 96, 130,
        ],
        mimeType: 'image/png',
        fileName: 'paste-from-title-row.png',
      });

      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.ok(), `image upload API failed: ${uploadResponse.status()}`).toBeTruthy();
      await expect(modal.locator('[data-sticky-title] textarea')).toHaveValue(initialTitle);
      await expect(bodyEditor.locator('img')).toHaveCount(1);

      await expect.poll(async () => {
        const { data } = await supabaseAdmin
          .from('cards')
          .select('content')
          .eq('id', cardId)
          .eq('board_id', boardContext.boardId)
          .maybeSingle();
        return collectStoragePathsFromContent(data?.content).length;
      }, { timeout: 20_000 }).toBeGreaterThan(0);

      const { data: savedCard } = await supabaseAdmin
        .from('cards')
        .select('content')
        .eq('id', cardId)
        .eq('board_id', boardContext.boardId)
        .maybeSingle();
      uploadedPaths = collectStoragePathsFromContent(savedCard?.content);
    } finally {
      if (uploadedPaths.length > 0) {
        await supabaseAdmin.storage.from('card-images').remove(uploadedPaths);
      }
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('keeps existing body images when pasting on first checklist row', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const initialTitle = 'Keep existing images';
    let uploadedPaths: string[] = [];

    const tinyPngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+H7kAAAAASUVORK5CYII=';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: initialTitle,
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: initialTitle }],
                  },
                ],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'line 2' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'image',
            attrs: { src: tinyPngDataUrl, alt: 'existing-image-1' },
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'between images' }],
          },
          {
            type: 'image',
            attrs: { src: tinyPngDataUrl, alt: 'existing-image-2' },
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1860,
      tags: [],
      due_date: isoDay,
      due_start: '14:00:00',
      due_end: '15:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5032,
      slug: 'image-paste-keep-existing',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();
      await expect(firstChecklistLine).toBeVisible();
      await expect(bodyEditor.locator('img')).toHaveCount(2);

      const uploadResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'POST' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${cardId}/images`)
        );
      }, { timeout: 20_000 });

      await firstChecklistLine.click();
      await pasteImageFromBytes(page, {
        bytes: [
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
          0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
          0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
          251, 3, 253, 160, 157, 164, 70, 0, 0, 0, 0, 73, 69, 78, 68,
          174, 66, 96, 130,
        ],
        mimeType: 'image/png',
        fileName: 'keep-existing.png',
      });

      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.ok(), `image upload API failed: ${uploadResponse.status()}`).toBeTruthy();
      await expect(bodyEditor.locator('img')).toHaveCount(3);

      await expect.poll(async () => {
        const { data } = await supabaseAdmin
          .from('cards')
          .select('content')
          .eq('id', cardId)
          .eq('board_id', boardContext.boardId)
          .maybeSingle();
        return collectStoragePathsFromContent(data?.content).length;
      }, { timeout: 20_000 }).toBeGreaterThan(0);

      const { data: savedCard } = await supabaseAdmin
        .from('cards')
        .select('content')
        .eq('id', cardId)
        .eq('board_id', boardContext.boardId)
        .maybeSingle();
      uploadedPaths = collectStoragePathsFromContent(savedCard?.content);
    } finally {
      if (uploadedPaths.length > 0) {
        await supabaseAdmin.storage.from('card-images').remove(uploadedPaths);
      }
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('pastes html image on first checklist row and keeps it', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const initialTitle = 'HTML image paste title row';
    let uploadedPaths: string[] = [];

    const tinyPngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+H7kAAAAASUVORK5CYII=';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: initialTitle,
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: initialTitle }],
                  },
                ],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'line 2' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1880,
      tags: [],
      due_date: isoDay,
      due_start: '14:00:00',
      due_end: '15:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5034,
      slug: 'image-paste-html-title-row',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();
      await expect(firstChecklistLine).toBeVisible();

      const uploadResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'POST' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${cardId}/images`)
        );
      }, { timeout: 20_000 });

      await firstChecklistLine.click();
      await pasteHtmlImageFromDataUrl(page, tinyPngDataUrl);

      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.ok(), `image upload API failed: ${uploadResponse.status()}`).toBeTruthy();
      await expect(bodyEditor.locator('img')).toHaveCount(1);

      await expect.poll(async () => {
        const { data } = await supabaseAdmin
          .from('cards')
          .select('content')
          .eq('id', cardId)
          .eq('board_id', boardContext.boardId)
          .maybeSingle();
        return collectStoragePathsFromContent(data?.content).length;
      }, { timeout: 20_000 }).toBeGreaterThan(0);

      const { data: savedCard } = await supabaseAdmin
        .from('cards')
        .select('content')
        .eq('id', cardId)
        .eq('board_id', boardContext.boardId)
        .maybeSingle();
      uploadedPaths = collectStoragePathsFromContent(savedCard?.content);
    } finally {
      if (uploadedPaths.length > 0) {
        await supabaseAdmin.storage.from('card-images').remove(uploadedPaths);
      }
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('preserves html image on first checklist row when plain text has multiple lines', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const initialTitle = 'HTML+text paste title row';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: initialTitle,
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: initialTitle }],
                  },
                ],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'line 2' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1885,
      tags: [],
      due_date: isoDay,
      due_start: '14:00:00',
      due_end: '15:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5035,
      slug: 'image-paste-html-multiline-title-row',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();
      await expect(firstChecklistLine).toBeVisible();

      await firstChecklistLine.click();
      await pasteHtmlWithPlainText(page, {
        plainText: 'Title line\nBody line 1\nBody line 2',
        html: '<p>Title line</p><p>Body line 1</p><p>Body line 2</p><img src="/icon" alt="html-image" />',
      });

      await expect(bodyEditor.locator('img')).toHaveCount(1);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves focus between title and first checklist line with arrow keys on task-list cards', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Arrow navigation baseline',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'body line' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1890,
      tags: [],
      due_date: isoDay,
      due_start: '14:30:00',
      due_end: '15:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5036,
      slug: 'arrow-navigation-baseline',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();

      await expect(titleInput).toHaveValue('Arrow navigation baseline');
      await expect(firstChecklistLine).toBeVisible();

      await titleInput.evaluate((input: HTMLTextAreaElement) => {
        input.focus();
        input.setSelectionRange(5, 5);
      });
      await page.keyboard.press('ArrowDown');

      await expect.poll(async () => {
        return page.evaluate(() => {
          const active = document.activeElement;
          return active instanceof HTMLElement && active.classList.contains('ProseMirror');
        });
      }).toBeTruthy();

      await expect.poll(async () => {
        return page.evaluate(() => {
          const selection = window.getSelection();
          const anchorNode = selection?.anchorNode;
          const anchorOffset = selection?.anchorOffset ?? -1;
          const lineText = anchorNode?.textContent ?? anchorNode?.parentElement?.textContent ?? '';
          return { anchorOffset, lineText };
        });
      }).toEqual({ anchorOffset: 5, lineText: 'body line' });

      await page.keyboard.press('ArrowUp');
      await page.keyboard.type('Z');
      await expect(titleInput).toHaveValue('ArrowZ navigation baseline');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });


  test('prepends empty task item on Enter from title', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    // 先頭が taskList でない初期状態
    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Enter from title test',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'existing body text' }] }],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1895,
      tags: [],
      due_date: isoDay,
      due_start: '14:50:00',
      due_end: '15:50:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5038,
      slug: 'enter-from-title-test',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      await expect(titleInput).toHaveValue('Enter from title test');

      // 1. Enter を押下
      await titleInput.focus();
      await page.keyboard.press('Enter');

      // 2. 本文先頭に空の taskItem が挿入され、フォーカスが移動していることを確認
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();
      await expect(firstChecklistLine).toBeVisible();
      
      // 書き込めるか確認（フォーカスが移動していることの証明）
      await page.keyboard.type('New item 1');
      await expect(firstChecklistLine).toHaveText('New item 1');
      await expect(titleInput).toHaveValue('Enter from title test'); // タイトルは不変

      // 3. 再びタイトルから Enter
      await titleInput.focus();
      await page.keyboard.press('Enter');
      
      // 二重 taskList にならず、既存リストの先頭に追加されることを確認
      const secondChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:nth-child(2) p').first();
      await expect(secondChecklistLine).toHaveText('New item 1');
      const newFirstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();
      await page.keyboard.type('New item 2');
      await expect(newFirstChecklistLine).toHaveText('New item 2');

    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('supports horizontal title-body arrow movement on task-list cards', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Arrow LR baseline',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'body line' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1891,
      tags: [],
      due_date: isoDay,
      due_start: '14:40:00',
      due_end: '15:40:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5037,
      slug: 'arrow-lr-baseline',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();

      await expect(titleInput).toHaveValue('Arrow LR baseline');
      await expect(firstChecklistLine).toHaveText('body line');

      await titleInput.evaluate((input: HTMLTextAreaElement) => {
        const pos = input.value.length;
        input.focus();
        input.setSelectionRange(pos, pos);
      });
      await page.keyboard.press('ArrowRight');
      await page.keyboard.type('Q');
      await expect(firstChecklistLine).toHaveText('Qbody line');

      await firstChecklistLine.click({ position: { x: 4, y: 8 } });
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowLeft');
      await expect.poll(async () => {
        return page.evaluate(() => {
          const active = document.activeElement;
          return active instanceof HTMLTextAreaElement && active.closest('[data-sticky-title]') !== null;
        });
      }).toBeTruthy();
      await page.keyboard.type('Y');
      await expect(titleInput).toHaveValue('Arrow LR baselineY');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('shows context-aware shortcut bars for timeline cards and card modal regions', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Shortcut bar timeline test',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'body line' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1892,
      tags: [],
      due_date: isoDay,
      due_start: '13:30:00',
      due_end: '14:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5039,
      slug: 'shortcut-bar-timeline-test',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const eventCard = page.locator(`[data-card-id="${cardId}"][data-shortcut-region="timeline-card"]`).first();
      await expect(eventCard).toBeVisible();

      await eventCard.focus();

      const boardBar = page.getByTestId('board-shortcut-bar');
      await expect(boardBar).toBeVisible();
      await expect(boardBar).toContainText('タイムラインカード');
      await expect(boardBar).toContainText('詳細');
      await expect(boardBar).toContainText('完了');

      await page.keyboard.press('Enter');

      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      await expect(boardBar).toHaveCount(0);

      const modalBar = page.getByTestId('modal-shortcut-bar');
      await expect(modalBar).toBeVisible();

      const titleInput = modal.locator('[data-shortcut-region="cardmodal-title"]').first();
      await titleInput.focus();
      await expect(modalBar).toContainText('カードタイトル');
      await expect(modalBar).toContainText('本文へ');
      await expect(modalBar).toContainText('空チェック追加');

      await page.keyboard.press('ArrowDown');
      await expect(modalBar).toContainText('カード本文');
      await expect(modalBar).toContainText('タイトルへ');

      await page.keyboard.press('ArrowUp');
      await expect(modalBar).toContainText('カードタイトル');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('inserts details, persists closed state, and updates excerpt text', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Details insert test',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before details' }] }],
      },
      excerpt: 'before details',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1892,
      tags: [],
      due_date: isoDay,
      due_start: '14:45:00',
      due_end: '15:45:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5039,
      slug: 'details-insert-test',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const paragraphHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="paragraph"]').first();
      await triggerBlockAction(page, modal, paragraphHandle, 'toggle-details');
      await page.keyboard.type('詳細');
      await page.keyboard.press('Enter');
      await page.keyboard.type('内側メモ');
      await expect(modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="details"]')).toHaveCount(1);

      const detailsToggle = modal.locator('.ProseMirror div[data-type="details"] > button').first();
      await detailsToggle.click();

      await page.waitForTimeout(2500);

      const { data: savedCard, error: savedError } = await supabaseAdmin
        .from('cards')
        .select('content, excerpt')
        .eq('id', cardId)
        .maybeSingle();

      expect(savedError).toBeNull();
      expect(savedCard?.excerpt).toContain('詳細');
      expect(savedCard?.excerpt).toContain('内側メモ');
      const detailsNode = Array.isArray((savedCard?.content as { content?: Array<{ type?: string; attrs?: { open?: boolean } }> } | null)?.content)
        ? (savedCard?.content as { content: Array<{ type?: string; attrs?: { open?: boolean } }> }).content.find((node) => node?.type === 'details')
        : null;
      expect(detailsNode?.attrs?.open).toBe(false);

      await page.reload();
      const reopenedModal = page.getByRole('dialog');
      await expect(reopenedModal).toBeVisible();
      await expect(reopenedModal.locator('.ProseMirror summary').first()).toContainText('詳細');
      await expect(reopenedModal.locator('.ProseMirror div[data-type="detailsContent"][hidden]').first()).toBeAttached();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('wraps the current line into details content with empty summary', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Details wrap test',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'トグルにする？' }] }],
      },
      excerpt: 'トグルにする？',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1894,
      tags: [],
      due_date: isoDay,
      due_start: '14:45:00',
      due_end: '15:45:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5041,
      slug: 'details-wrap-test',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      await page.evaluate(() => {
        const paragraph = document.querySelector('.ProseMirror p');
        const textNode = paragraph?.firstChild;
        if (!textNode) {
          throw new Error('Missing paragraph text node');
        }
        const textLength = textNode.textContent?.length ?? 0;
        const range = document.createRange();
        range.setStart(textNode, Math.min(3, textLength));
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });

      const paragraphHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="paragraph"]').first();
      await triggerBlockAction(page, modal, paragraphHandle, 'toggle-details');

      const editorRoot = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      await expect(editorRoot.locator('summary').first()).toHaveText('');
      await expect(editorRoot.locator('div[data-type="detailsContent"] p').first()).toHaveText('トグルにする？');
      await expect(modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="details"]')).toHaveCount(1);

      await page.waitForTimeout(2500);

      const { data: savedCard, error: savedError } = await supabaseAdmin
        .from('cards')
        .select('content')
        .eq('id', cardId)
        .maybeSingle();

      expect(savedError).toBeNull();
      const detailsNode = Array.isArray((savedCard?.content as { content?: Array<{ type?: string; content?: unknown[] }> } | null)?.content)
        ? (savedCard?.content as { content: Array<{ type?: string; content?: unknown[] }> }).content.find((node) => node?.type === 'details')
        : null;
      const detailsContentNode = Array.isArray(detailsNode?.content)
        ? detailsNode.content.find((node) => (node as { type?: string })?.type === 'detailsContent') as { content?: Array<{ type?: string; content?: Array<{ text?: string }> }> } | undefined
        : undefined;
      const detailsSummaryNode = Array.isArray(detailsNode?.content)
        ? detailsNode.content.find((node) => (node as { type?: string })?.type === 'detailsSummary') as { content?: Array<{ text?: string }> } | undefined
        : undefined;
      const wrappedParagraph = detailsContentNode?.content?.find((node) => node.type === 'paragraph');
      expect(detailsSummaryNode?.content?.length ?? 0).toBe(0);
      expect(wrappedParagraph?.content?.[0]?.text).toBe('トグルにする？');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('persists details conversion without additional typing', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Details autosave test',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '変換だけで保存される?' }] }],
      },
      excerpt: '変換だけで保存される?',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1898,
      tags: [],
      due_date: isoDay,
      due_start: '15:10:00',
      due_end: '16:10:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5045,
      slug: 'details-autosave-test',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const paragraphHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="paragraph"]').first();
      await triggerBlockAction(page, modal, paragraphHandle, 'toggle-details');
      await expect(modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="details"]')).toHaveCount(1);

      await expect
        .poll(async () => {
          const savedCard = await fetchSavedCard(cardId);
          const content = savedCard?.content as { content?: Array<{ type?: string; content?: unknown[] }> } | null;
          const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
          return topLevelNodes.map((node) => node?.type ?? null);
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toEqual(expect.arrayContaining(['details']));
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('unsets details without losing summary or content', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Details unset test',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文の前置き' }] }],
      },
      excerpt: '本文の前置き',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1893,
      tags: [],
      due_date: isoDay,
      due_start: '14:46:00',
      due_end: '15:46:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5040,
      slug: 'details-unset-test',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const paragraphHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="paragraph"]').first();
      await triggerBlockAction(page, modal, paragraphHandle, 'toggle-details');
      await page.keyboard.type('詳細セクション');
      const detailsHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="details"]').first();
      await triggerBlockAction(page, modal, detailsHandle, 'unset-details');

      await expect(modal.locator('.ProseMirror div[data-type="details"]')).toHaveCount(0);
      await expect(modal.locator('.ProseMirror').first()).toContainText('詳細セクション');
      await expect(modal.locator('.ProseMirror').first()).toContainText('本文の前置き');

      await page.waitForTimeout(2500);

      const { data: savedCard, error: savedError } = await supabaseAdmin
        .from('cards')
        .select('content, excerpt')
        .eq('id', cardId)
        .maybeSingle();

      expect(savedError).toBeNull();
      expect(savedCard?.excerpt).toContain('詳細セクション');
      expect(savedCard?.excerpt).toContain('本文の前置き');
      expect(savedCard?.content).not.toMatchObject({
        content: expect.arrayContaining([expect.objectContaining({ type: 'details' })]),
      });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('supports block actions for paragraph, heading, and task items with autosave', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action test',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section heading' }] },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task alpha' }] }],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task beta' }] }],
              },
            ],
          },
        ],
      },
      excerpt: 'First paragraph\nSection heading\n[ ] Task alpha\n[ ] Task beta',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1895,
      tags: [],
      due_date: isoDay,
      due_start: '15:00:00',
      due_end: '16:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5042,
      slug: 'block-action-test',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const handles = modal.getByTestId('tiptap-block-handle');
      const paragraphHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="paragraph"]');
      await expect(handles).toHaveCount(5);
      await expect(modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="heading"]')).toHaveCount(1);
      await expect(modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]')).toHaveCount(2);
      await expect(paragraphHandles).toHaveCount(2);

      await triggerBlockAction(page, modal, paragraphHandles.first(), 'insert-above');

      await triggerBlockAction(page, modal, modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="heading"]').first(), 'duplicate');

      await triggerBlockAction(page, modal, modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]').first(), 'insert-below');

      await triggerBlockAction(page, modal, modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]').first(), 'delete');

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as { content?: Array<{ type?: string; attrs?: { level?: number }; content?: unknown[] }> } | null;
          const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
          return {
            paragraphCount: topLevelNodes.filter((node) => node?.type === 'paragraph').length,
            headingCount: topLevelNodes.filter((node) => node?.type === 'heading').length,
            excerpt: nextCard?.excerpt ?? '',
          };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          paragraphCount: 4,
          headingCount: 2,
          excerpt: expect.stringContaining('Section heading'),
        });

      const savedCard = await fetchSavedCard(cardId);
      const content = savedCard?.content as { content?: Array<{ type?: string; attrs?: { level?: number }; content?: unknown[] }> } | null;
      const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
      expect(topLevelNodes[0]).toMatchObject({ type: 'paragraph' });
      expect(topLevelNodes[1]).toMatchObject({ type: 'paragraph' });
      expect(topLevelNodes.filter((node) => node?.type === 'paragraph').length).toBeGreaterThanOrEqual(4);
      expect(topLevelNodes.filter((node) => node?.type === 'heading')).toHaveLength(2);
      expect(savedCard?.excerpt).toContain('Section heading');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('updates top-level paragraphs when insert-above is executed from block menu', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action insert above',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section heading' }] },
        ],
      },
      excerpt: 'First paragraph\nSection heading',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1894,
      tags: [],
      due_date: isoDay,
      due_start: '14:50:00',
      due_end: '15:50:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5041,
      slug: 'block-action-insert-above',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const paragraphHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="paragraph"]');
      await expect(paragraphHandles).toHaveCount(2);
      await expect(paragraphHandles.first()).toHaveAttribute('data-block-pos', '1');

      await triggerBlockAction(
        page,
        modal,
        paragraphHandles.first(),
        'insert-above',
      );

      const insertAboveDebug = await readLastBlockAction(page);
      console.log(`[block-action-debug][insert-above] ${JSON.stringify(insertAboveDebug)}`);
      expect(insertAboveDebug).toMatchObject({
        action: 'insert-above',
        menuTargetNodeType: 'paragraph',
        resolvedNodeType: 'paragraph',
      });

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as { content?: Array<{ type?: string }> } | null;
          const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
          return {
            topLevelTypes: topLevelNodes.map((node) => node?.type ?? null),
            paragraphCount: topLevelNodes.filter((node) => node?.type === 'paragraph').length,
          };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          topLevelTypes: ['paragraph', 'paragraph', 'heading', 'paragraph'],
          paragraphCount: 3,
        });

      const savedCard = await fetchSavedCard(cardId);
      const content = savedCard?.content as { content?: Array<{ type?: string }> } | null;
      const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
      expect(topLevelNodes[0]).toMatchObject({ type: 'paragraph' });
      expect(topLevelNodes[1]).toMatchObject({ type: 'paragraph' });
      expect(topLevelNodes.filter((node) => node?.type === 'paragraph')).toHaveLength(3);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('duplicates heading when duplicate is executed from block menu', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action duplicate heading',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section heading' }] },
        ],
      },
      excerpt: 'First paragraph\nSection heading',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1893,
      tags: [],
      due_date: isoDay,
      due_start: '14:40:00',
      due_end: '15:40:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5040,
      slug: 'block-action-duplicate-heading',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const headingHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="heading"]').first();
      const headingHandlePos = await headingHandle.getAttribute('data-block-pos');
      console.log(`[block-action-debug][heading-handle] pos=${headingHandlePos}`);

      await triggerBlockAction(
        page,
        modal,
        headingHandle,
        'duplicate',
      );

      const duplicateDebug = await readLastBlockAction(page);
      console.log(`[block-action-debug][duplicate] ${JSON.stringify(duplicateDebug)}`);
      expect(duplicateDebug).toMatchObject({
        action: 'duplicate',
        menuTargetNodeType: 'heading',
        resolvedNodeType: 'heading',
      });

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as { content?: Array<{ type?: string; attrs?: { level?: number } }> } | null;
          const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
          return {
            headingCount: topLevelNodes.filter((node) => node?.type === 'heading').length,
          };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          headingCount: 2,
        });

      const savedCard = await fetchSavedCard(cardId);
      const content = savedCard?.content as { content?: Array<{ type?: string; attrs?: { level?: number } }> } | null;
      const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
      expect(topLevelNodes.filter((node) => node?.type === 'heading')).toHaveLength(2);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('keeps disabled move action visible and non-executable', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action disabled move',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section heading' }] },
        ],
      },
      excerpt: 'First paragraph\nSection heading',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1892,
      tags: [],
      due_date: isoDay,
      due_start: '14:30:00',
      due_end: '15:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5039,
      slug: 'block-action-disabled-move',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      await clearLastBlockAction(page);

      const paragraphHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="paragraph"]').first();
      await openBlockActionMenu(page, modal, paragraphHandle, 'move-down');
      const moveUpItem = modal.getByTestId('tiptap-block-menu-move-up');

      await expect(moveUpItem).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('ArrowUp');
      await expect(moveUpItem).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(modal.getByTestId('tiptap-block-menu')).toBeVisible();
      expect(await readLastBlockAction(page)).toBeNull();

      const savedCard = await fetchSavedCard(cardId);
      const content = savedCard?.content as { content?: Array<{ type?: string }> } | null;
      const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
      expect(topLevelNodes.map((node) => node?.type ?? null)).toEqual(['paragraph', 'heading']);

      await page.keyboard.press('Escape');
      await expect(modal.getByTestId('tiptap-block-menu')).toHaveCount(0);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves top-level paragraph down when move-down is executed from block menu', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action move paragraph',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section heading' }] },
          {
            type: 'details',
            attrs: { open: true },
            content: [
              { type: 'detailsSummary', content: [{ type: 'text', text: 'Details summary' }] },
              {
                type: 'detailsContent',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Details body' }] }],
              },
            ],
          },
        ],
      },
      excerpt: 'First paragraph\nSection heading\nDetails summary',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1891,
      tags: [],
      due_date: isoDay,
      due_start: '14:20:00',
      due_end: '15:20:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5038,
      slug: 'block-action-move-paragraph',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const paragraphHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="paragraph"]').first();
      await openBlockActionMenu(page, modal, paragraphHandle, 'move-down');
      await expect(modal.getByTestId('tiptap-block-menu-move-up')).toHaveAttribute('aria-disabled', 'true');
      await triggerBlockAction(page, modal, paragraphHandle, 'move-down', 'move-down');

      const moveDebug = await readLastBlockAction(page);
      expect(moveDebug).toMatchObject({
        action: 'move-down',
        menuTargetNodeType: 'paragraph',
        resolvedNodeType: 'paragraph',
      });

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as { content?: Array<{ type?: string }> } | null;
          const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
          return {
            firstThreeTypes: topLevelNodes.slice(0, 3).map((node) => node?.type ?? null),
            trailingParagraphCount: topLevelNodes.filter((node) => node?.type === 'paragraph').length,
          };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          firstThreeTypes: ['heading', 'paragraph', 'details'],
          trailingParagraphCount: expect.any(Number),
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves details up when move-up is executed from block menu', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action move details',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Leading paragraph' }] },
          {
            type: 'details',
            attrs: { open: true },
            content: [
              { type: 'detailsSummary', content: [{ type: 'text', text: 'Details summary' }] },
              {
                type: 'detailsContent',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Details body' }] }],
              },
            ],
          },
        ],
      },
      excerpt: 'Leading paragraph\nDetails summary',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1890,
      tags: [],
      due_date: isoDay,
      due_start: '14:10:00',
      due_end: '15:10:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5037,
      slug: 'block-action-move-details',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const detailsHandle = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="details"]').first();
      await openBlockActionMenu(page, modal, detailsHandle, 'move-up');
      await triggerBlockAction(page, modal, detailsHandle, 'move-up', 'move-up');

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as { content?: Array<{ type?: string }> } | null;
          const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
          return {
            firstTwoTypes: topLevelNodes.slice(0, 2).map((node) => node?.type ?? null),
          };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          firstTwoTypes: ['details', 'paragraph'],
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves bullet list item down within the same list', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action move list item',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First item' }] }],
              },
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Second item' }] },
                  {
                    type: 'bulletList',
                    content: [
                      {
                        type: 'listItem',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested item' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      excerpt: 'First item\nSecond item',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1889,
      tags: [],
      due_date: isoDay,
      due_start: '14:00:00',
      due_end: '15:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5036,
      slug: 'block-action-move-list-item',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const listItemHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="listItem"]');
      await expect(listItemHandles).toHaveCount(2);
      await openBlockActionMenu(page, modal, listItemHandles.first(), 'move-down');
      await triggerBlockAction(page, modal, listItemHandles.first(), 'move-down', 'move-down');

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as {
            content?: Array<{
              type?: string;
              content?: Array<{ content?: Array<{ content?: Array<{ text?: string }> }> }>;
            }>;
          } | null;
          const listNode = Array.isArray(content?.content) ? content.content[0] : null;
          const itemTexts = Array.isArray(listNode?.content)
            ? listNode.content.map((item) => item?.content?.[0]?.content?.[0]?.text ?? null)
            : [];
          return { itemTexts };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          itemTexts: ['Second item', 'First item'],
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves heading with Mod-Shift-ArrowUp shortcut', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const moveUpShortcut = process.platform === 'darwin' ? 'Meta+Shift+ArrowUp' : 'Control+Shift+ArrowUp';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action shortcut move',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Shortcut heading' }] },
        ],
      },
      excerpt: 'First paragraph\nShortcut heading',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1888,
      tags: [],
      due_date: isoDay,
      due_start: '13:50:00',
      due_end: '14:50:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5035,
      slug: 'block-action-shortcut-move',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      await modal.locator('.ProseMirror h2').click();
      await page.keyboard.press(moveUpShortcut);

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as {
            content?: Array<{ type?: string; content?: Array<{ text?: string }> }>;
          } | null;
          const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
          return {
            firstTwoTypes: topLevelNodes.slice(0, 2).map((node) => node?.type ?? null),
            firstText: topLevelNodes[0]?.content?.[0]?.text ?? null,
          };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          firstTwoTypes: ['heading', 'paragraph'],
          firstText: 'Shortcut heading',
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('shows block handle only for supported top-level blocks', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Nested list block action guard',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Parent task' }] },
                  {
                    type: 'taskList',
                    content: [
                      {
                        type: 'taskItem',
                        attrs: { checked: false },
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested task' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      excerpt: '[ ] Parent task\n  [ ] Nested task',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1896,
      tags: [],
      due_date: isoDay,
      due_start: '15:10:00',
      due_end: '16:10:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5043,
      slug: 'nested-list-block-action-guard',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      await expect(modal.getByTestId('tiptap-block-handle')).toHaveCount(2);
      await expect(modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]')).toHaveCount(1);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('pressing Escape closes block menu without closing modal', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action escape',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Escape target paragraph' }] },
        ],
      },
      excerpt: 'Escape target paragraph',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1897,
      tags: [],
      due_date: isoDay,
      due_start: '15:20:00',
      due_end: '16:20:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5044,
      slug: 'block-action-escape',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      await openBlockActionMenu(page, modal, modal.getByTestId('tiptap-block-handle').first());
      await page.keyboard.press('Escape');

      await expect(modal.getByTestId('tiptap-block-menu')).toHaveCount(0);
      await expect(modal).toBeVisible();
      await expect(modal.getByRole('textbox', { name: 'タイトルなし' })).toBeVisible();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('shows validation error when pasted image exceeds size limit', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Image too large',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1900,
      tags: [],
      due_date: isoDay,
      due_start: '15:00:00',
      due_end: '16:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 504,
      slug: 'image-too-large',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      await bodyEditor.click();

      await pasteImageBySize(page, {
        size: 11 * 1024 * 1024,
        mimeType: 'image/png',
        fileName: 'too-large.png',
      });

      await expect(modal.getByText('画像サイズは 10MB 以下にしてください。')).toBeVisible();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });
});
