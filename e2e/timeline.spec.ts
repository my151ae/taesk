import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
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

function attachConsoleErrorCollector(page: Page) {
  const messages: string[] = [];
  const handler = (message: { type(): string; text(): string }) => {
    if (message.type() !== 'error') return;
    messages.push(message.text());
  };
  page.on('console', handler);
  return {
    assertClean() {
      expect(messages, `browser console errors:\n${messages.join('\n')}`).toEqual([]);
    },
    dispose() {
      page.off('console', handler);
    },
  };
}

function formatHeaderDateLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${month}/${day}`;
}

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
  await page.waitForTimeout(2);
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

async function countVisibleTaskItemHandles(modal: Locator): Promise<number> {
  const handles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]');
  const count = await handles.count();
  let visibleCount = 0;

  for (let index = 0; index < count; index += 1) {
    if (await handles.nth(index).isVisible()) {
      visibleCount += 1;
    }
  }

  return visibleCount;
}

function cardDetailRoot(page: Page): Locator {
  return page.getByTestId('card-peek-root');
}

async function clearLastBlockAction(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as typeof window & {
      __TAESK_LAST_BLOCK_ACTION__?: unknown;
    }).__TAESK_LAST_BLOCK_ACTION__;
  });
}

async function fetchSavedCard(cardId: string): Promise<{
  content: unknown;
  excerpt: string | null;
  title: string | null;
  checked: boolean | null;
  updatedAt: string | null;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('cards')
    .select('content, excerpt, title, checked, updated_at')
    .eq('id', cardId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch saved card ${cardId}: ${error.message}`);
  }

  return data
    ? {
        content: data.content,
        excerpt: data.excerpt ?? null,
        title: data.title ?? null,
        checked: data.checked ?? null,
        updatedAt: data.updated_at ?? null,
      }
    : null;
}

async function getElementWidth(locator: Locator, label: string): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`Missing bounds for ${label}`);
  }
  return box.width;
}

async function getScrollMetrics(locator: Locator): Promise<{ clientHeight: number; scrollHeight: number; scrollTop: number }> {
  return locator.evaluate((el) => {
    const element = el as HTMLElement;
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
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
  const dragHandle = locator.locator('[data-testid^="timeline-card-drag-handle-"]').first();
  const dragHandleCount = await dragHandle.count();
  const dragSource = dragHandleCount > 0 ? dragHandle : locator;
  const box = await dragSource.boundingBox();
  if (!box) {
    throw new Error('Failed to resolve draggable locator bounds');
  }

  const sourceX = box.x + Math.min(Math.max(box.width * 0.5, 4), box.width - 4);
  const sourceY = box.y + Math.min(Math.max(box.height * 0.35, 18), box.height - 12);

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 24, sourceY + 12, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 16 });
}

async function swipeLocatorHorizontally(
  page: Page,
  locator: Locator,
  direction: 'left' | 'right',
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Failed to resolve swipe locator bounds');
  }

  const client = await page.context().newCDPSession(page);
  const startX = direction === 'left'
    ? box.x + box.width * 0.88
    : box.x + box.width * 0.12;
  const endX = direction === 'left'
    ? box.x + box.width * 0.12
    : box.x + box.width * 0.88;
  const y = box.y + Math.min(72, Math.max(40, box.height * 0.16));
  const steps = 12;

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y, radiusX: 4, radiusY: 4 }],
  });

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const x = startX + (endX - startX) * progress;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, radiusX: 4, radiusY: 4 }],
    });
    await page.waitForTimeout(16);
  }

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

async function swipeLocatorVertically(
  page: Page,
  locator: Locator,
  direction: 'up' | 'down',
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Failed to resolve vertical swipe locator bounds');
  }

  const client = await page.context().newCDPSession(page);
  const x = box.x + box.width * 0.5;
  const startY = direction === 'up'
    ? box.y + box.height * 0.78
    : box.y + box.height * 0.22;
  const endY = direction === 'up'
    ? box.y + box.height * 0.22
    : box.y + box.height * 0.78;
  const steps = 10;

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: startY, radiusX: 4, radiusY: 4 }],
  });

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const y = startY + (endY - startY) * progress;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, radiusX: 4, radiusY: 4 }],
    });
    await page.waitForTimeout(16);
  }

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
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
    const consoleErrors = attachConsoleErrorCollector(page);
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
      consoleErrors.assertClean();
      consoleErrors.dispose();
    }
  });

  test('desktop timeline hides a middle day and backfills the next visible day', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const baseIsoDay = isoDateJst();
    const days = [
      baseIsoDay,
      shiftIsoDateJst(1),
      shiftIsoDateJst(2),
      shiftIsoDateJst(3),
    ];
    const timestamp = new Date().toISOString();
    const cards = days.map((isoDay, index) => ({
      id: crypto.randomUUID(),
      title: `Hidden day card ${index + 1}`,
      checklist: { version: 1, lines: [] },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1700 + index * 10,
      tags: [],
      due_date: isoDay,
      due_start: '09:00:00',
      due_end: '10:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      id_short: 601 + index,
      slug: `hidden-day-card-${index + 1}`,
      created_at: timestamp,
      updated_at: timestamp,
    }));

    const { error: insertError } = await supabaseAdmin.from('cards').insert(cards);
    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      await page.getByTestId('timeline-toolbar-range-plus').click();
      await expect(page.getByTestId(`timeline-hide-day-${days[0]}`)).toHaveCount(0);
      await expect(page.getByTestId(`timeline-hide-day-${days[1]}`)).toHaveCount(0);
      await expect(page.getByTestId(`timeline-hide-day-${days[2]}`)).toHaveCount(0);
      await expect(page.getByTestId(`timeline-reveal-left-${days[2]}-${days[1]}`)).toHaveCount(0);
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', cards.map((card) => card.id));
    }
  });

  test('desktop timeline no longer renders hidden-day reveal controls', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const baseIsoDay = isoDateJst();
    const days = [
      baseIsoDay,
      shiftIsoDateJst(1),
      shiftIsoDateJst(2),
      shiftIsoDateJst(3),
      shiftIsoDateJst(4),
    ];
    const timestamp = new Date().toISOString();
    const cards = days.map((isoDay, index) => ({
      id: crypto.randomUUID(),
      title: `Multi hidden reveal card ${index + 1}`,
      checklist: { version: 1, lines: [] },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1800 + index * 10,
      tags: [],
      due_date: isoDay,
      due_start: '09:00:00',
      due_end: '10:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      id_short: 701 + index,
      slug: `multi-hidden-reveal-card-${index + 1}`,
      created_at: timestamp,
      updated_at: timestamp,
    }));

    const { error: insertError } = await supabaseAdmin.from('cards').insert(cards);
    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      await page.getByTestId('timeline-toolbar-range-plus').click();
      await expect(page.getByTestId(`timeline-hide-day-${days[0]}`)).toHaveCount(0);
      await expect(page.getByTestId(`timeline-hide-day-${days[1]}`)).toHaveCount(0);
      await expect(page.getByTestId(`timeline-hide-day-${days[2]}`)).toHaveCount(0);
      await expect(page.getByTestId(`timeline-reveal-right-${days[3]}-${days[2]}`)).toHaveCount(0);
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', cards.map((card) => card.id));
    }
  });

  test('desktop timeline opens with the Today header visible and stays anchored near today', async ({ page }) => {
    test.skip(!boardContext, 'Missing board context for timeline spec');
    const consoleErrors = attachConsoleErrorCollector(page);

    try {
      await page.goto(boardContext!.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext!.boardName })).toBeVisible();

      const todayHeader = page.locator('text=/Today\\s+\\d{2}\\/\\d{2}/').first();
      await expect(todayHeader).toBeVisible({ timeout: 20_000 });

      await page.waitForTimeout(500);
      await expect(todayHeader).toBeVisible();
      consoleErrors.assertClean();
    } finally {
      consoleErrors.dispose();
    }
  });

  test('desktop timeline toolbar keeps URL date and header label in sync', async ({ page }) => {
    test.skip(!boardContext, 'Missing board context for timeline spec');
    const consoleErrors = attachConsoleErrorCollector(page);
    const todayIso = isoDateJst();
    const tomorrowIso = shiftIsoDateJst(1);
    const readHorizontalAlignment = async () =>
      page.getByTestId('desktop-timeline-horizontal-scroll').evaluate((element) => {
        if (!(element instanceof HTMLDivElement)) {
          throw new Error('desktop timeline horizontal scroller not found');
        }
        const firstDayHeader = element.querySelector('[class*="grid"] > div');
        if (!(firstDayHeader instanceof HTMLElement)) {
          throw new Error('desktop timeline day header not found');
        }
        return {
          scrollLeft: element.scrollLeft,
          columnWidth: firstDayHeader.offsetWidth,
        };
      });

    try {
      await page.goto(boardContext!.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext!.boardName })).toBeVisible();

      await page.getByTestId('timeline-toolbar-next-day').click();
      await expect(page).toHaveURL(new RegExp(`date=${tomorrowIso}`), { timeout: 20_000 });
      await expect(page.locator(`text=${formatHeaderDateLabel(tomorrowIso)}`).first()).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => {
          const { scrollLeft, columnWidth } = await readHorizontalAlignment();
          return Math.abs(scrollLeft / columnWidth - Math.round(scrollLeft / columnWidth));
        })
        .toBeLessThan(0.01);

      await page.getByTestId('timeline-toolbar-prev-day').click();
      await expect(page).toHaveURL(new RegExp(`date=${todayIso}`), { timeout: 20_000 });
      await expect(page.locator(`text=/Today\\s+${formatHeaderDateLabel(todayIso).replace('/', '\\/')}/`).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(async () => {
          const { scrollLeft, columnWidth } = await readHorizontalAlignment();
          return Math.abs(scrollLeft / columnWidth - Math.round(scrollLeft / columnWidth));
        })
        .toBeLessThan(0.01);

      consoleErrors.assertClean();
    } finally {
      consoleErrors.dispose();
    }
  });

  test('supports shift-click multi select within the same timeline lane and switches between bulk and single menus', async ({ page }) => {
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
        title: 'Shift select lane card 1',
        due_start: '09:00:00',
        due_end: '10:00:00',
        position: 1600,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 531,
        slug: 'shift-select-lane-card-1',
      },
      {
        id: crypto.randomUUID(),
        title: 'Shift select lane card 2',
        due_start: '10:30:00',
        due_end: '11:30:00',
        position: 1610,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 532,
        slug: 'shift-select-lane-card-2',
      },
      {
        id: crypto.randomUUID(),
        title: 'Shift select lane card 3',
        due_start: '12:00:00',
        due_end: '13:00:00',
        position: 1620,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: 533,
        slug: 'shift-select-lane-card-3',
      },
    ].map((card) => ({
      ...card,
      checklist: { version: 1, lines: [] },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      tags: [],
      due_date: isoDay,
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      created_at: timestamp,
      updated_at: timestamp,
    }));

    const { error: insertError } = await supabaseAdmin.from('cards').insert(cards);
    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const firstCard = page.locator(`[data-card-id="${cards[0].id}"]`).first();
      const secondCard = page.locator(`[data-card-id="${cards[1].id}"]`).first();
      const thirdCard = page.locator(`[data-card-id="${cards[2].id}"]`).first();

      await expect(firstCard).toBeVisible({ timeout: 20_000 });
      await expect(secondCard).toBeVisible({ timeout: 20_000 });
      await expect(thirdCard).toBeVisible({ timeout: 20_000 });

      await firstCard.click();
      await page.keyboard.down('Shift');
      await secondCard.click();
      await page.keyboard.up('Shift');

      await expect(firstCard).toHaveAttribute('data-selected', 'true');
      await expect(secondCard).toHaveAttribute('data-selected', 'true');

      await secondCard.click({ button: 'right' });
      const menu = page.getByRole('menu', { name: 'カード操作メニュー' });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'すべて完了にする' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'カードを開く' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();

      await thirdCard.click({ button: 'right' });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'カードを開く' })).toBeVisible();
      await expect(firstCard).not.toHaveAttribute('data-selected', 'true');
      await expect(secondCard).not.toHaveAttribute('data-selected', 'true');
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', cards.map((card) => card.id));
    }
  });

  test('supports shift-click multi select in bucket B and overdue lanes', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const todayIso = isoDateJst();
    const overdueIso = shiftIsoDateJst(-1);
    const timestamp = new Date().toISOString();
    const cards = [
      {
        id: crypto.randomUUID(),
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 400,
        slug: 'multi-select-bucket-b-1',
        title: 'Bucket B 1',
        position: 3100,
        due_date: todayIso,
        due_bucket: 'b',
        due_bucket_position: 4100,
      },
      {
        id: crypto.randomUUID(),
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 401,
        slug: 'multi-select-bucket-b-2',
        title: 'Bucket B 2',
        position: 3200,
        due_date: todayIso,
        due_bucket: 'b',
        due_bucket_position: 4200,
      },
      {
        id: crypto.randomUUID(),
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 402,
        slug: 'multi-select-bucket-b-3',
        title: 'Bucket B 3',
        position: 3300,
        due_date: todayIso,
        due_bucket: 'b',
        due_bucket_position: 4300,
      },
      {
        id: crypto.randomUUID(),
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 403,
        slug: 'multi-select-overdue-1',
        title: 'Overdue 1',
        position: 3400,
        due_date: overdueIso,
        due_bucket: 'b',
        due_bucket_position: 4400,
      },
      {
        id: crypto.randomUUID(),
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 404,
        slug: 'multi-select-overdue-2',
        title: 'Overdue 2',
        position: 3500,
        due_date: overdueIso,
        due_bucket: 'a',
        due_bucket_position: 4500,
      },
    ].map((card) => ({
      ...card,
      checklist: { version: 1, lines: [] },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      tags: [],
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      created_at: timestamp,
      updated_at: timestamp,
    }));

    const { error: insertError } = await supabaseAdmin.from('cards').insert(cards);
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const bucketOne = page.locator(`[data-card-id="${cards[0].id}"]`).first();
      const bucketTwo = page.locator(`[data-card-id="${cards[1].id}"]`).first();
      const bucketThree = page.locator(`[data-card-id="${cards[2].id}"]`).first();
      const overdueOne = page.locator(`[data-testid="overdue-card-${cards[3].id}"]:visible [data-card-id="${cards[3].id}"]`).first();
      const overdueTwo = page.locator(`[data-testid="overdue-card-${cards[4].id}"]:visible [data-card-id="${cards[4].id}"]`).first();

      await expect(bucketOne).toBeVisible({ timeout: 20_000 });
      await expect(bucketTwo).toBeVisible({ timeout: 20_000 });
      await expect(bucketThree).toBeVisible({ timeout: 20_000 });
      await expect(overdueOne).toBeVisible({ timeout: 20_000 });
      await expect(overdueTwo).toBeVisible({ timeout: 20_000 });

      await bucketOne.click();
      await page.keyboard.down('Shift');
      await bucketTwo.click();
      await bucketThree.click();
      await page.keyboard.up('Shift');

      await expect(bucketOne).toHaveAttribute('data-selected', 'true');
      await expect(bucketTwo).toHaveAttribute('data-selected', 'true');
      await expect(bucketThree).toHaveAttribute('data-selected', 'true');

      await page.mouse.click(24, 24);
      await expect(bucketOne).not.toHaveAttribute('data-selected', 'true');
      await expect(bucketTwo).not.toHaveAttribute('data-selected', 'true');
      await expect(bucketThree).not.toHaveAttribute('data-selected', 'true');

      await overdueOne.click();
      await page.keyboard.down('Shift');
      await overdueTwo.click();
      await page.keyboard.up('Shift');

      await expect(overdueOne).toHaveAttribute('data-selected', 'true');
      await expect(overdueTwo).toHaveAttribute('data-selected', 'true');
      await page
        .getByTestId('desktop-sidebar-overdue-panel')
        .getByTestId(`cardOpenButton-overdue-${cards[3].id}`)
        .click();
      await expect(page).toHaveURL(new RegExp(`mp=timeline`));
      await expect(page).toHaveURL(new RegExp(`date=${overdueIso}`));
      const focusedTimelineCard = page.locator(`[data-focus-group="timeline"][data-focus-part="card"][data-card-id="${cards[3].id}"]`).first();
      await expect(focusedTimelineCard).toBeVisible({ timeout: 20_000 });
      await expect(focusedTimelineCard).toBeFocused();
      await expect(page.getByTestId('card-peek-root')).toHaveCount(0);
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', cards.map((card) => card.id));
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
      expect(sortedSplitLeftsDesktop[2]).toBeGreaterThan(2);
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
      await expect(cardDetailRoot(page)).not.toBeVisible({ timeout: 500 });

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
      await expect(cardDetailRoot(page)).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(cardDetailRoot(page)).not.toBeVisible({ timeout: 10_000 });

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
      expect(sortedSplitLeftsMobile[2]).toBeGreaterThan(2);
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

  test('renders completed bucket cards separately and preserves keyboard interactions', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const todayIso = isoDateJst();
    const activeACardId = crypto.randomUUID();
    const activeBCardId = crypto.randomUUID();
    const completedBCardId = crypto.randomUUID();
    const completedEventCardId = crypto.randomUUID();
    const activeAShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const activeBShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const completedBShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const completedEventShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      {
        id: activeACardId,
        title: 'Completed flow active A',
        checklist: { version: 1, lines: [] },
        excerpt: 'active a card for completed flow',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2100,
        tags: ['completed-flow'],
        due_date: todayIso,
        due_start: null,
        due_end: null,
        due_bucket: 'a',
        due_bucket_position: 2500,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: activeAShortId,
        id_short: Math.floor(Math.random() * 100000) + 1200,
        slug: 'completed-flow-active-a',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: activeBCardId,
        title: 'Completed flow active B',
        checklist: { version: 1, lines: [] },
        excerpt: 'active b card for completed flow',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2200,
        tags: ['completed-flow'],
        due_date: todayIso,
        due_start: null,
        due_end: null,
        due_bucket: 'b',
        due_bucket_position: 3000,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: activeBShortId,
        id_short: Math.floor(Math.random() * 100000) + 1201,
        slug: 'completed-flow-active-b',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: completedBCardId,
        title: 'Completed flow done B',
        checklist: { version: 1, lines: [] },
        excerpt: 'completed b card for completed flow',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2300,
        tags: ['completed-flow'],
        due_date: todayIso,
        due_start: null,
        due_end: null,
        due_bucket: 'b',
        due_bucket_position: 1000,
        checked: true,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: completedBShortId,
        id_short: Math.floor(Math.random() * 100000) + 1202,
        slug: 'completed-flow-done-b',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: completedEventCardId,
        title: 'Completed flow done event',
        checklist: { version: 1, lines: [] },
        excerpt: 'completed timeline event for completed flow',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2400,
        tags: ['completed-flow'],
        due_date: todayIso,
        due_start: '09:00',
        due_end: '10:00',
        due_bucket: 'a',
        due_bucket_position: 900,
        checked: true,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: completedEventShortId,
        id_short: Math.floor(Math.random() * 100000) + 1203,
        slug: 'completed-flow-done-event',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      const initialSearchToggle = page.getByTestId('desktop-sidebar-search-panel-toggle');
      if ((await initialSearchToggle.getAttribute('aria-expanded')) === 'true') {
        await initialSearchToggle.click();
      }
      await page.getByRole('button', { name: 'Timeline' }).click();

      const activeACard = page.getByTestId(`ab-card-${activeACardId}`).first();
      await expect(activeACard).toBeVisible({ timeout: 20_000 });
      const toggleA = page.getByTestId(`bucket-toggle-a-${todayIso}`).first();
      const toggleB = page.getByTestId(`bucket-toggle-b-${todayIso}`).first();
      const completedToggle = page.getByTestId(`bucket-toggle-completed-${todayIso}`).first();
      const countA = page.getByTestId(`bucket-count-a-${todayIso}`).first();
      const countB = page.getByTestId(`bucket-count-b-${todayIso}`).first();
      const completedCount = page.getByTestId(`bucket-count-completed-${todayIso}`).first();
      const sectionA = page.getByTestId(`bucket-section-a-${todayIso}`).first();
      const sectionB = page.getByTestId(`bucket-section-b-${todayIso}`).first();
      const sectionCompleted = page.getByTestId(`bucket-section-completed-${todayIso}`).first();
      const sectionAScroller = sectionA.locator('[data-ab-scroll-container="true"]').first();
      const sectionBScroller = sectionB.locator('[data-ab-scroll-container="true"]').first();
      const completedTimelineEvent = page.locator(`.timeline-col [data-card-id="${completedEventCardId}"]`).first();

      await expect(toggleA).toHaveAttribute('aria-pressed', 'true');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'false');
      await expect(completedToggle).toHaveAttribute('aria-pressed', 'false');
      await expect(countA).toHaveText('1');
      await expect(countB).toHaveText('1');
      await expect(completedCount).toHaveText('2/4');
      await expect(page.getByTestId(`ab-card-${activeBCardId}`).first()).toBeVisible({ timeout: 20_000 });
      await expect(completedTimelineEvent).toBeVisible({ timeout: 20_000 });
      await expect(completedTimelineEvent).toHaveAttribute('data-checked-visual', 'timeline-dim');
      await expect(completedTimelineEvent.locator('[role="checkbox"]').first()).toHaveAttribute('data-checkbox-tone', 'success');
      await expect(sectionB.locator('[data-dnd="ab-bucket"]')).toHaveCount(1);
      await expect(sectionCompleted.locator('[data-dnd="ab-bucket"]')).toHaveCount(0);
      await expect(sectionCompleted).toContainText('Completed');
      const initialCompletedBox = await sectionCompleted.boundingBox();
      const initialABox = await sectionA.boundingBox();
      expect(initialCompletedBox).not.toBeNull();
      expect(initialABox).not.toBeNull();
      expect((initialCompletedBox?.y ?? 0) < (initialABox?.y ?? 0)).toBe(true);
      const aScrollMetrics = await getScrollMetrics(sectionAScroller);
      const bScrollMetrics = await getScrollMetrics(sectionBScroller);
      expect(aScrollMetrics.scrollHeight - aScrollMetrics.clientHeight).toBeLessThanOrEqual(16);
      expect(bScrollMetrics.clientHeight).toBeGreaterThan(0);

      await expect(toggleA).toHaveAttribute('aria-pressed', 'true');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'false');

      await toggleB.click();
      await expect(toggleA).toHaveAttribute('aria-pressed', 'false');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`ab-card-${activeBCardId}`).first()).toBeVisible();
      await expect(sectionB.locator('[data-dnd="ab-bucket"]')).toHaveCount(1);

      await toggleB.click();
      await expect(toggleA).toHaveAttribute('aria-pressed', 'false');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'true');

      await completedToggle.click();
      await expect(toggleA).toHaveAttribute('aria-pressed', 'false');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'true');
      await expect(completedToggle).toHaveAttribute('aria-pressed', 'true');
      const completedBCard = page.getByTestId(`completed-card-${completedBCardId}`).first();
      const completedEventCard = page.getByTestId(`completed-card-${completedEventCardId}`).first();
      await expect(completedBCard).toBeVisible();
      await expect(completedEventCard).toBeVisible();
      await expect(completedEventCard).toContainText('09:00');
      await expect(page.getByTestId(`completed-badge-${completedBCardId}`)).toHaveText('B');
      await expect(page.getByTestId(`completed-badge-${completedEventCardId}`)).toHaveText('A');
      await page.getByTestId(`cardOpenButton-timeline-${completedEventCardId}`).click();
      await expect(page.getByTestId('card-peek-root')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('card-peek-root')).toBeHidden();
      await expect(page.getByTestId(`ab-card-${activeACardId}`).first()).toBeVisible();
      await expect(page.getByTestId(`ab-card-${activeBCardId}`).first()).toBeVisible();

      const completedBFocusable = page.locator(`[data-testid="completed-card-${completedBCardId}"] [data-card-id="${completedBCardId}"]`);
      await completedBFocusable.focus();
      await expect(completedBFocusable).toBeFocused();
      await page.keyboard.press('Escape');
      const cardMenu = page.getByRole('menu', { name: 'カード操作メニュー' });
      await expect(cardMenu).toBeVisible();
      await expect(cardMenu.getByRole('menuitem', { name: 'カードを開く' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(cardMenu.getByRole('menuitem', { name: '完了にする' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(cardMenu).toBeHidden();
      await expect(completedBFocusable).toBeFocused();

      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute('aria-pressed', 'true');

      await activeACard.locator('[role="checkbox"]').click();
      await expect(activeACard).toBeHidden({ timeout: 20_000 });
      await expect(countA).toHaveText('0');
      await expect(completedCount).toHaveText('3/4');
      await expect(toggleA).toHaveAttribute('aria-pressed', 'false');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`ab-card-${activeBCardId}`).first()).toBeVisible({ timeout: 20_000 });
      await expect(completedToggle).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`completed-card-${activeACardId}`)).toBeVisible({ timeout: 20_000 });

      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`completed-card-${activeACardId}`)).toBeVisible();
      await expect(page.getByTestId(`completed-badge-${activeACardId}`)).toHaveText('A');

      const completedAFocusable = page.locator(`[data-testid="completed-card-${activeACardId}"] [data-card-id="${activeACardId}"]`);
      await completedAFocusable.focus();
      await page.keyboard.press('Space');

      await expect(page.getByTestId(`completed-card-${activeACardId}`)).toBeHidden({ timeout: 20_000 });
      await expect(completedCount).toHaveText('2/4');
      await expect(completedToggle).toHaveAttribute('aria-pressed', 'true');

      const completedEventFocusable = page.locator(`[data-testid="completed-card-${completedEventCardId}"] [data-card-id="${completedEventCardId}"]`);
      await completedEventFocusable.focus();
      await page.keyboard.press('Space');
      await expect(page.getByTestId(`completed-card-${completedEventCardId}`)).toBeHidden({ timeout: 20_000 });
      await expect(completedCount).toHaveText('1/4');
      await expect(completedTimelineEvent).not.toHaveAttribute('data-checked-visual', 'timeline-dim');

      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute('aria-pressed', 'true');
      await expect(toggleA).toHaveAttribute('aria-pressed', 'false');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`ab-card-${activeACardId}`).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [activeACardId, activeBCardId, completedBCardId, completedEventCardId]);
    }
  });

  test('promotes the first non-empty bucket section when A is empty', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const bOnlyIso = shiftIsoDateJst(1);
    const bOnlyCardId = crypto.randomUUID();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: bOnlyCardId,
      title: 'Accordion default B only',
      checklist: { version: 1, lines: [] },
      excerpt: 'b only card for accordion default state',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 2600,
      tags: ['accordion-default'],
      due_date: bOnlyIso,
      due_start: null,
      due_end: null,
      due_bucket: 'b',
      due_bucket_position: 2600,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      id_short: Math.floor(Math.random() * 100000) + 1250,
      slug: 'accordion-default-b-only',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      const initialSearchToggle = page.getByTestId('desktop-sidebar-search-panel-toggle');
      if ((await initialSearchToggle.getAttribute('aria-expanded')) === 'true') {
        await initialSearchToggle.click();
      }
      await page.getByRole('button', { name: 'Timeline' }).click();

      const bOnlyToggleA = page.getByTestId(`bucket-toggle-a-${bOnlyIso}`).first();
      const bOnlyToggleB = page.getByTestId(`bucket-toggle-b-${bOnlyIso}`).first();
      const bOnlyToggleCompleted = page.getByTestId(`bucket-toggle-completed-${bOnlyIso}`).first();
      await expect(bOnlyToggleA).toHaveAttribute('aria-pressed', 'false');
      await expect(bOnlyToggleB).toHaveAttribute('aria-pressed', 'true');
      await expect(bOnlyToggleCompleted).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId(`bucket-count-a-${bOnlyIso}`)).toHaveText('0');
      await expect(page.getByTestId(`bucket-count-b-${bOnlyIso}`)).toHaveText('1');
      await expect(page.getByTestId(`bucket-count-completed-${bOnlyIso}`)).toHaveText('0/1');
      await expect(page.getByTestId(`ab-card-${bOnlyCardId}`).first()).toBeVisible({ timeout: 20_000 });

      const { error: updateError } = await supabaseAdmin
        .from('cards')
        .update({ checked: true, updated_at: new Date().toISOString() })
        .eq('id', bOnlyCardId);
      expect(updateError).toBeNull();

      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      const searchToggleAfterReload = page.getByTestId('desktop-sidebar-search-panel-toggle').first();
      if ((await searchToggleAfterReload.getAttribute('aria-expanded')) === 'true') {
        await searchToggleAfterReload.click();
      }
      await page.getByRole('button', { name: 'Timeline' }).click();

      const completedOnlyToggleA = page.getByTestId(`bucket-toggle-a-${bOnlyIso}`).first();
      const completedOnlyToggleB = page.getByTestId(`bucket-toggle-b-${bOnlyIso}`).first();
      const completedOnlyToggleCompleted = page.getByTestId(`bucket-toggle-completed-${bOnlyIso}`).first();
      const completedOnlySection = page.getByTestId(`bucket-section-completed-${bOnlyIso}`).first();
      await expect(completedOnlyToggleA).toHaveAttribute('aria-pressed', 'false');
      await expect(completedOnlyToggleB).toHaveAttribute('aria-pressed', 'false');
      await expect(completedOnlyToggleCompleted).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`bucket-count-completed-${bOnlyIso}`)).toHaveText('1/1');
      await expect(page.getByTestId(`completed-card-${bOnlyCardId}`)).toBeVisible({ timeout: 20_000 });
      await expect(completedOnlySection).toContainText('Completed');

      await completedOnlyToggleCompleted.click();
      await expect(completedOnlyToggleCompleted).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`completed-card-${bOnlyCardId}`)).toBeVisible({ timeout: 20_000 });
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [bOnlyCardId]);
    }
  });

  test('shows a compact empty state only for non-priority empty buckets', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const compactIso = shiftIsoDateJst(1);
    const aCardId = crypto.randomUUID();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: aCardId,
      title: 'Compact empty A source card',
      checklist: { version: 1, lines: [] },
      excerpt: 'single A card to keep B empty and secondary',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 2700,
      tags: ['compact-empty'],
      due_date: compactIso,
      due_start: null,
      due_end: null,
      due_bucket: 'a',
      due_bucket_position: 2700,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      id_short: Math.floor(Math.random() * 100000) + 1260,
      slug: 'compact-empty-a-source',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      const initialSearchToggle = page.getByTestId('desktop-sidebar-search-panel-toggle');
      if ((await initialSearchToggle.getAttribute('aria-expanded')) === 'true') {
        await initialSearchToggle.click();
      }
      await page.getByRole('button', { name: 'Timeline' }).click();

      const toggleA = page.getByTestId(`bucket-toggle-a-${compactIso}`).first();
      const toggleB = page.getByTestId(`bucket-toggle-b-${compactIso}`).first();
      const sectionB = page.getByTestId(`bucket-section-b-${compactIso}`).first();

      await expect(toggleA).toHaveAttribute('aria-pressed', 'true');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'false');
      await expect(sectionB.locator('[data-testid^="ab-compact-empty-dropzone-"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(`bucket-compact-count-${compactIso}_b`).first()).toHaveText('1');
      await expect(sectionB.locator('[data-testid^="ab-empty-dropzone-"]')).toHaveCount(0);
      await expect(sectionB).not.toContainText('Drop or add card');

      await toggleB.click();

      await expect(toggleA).toHaveAttribute('aria-pressed', 'false');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'true');
      await expect(sectionB.locator('[data-testid^="ab-empty-dropzone-"]')).toBeVisible({ timeout: 20_000 });
      await expect(sectionB.locator('[data-testid^="ab-compact-empty-dropzone-"]')).toHaveCount(0);
      await expect(sectionB).toContainText('Drop or add card');
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [aCardId]);
    }
  });

  test('keeps the priority bucket visible and compresses the secondary bucket when space runs out', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const tallIso = shiftIsoDateJst(1);
    const tallACardIds = Array.from({ length: 6 }, () => crypto.randomUUID());
    const bCardId = crypto.randomUUID();
    const priorityCards = tallACardIds.map((cardId, index) => ({
      id: cardId,
      title: `Priority A ${index + 1}`,
      checklist: { version: 1, lines: [] },
      excerpt: `priority bucket card ${index + 1}`,
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 2800 + index * 10,
      tags: ['priority-height'],
      due_date: tallIso,
      due_start: null,
      due_end: null,
      due_bucket: 'a',
      due_bucket_position: 2800 + index * 10,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      id_short: Math.floor(Math.random() * 100000) + 1270 + index,
      slug: `priority-height-a-${index + 1}`,
      created_at: timestamp,
      updated_at: timestamp,
    }));

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      ...priorityCards,
      {
        id: bCardId,
        title: Array.from({ length: 32 }, (_, index) => `Secondary-B-${index}`).join(' '),
        checklist: { version: 1, lines: [] },
        excerpt: 'secondary bucket should collapse to header only',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2810,
        tags: ['priority-height'],
        due_date: tallIso,
        due_start: null,
        due_end: null,
        due_bucket: 'b',
        due_bucket_position: 2810,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 1271,
        slug: 'priority-height-b',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 480 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      const initialSearchToggle = page.getByTestId('desktop-sidebar-search-panel-toggle');
      if ((await initialSearchToggle.getAttribute('aria-expanded')) === 'true') {
        await initialSearchToggle.click();
      }
      await page.getByRole('button', { name: 'Timeline' }).click();

      const toggleA = page.getByTestId(`bucket-toggle-a-${tallIso}`).first();
      const toggleB = page.getByTestId(`bucket-toggle-b-${tallIso}`).first();
      const sectionA = page.getByTestId(`bucket-section-a-${tallIso}`).first();
      const sectionB = page.getByTestId(`bucket-section-b-${tallIso}`).first();
      const sectionAScroller = sectionA.locator('[data-ab-scroll-container="true"]').first();
      const sectionBScroller = sectionB.locator('[data-ab-scroll-container="true"]').first();

      await expect(page.getByTestId(`ab-card-${tallACardIds[0]}`).first()).toBeVisible({ timeout: 20_000 });
      await expect(toggleA).toHaveAttribute('aria-pressed', 'true');
      await expect(toggleB).toHaveAttribute('aria-pressed', 'false');

      const aMetrics = await getScrollMetrics(sectionAScroller);
      const bMetrics = await getScrollMetrics(sectionBScroller);
      expect(aMetrics.scrollHeight).toBeGreaterThan(aMetrics.clientHeight);
      expect(bMetrics.clientHeight).toBeLessThanOrEqual(71);
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [...tallACardIds, bCardId]);
    }
  });

  test('keeps closed A/B buckets droppable and shows a hover line', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const sourceIso = isoDateJst();
    const targetIso = shiftIsoDateJst(1);
    const sourceCardId = crypto.randomUUID();
    const targetACardId = crypto.randomUUID();
    const targetBCardId = crypto.randomUUID();

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      {
        id: sourceCardId,
        title: 'Closed drop source A',
        checklist: { version: 1, lines: [] },
        excerpt: 'source card for closed bucket drop',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2700,
        tags: ['accordion-drop'],
        due_date: sourceIso,
        due_start: null,
        due_end: null,
        due_bucket: 'a',
        due_bucket_position: 2700,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 1400,
        slug: 'closed-drop-source-a',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: targetACardId,
        title: 'Closed drop target A',
        checklist: { version: 1, lines: [] },
        excerpt: 'target day active A card',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2710,
        tags: ['accordion-drop'],
        due_date: targetIso,
        due_start: null,
        due_end: null,
        due_bucket: 'a',
        due_bucket_position: 2710,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 1401,
        slug: 'closed-drop-target-a',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: targetBCardId,
        title: 'Closed drop target B',
        checklist: { version: 1, lines: [] },
        excerpt: 'target day closed B card',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2720,
        tags: ['accordion-drop'],
        due_date: targetIso,
        due_start: null,
        due_end: null,
        due_bucket: 'b',
        due_bucket_position: 2720,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 1402,
        slug: 'closed-drop-target-b',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      const initialSearchToggle = page.getByTestId('desktop-sidebar-search-panel-toggle');
      if ((await initialSearchToggle.getAttribute('aria-expanded')) === 'true') {
        await initialSearchToggle.click();
      }
      await page.getByRole('button', { name: 'Timeline' }).click();

      const sourceCard = page.getByTestId(`ab-card-${sourceCardId}`).first();
      const targetToggleA = page.getByTestId(`bucket-toggle-a-${targetIso}`).first();
      const targetToggleB = page.getByTestId(`bucket-toggle-b-${targetIso}`).first();
      const targetSectionB = page.getByTestId(`bucket-section-b-${targetIso}`).first();
      const targetCountB = page.getByTestId(`bucket-count-b-${targetIso}`).first();

      await expect(sourceCard).toBeVisible({ timeout: 20_000 });
      await expect(targetToggleA).toHaveAttribute('aria-pressed', 'true');
      await expect(targetToggleB).toHaveAttribute('aria-pressed', 'false');
      await expect(targetSectionB.locator('[data-dnd="ab-bucket"]')).toHaveCount(1);

      const targetBucketViewport = targetSectionB.locator('[data-ab-scroll-container="true"]').first();
      const targetBucketBox = await targetBucketViewport.boundingBox();
      if (!targetBucketBox) {
        throw new Error('Missing B bucket bounds');
      }

      const patchResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'PATCH' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${sourceCardId}`)
        );
      }, { timeout: 20_000 });

      await dragLocatorToPoint(page, sourceCard, {
        x: targetBucketBox.x + targetBucketBox.width * 0.5,
        y: targetBucketBox.y + Math.min(32, targetBucketBox.height * 0.35),
      });
      await expect(targetSectionB.locator('.bg-sky-500').first()).toBeVisible();

      const [patchResponse] = await Promise.all([
        patchResponsePromise,
        page.mouse.up(),
      ]);
      expect(patchResponse.ok(), `closed bucket PATCH failed: ${patchResponse.status()}`).toBeTruthy();

      await expect(targetCountB).toHaveText('2', { timeout: 20_000 });

      await targetToggleB.click();
      await expect(targetToggleB).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`ab-card-${sourceCardId}`).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [sourceCardId, targetACardId, targetBCardId]);
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
      const timelineTab = page.getByRole('button', { name: 'Timeline' });
      const sidebarShell = page.getByTestId('desktop-sidebar-shell');
      const mainPanel = page.getByTestId('desktop-main-panel');

      await expect(overdueToggle).toBeVisible();
      await expect(overdueCount).toHaveText('1');
      await expect(sidebarShell).toBeVisible();
      await expect(mainPanel).toBeVisible();
      await expect(timelineTab).toHaveAttribute('aria-current', 'page');
      const searchPanel = page.getByTestId('desktop-sidebar-search-panel');
      const searchCount = page.getByTestId('desktop-sidebar-search-panel-count');
      const searchInput = page.getByTestId('desktop-sidebar-search-input');

      await expect(searchPanel).toBeHidden();
      await expect(searchCount).toHaveText('0');

      await searchToggle.click();
      await expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(searchPanel).toBeVisible();
      await expect(searchInput).toBeVisible();
      await expect(timelineTab).toHaveAttribute('aria-current', 'page');
      await expect(overdueToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(overduePanel).toBeHidden();

      await searchInput.fill('Sidebar Search');

      await expect(searchCount).toHaveText('2');
      await expect(overdueCount).toHaveText('1');
      await expect(timelineTab).toHaveAttribute('aria-current', 'page');
      await expect(page.locator(`[data-testid="search-card-overdue-${overdueCardId}"]:visible`).first()).toBeVisible();
      await expect(page.locator(`[data-testid="search-card-bucket-${bucketCardId}"]:visible`).first()).toBeVisible();

      const listTab = page.getByRole('button', { name: 'List' });
      await listTab.click();
      await expect(listTab).toHaveAttribute('aria-current', 'page');

      await overdueToggle.click();
      await expect(overdueToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(overduePanel).toBeVisible();
      await expect(overdueCount).toHaveText('1');
      await expect(searchPanel).toBeHidden();

      await searchToggle.click();
      await expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(searchPanel).toBeVisible();
      await page.getByTestId(`cardOpenButton-search-${bucketCardId}`).click();
      await expect(page.getByTestId('card-peek-root')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('card-peek-root')).toBeHidden();
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [overdueCardId, bucketCardId]);
    }
  });

  test('shows invalid url UI and resets to canonical default', async ({ page }) => {
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${boardContext.canonicalPath}?pp=overdue`);

    await expect(page.getByRole('heading', { name: 'Invalid/legacy URL' })).toBeVisible();
    await expect(page.getByText('MISSING_MP')).toBeVisible();

    await page.getByRole('button', { name: 'URLをリセット' }).click();
    await expect(page).toHaveURL(new RegExp(`\\?pp=overdue&mp=timeline$`));
    await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
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

  test('renames desktop list titles inline without opening the modal and keeps mobile list read-only', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const initialTitle = 'Desktop list inline title';
    const renamedTitle = 'Desktop list renamed';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: initialTitle,
      checklist: { version: 1, lines: [] },
      excerpt: 'desktop list inline edit card',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1830,
      tags: [],
      due_date: isoDateJst(),
      due_start: null,
      due_end: null,
      due_bucket: 'a',
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: Math.floor(Math.random() * 100000) + 950,
      slug: 'desktop-list-inline-title',
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(`${boardContext.canonicalPath}?pp=overdue&mp=list`);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const listCard = page.locator(`[data-card-id="${cardId}"]`).first();
      await expect(listCard).toBeVisible({ timeout: 20_000 });

      const titleDisplay = listCard.getByTestId('timeline-card-title-display');
      await expect(titleDisplay).toContainText(initialTitle);

      let renameRequests = 0;
      await page.route(new RegExp(`/api/boards/${boardContext.boardId}/cards/${cardId}$`), async (route) => {
        if (route.request().method() === 'PATCH') {
          renameRequests += 1;
        }
        await route.continue();
      });

      await titleDisplay.click();
      const titleInput = listCard.getByTestId('timeline-card-title-input');
      await expect(titleInput).toBeVisible();
      await expect(page.getByTestId('card-peek-root')).toHaveCount(0);

      await titleInput.fill(renamedTitle);
      await titleInput.dispatchEvent('compositionstart');
      await titleInput.press('Enter');
      await expect(titleInput).toBeVisible();
      await expect.poll(() => renameRequests).toBe(0);

      const renameRequestPromise = page.waitForRequest((request) => {
        return request.method() === 'PATCH' && request.url().includes(`/api/boards/${boardContext?.boardId}/cards/${cardId}`);
      });

      await titleInput.dispatchEvent('compositionend');
      await titleInput.press('Enter');

      const renameRequest = await renameRequestPromise;
      const renamePayload = renameRequest.postDataJSON() as Record<string, unknown>;
      expect(renamePayload).toMatchObject({
        title: renamedTitle,
        slug: 'desktop-list-renamed',
      });
      expect(renamePayload).not.toHaveProperty('content');
      expect(renamePayload).not.toHaveProperty('excerpt');

      await expect(listCard.getByTestId('timeline-card-title-display')).toContainText(renamedTitle);
      await expect(listCard).toBeFocused();

      await page.getByTestId('desktop-sidebar-overdue-panel-toggle').focus();
      await listCard.click({ position: { x: 24, y: 24 } });
      await expect(page.getByTestId('card-peek-root')).toHaveCount(0);
      await listCard.getByTestId(`cardOpenButton-overdue-${cardId}`).click();
      await expect(page.getByTestId('card-peek-root')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('card-peek-root')).toBeHidden();

      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto(`${boardContext.canonicalPath}?pp=overdue&mp=list`);
      const mobileCard = page.locator(`[data-card-id="${cardId}"]:visible`).first();
      await expect(mobileCard).toBeVisible({ timeout: 20_000 });
      await mobileCard.getByTestId('timeline-card-title-display').click();
      await expect(mobileCard.getByTestId('timeline-card-title-input')).toHaveCount(0);
      await mobileCard.getByTestId(`cardOpenButton-overdue-${cardId}`).click();
      await expect(page.getByTestId('card-peek-root')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('card-peek-root')).toBeHidden();
    } finally {
      await page.unroute(new RegExp(`/api/boards/${boardContext.boardId}/cards/${cardId}$`));
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('rolls back overdue title inline rename when the PATCH fails', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const overdueCardId = crypto.randomUUID();
    const overdueShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const originalTitle = 'Desktop overdue rename rollback';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: overdueCardId,
      title: originalTitle,
      checklist: { version: 1, lines: [] },
      excerpt: 'desktop overdue rename rollback card',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1840,
      tags: [],
      due_date: shiftIsoDateJst(-2),
      due_start: null,
      due_end: null,
      due_bucket: 'a',
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: overdueShortId,
      id_short: Math.floor(Math.random() * 100000) + 960,
      slug: 'desktop-overdue-rename-rollback',
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.route(new RegExp(`/api/boards/${boardContext.boardId}/cards/${overdueCardId}$`), async (route) => {
        if (route.request().method() === 'PATCH') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'rename failed' } }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      await page.getByTestId('desktop-sidebar-overdue-panel-toggle').click();

      const overdueCard = page.locator(`[data-testid="overdue-card-${overdueCardId}"]:visible [data-card-id="${overdueCardId}"]`).first();
      await expect(overdueCard).toBeVisible({ timeout: 20_000 });

      await overdueCard.getByTestId('timeline-card-title-display').click();
      const titleInput = overdueCard.getByTestId('timeline-card-title-input');
      await expect(titleInput).toBeVisible();
      await titleInput.fill('Desktop overdue rename failed');
      await titleInput.press('Enter');

      await expect(overdueCard.getByTestId('timeline-card-title-display')).toContainText(originalTitle);
      await expect(overdueCard).toBeFocused();

      const { data: savedCard, error: fetchError } = await supabaseAdmin
        .from('cards')
        .select('title')
        .eq('id', overdueCardId)
        .maybeSingle();
      expect(fetchError).toBeNull();
      expect(savedCard?.title).toBe(originalTitle);
    } finally {
      await page.unroute(new RegExp(`/api/boards/${boardContext.boardId}/cards/${overdueCardId}$`));
      await supabaseAdmin.from('cards').delete().eq('id', overdueCardId);
    }
  });

  test('opens mobile timeline card from the inline open button without triggering drag selection flow', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const cardId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Mobile timeline open button',
      checklist: { version: 1, lines: [] },
      excerpt: 'mobile timeline icon open test',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1860,
      tags: [],
      due_date: isoDateJst(),
      due_start: '11:00',
      due_end: '12:00',
      due_bucket: 'a',
      due_bucket_position: 1860,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: Math.floor(Math.random() * 100000) + 980,
      slug: 'mobile-timeline-open-button',
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const mobileEvent = page.locator(`[data-card-id="${cardId}"]`).first();
      await mobileEvent.scrollIntoViewIfNeeded();
      await expect(mobileEvent).toBeVisible({ timeout: 20_000 });
      await mobileEvent.getByTestId(`cardOpenButton-mobile-timeline-${cardId}`).click();
      await expect(page.getByTestId('card-peek-root')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('card-peek-root')).toBeHidden();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('loads mobile timeline with a 3-day window on first paint', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }

    const consoleErrors = attachConsoleErrorCollector(page);
    const timelineRequests: string[] = [];
    const requestListener = (request: Request) => {
      if (request.method() === 'GET' && request.url().includes(`/api/boards/${boardContext?.boardId}/timeline`)) {
        timelineRequests.push(request.url());
      }
    };

    page.on('request', requestListener);
    try {
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      await expect(page.getByTestId('mobile-timeline-rail')).toBeVisible();
      await expect.poll(() => timelineRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);
      expect(timelineRequests[0]).toContain('range=3');
      consoleErrors.assertClean();
    } finally {
      page.off('request', requestListener);
      consoleErrors.dispose();
    }
  });

  test('moves mobile timeline between today and tomorrow and silently prefetches the missing previous day after returning', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const todayIso = isoDateJst();
    const tomorrowIso = shiftIsoDateJst(1);
    const todayCardId = crypto.randomUUID();
    const tomorrowCardId = crypto.randomUUID();
    const todayTitle = `Mobile swipe today ${Date.now()}`;
    const tomorrowTitle = `Mobile swipe tomorrow ${Date.now()}`;
    const consoleErrors = attachConsoleErrorCollector(page);

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      {
        id: todayCardId,
        title: todayTitle,
        checklist: { version: 1, lines: [] },
        excerpt: 'mobile swipe today card',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2100,
        tags: [],
        due_date: todayIso,
        due_start: '09:00',
        due_end: '10:00',
        due_bucket: 'a',
        due_bucket_position: 2100,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 1100,
        slug: 'mobile-swipe-today-card',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: tomorrowCardId,
        title: tomorrowTitle,
        checklist: { version: 1, lines: [] },
        excerpt: 'mobile swipe tomorrow card',
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 2200,
        tags: [],
        due_date: tomorrowIso,
        due_start: '09:00',
        due_end: '10:00',
        due_bucket: 'a',
        due_bucket_position: 2200,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 1200,
        slug: 'mobile-swipe-tomorrow-card',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const todayCard = page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: todayTitle }).first();
      const tomorrowCard = page.locator('[data-testid="timeline-event"]:visible').filter({ hasText: tomorrowTitle }).first();
      const nextDayButton = page.getByRole('button', { name: '次へ 1日' }).first();
      const prevDayButton = page.getByRole('button', { name: '前へ 1日' }).first();

      await expect(todayCard).toBeVisible({ timeout: 20_000 });

      const timelineRequests: string[] = [];
      const requestListener = (request: Request) => {
        if (request.method() === 'GET' && request.url().includes(`/api/boards/${boardContext?.boardId}/timeline`)) {
          timelineRequests.push(request.url());
        }
      };
      page.on('request', requestListener);

      await nextDayButton.click();
      await expect(tomorrowCard).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(800);
      expect(timelineRequests).toHaveLength(0);

      await prevDayButton.click();
      await expect(todayCard).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(800);
      expect(timelineRequests).toHaveLength(1);
      expect(timelineRequests[0]).toContain('start=-1');
      expect(timelineRequests[0]).toContain('range=3');
      consoleErrors.assertClean();

      page.off('request', requestListener);
    } finally {
      consoleErrors.dispose();
      await supabaseAdmin.from('cards').delete().in('id', [todayCardId, tomorrowCardId]);
    }
  });

  test('keeps mobile timeline stable across list and month round trips', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }

    const consoleErrors = attachConsoleErrorCollector(page);

    try {
      const timelineUrl = `${boardContext.canonicalPath}?pp=overdue&mp=timeline`;
      const listUrl = `${boardContext.canonicalPath}?pp=overdue&mp=list`;
      const monthUrl = `${boardContext.canonicalPath}?pp=overdue&mp=month`;
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto(timelineUrl);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      await expect(page.getByTestId('mobile-timeline-rail')).toBeVisible();
      await expect(page).toHaveURL(/mp=timeline/);

      await page.goto(listUrl);
      await expect(page).toHaveURL(/mp=list/);
      await expect(page.getByRole('textbox', { name: '基準日' }).last()).toBeVisible();

      await page.goto(monthUrl);
      await expect(page).toHaveURL(/mp=month/);
      await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();

      await page.goto(timelineUrl);
      await expect(page).toHaveURL(/mp=timeline/);
      await expect(page.getByTestId('mobile-timeline-rail')).toBeVisible();
      consoleErrors.assertClean();
    } finally {
      consoleErrors.dispose();
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

      const viewportSize = page.viewportSize();
      if (!viewportSize) {
        throw new Error('Missing viewport size for mobile overdue drag test');
      }

      let invalidDropPatchCount = 0;
      const invalidDropRequestHandler = (request: Request) => {
        if (
          request.method() === 'PATCH' &&
          request.url().includes(`/api/boards/${boardContext.boardId}/cards/${overdueCardId}`)
        ) {
          invalidDropPatchCount += 1;
        }
      };
      page.on('request', invalidDropRequestHandler);

      await dragLocatorToPoint(page, overdueCard, {
        x: viewportSize.width + 120,
        y: overdueBox.y + Math.max(18, overdueBox.height * 0.5),
      });
      await expect(overdueOverlay).toBeVisible();
      await page.mouse.up();
      await expect(overdueOverlay).toHaveCount(0);
      await expect(overdueCard).toBeVisible();
      await expect.poll(() => invalidDropPatchCount, { timeout: 1_500 }).toBe(0);
      page.off('request', invalidDropRequestHandler);

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

  test('scrolls inside the mobile overdue panel when overdue cards exceed the panel height', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const timestamp = new Date().toISOString();
    const overdueIso = shiftIsoDateJst(-1);
    const overdueCards = Array.from({ length: 18 }, (_, index) => {
      const suffix = `${Date.now()}-${index}`;
      return {
        id: crypto.randomUUID(),
        title: `Mobile overdue scroll ${suffix}`,
        checklist: {
          version: 1,
          lines: [
            { id: `line-${index}-0`, text: `Checklist ${index}-0`, checked: false },
            { id: `line-${index}-1`, text: `Checklist ${index}-1`, checked: false },
            { id: `line-${index}-2`, text: `Checklist ${index}-2`, checked: false },
          ],
        },
        excerpt: `mobile overdue scroll regression ${suffix}`,
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 4000 + index,
        tags: [],
        due_date: overdueIso,
        due_start: null,
        due_end: null,
        due_bucket: 'b' as const,
        due_bucket_position: 4000 + index,
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        id_short: Math.floor(Math.random() * 100000) + 30000 + index,
        slug: `mobile-overdue-scroll-${suffix}`,
        created_at: timestamp,
        updated_at: timestamp,
      };
    });

    const { error: insertError } = await supabaseAdmin.from('cards').insert(overdueCards);
    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 430, height: 932 });
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      await expect(page.getByTestId('mobile-left-panel-selector-trigger')).toHaveText(/overdue/i);

      const panelToggle = page.locator('button[aria-controls="mobile-left-panel-body"]').first();
      await expect(panelToggle).toBeVisible();
      if ((await panelToggle.getAttribute('aria-expanded')) !== 'true') {
        await panelToggle.click();
      }
      await expect(panelToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('mobile-left-panel-body')).toBeVisible();

      const scroller = page.locator('[data-testid="mobile-left-panel-shell"] [class*="overflow-y-auto"]').first();
      await expect(scroller).toBeVisible();

      const initialMetrics = await getScrollMetrics(scroller);
      expect(initialMetrics.clientHeight).toBeGreaterThan(0);
      expect(initialMetrics.scrollHeight).toBeGreaterThan(initialMetrics.clientHeight + 20);

      await swipeLocatorVertically(page, scroller, 'up');
      await page.waitForTimeout(250);

      await expect.poll(async () => {
        const metrics = await getScrollMetrics(scroller);
        return metrics.scrollTop;
      }, { timeout: 5_000 }).toBeGreaterThan(80);
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', overdueCards.map((card) => card.id));
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      let modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const firstMetrics = await readMetrics(modal);
      expect(firstMetrics.clientHeight).toBeGreaterThan(firstMetrics.lineHeight * 1.5);
      expect(firstMetrics.scrollWidth).toBeLessThanOrEqual(firstMetrics.clientWidth + 2);

      await page.goto(boardContext.canonicalPath);
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const sourceModal = cardDetailRoot(page);
      await expect(sourceModal).toBeVisible();
      const sourceEditor = sourceModal.locator('.ProseMirror[data-autofocus="true"]').first();

      await sourceEditor.click();
      const selectAllModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${selectAllModifier}+A`);
      const payload = await dispatchCopyEvent(page);
      expect(payload.plainText).toContain(':::details');

      await page.goto(`${boardContext.canonicalPath}?card=${targetShortId}`);
      const targetModal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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

  test('keeps sidebar reachable after pasting long multiline text in the modal body', async ({ page }) => {
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
      title: 'Sidebar resilience',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1701,
      tags: [],
      due_date: isoDay,
      due_start: '12:00:00',
      due_end: '13:00:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 503,
      slug: 'sidebar-resilience',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const openSidebarToggle = modal.locator('button[title="Show details"]');
      const closeSidebarToggle = modal.locator('button[title="Hide details"]');

      const longToken = 'LONGTOKEN'.repeat(80);
      const pastedText = [
        `1:${longToken}`,
        `2:${longToken}`,
        '3: 改行ありの長文でも右パネルを開けること',
        `4:${longToken}`,
        `5:${longToken}`,
      ].join('\n');

      await bodyEditor.click();
      await pastePlainText(page, pastedText);

      const commentsPanel = modal.getByTestId('comments-panel');

      if (await closeSidebarToggle.isVisible()) {
        await closeSidebarToggle.click();
        await expect(openSidebarToggle).toBeVisible();
      }

      await openSidebarToggle.click();
      await expect(closeSidebarToggle).toBeVisible();
      await expect(commentsPanel).toBeVisible();

      const modalBox = await modal.boundingBox();
      const panelBox = await commentsPanel.boundingBox();

      expect(modalBox).not.toBeNull();
      expect(panelBox).not.toBeNull();
      expect(panelBox!.x).toBeGreaterThanOrEqual(modalBox!.x - 1);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(modalBox!.x + modalBox!.width + 1);
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
      const modal = cardDetailRoot(page);
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
      const reopenedModal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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

  test('bridges title and body with ArrowDown and ArrowUp', async ({ page }) => {
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
      const modal = cardDetailRoot(page);
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

      await expect(modal.locator('.ProseMirror').first()).toBeFocused();
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
      await expect(titleInput).toBeFocused();
      await page.keyboard.type('Z');
      await expect(titleInput).toHaveValue('ArrowZ navigation baseline');
      await expect(firstChecklistLine).toHaveText('body line');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });


  test('inserts a leading paragraph and moves focus to body on Enter from title except during IME composition', async ({ page }) => {
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
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      await expect(titleInput).toHaveValue('Enter from title test');

      await titleInput.focus();
      await titleInput.dispatchEvent('compositionstart');
      await page.keyboard.press('Enter');
      await expect(titleInput).toBeFocused();
      await expect(titleInput).toHaveValue('Enter from title test');
      await expect(modal.locator('.ProseMirror > ul[data-type="taskList"]')).toHaveCount(0);
      await expect(modal.locator('div.tiptap.ProseMirror.prose.prose-slate').first()).toContainText('existing body text');
      await expect(modal.locator('.ProseMirror > p')).toHaveCount(1);

      await titleInput.dispatchEvent('compositionend');
      await page.keyboard.press('Enter');

      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const firstParagraph = modal.locator('.ProseMirror > p').nth(0);
      const secondParagraph = modal.locator('.ProseMirror > p').nth(1);

      await expect(bodyEditor).toBeFocused();
      await expect(firstParagraph).toBeVisible();
      await expect(firstParagraph).toHaveText('');
      await expect(secondParagraph).toContainText('existing body text');

    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('focuses the title field first when the modal opens with an empty title', async ({ page }) => {
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
      title: '',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body content' }] }],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1890,
      tags: [],
      due_date: isoDay,
      due_start: '14:35:00',
      due_end: '15:35:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 50365,
      slug: 'empty-title-initial-focus',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      await expect(titleInput).toHaveValue('');
      await expect(titleInput).toBeFocused();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('does not bridge title and body with ArrowRight or ArrowLeft', async ({ page }) => {
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
      const modal = cardDetailRoot(page);
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
      await expect(modal.locator('.ProseMirror').first()).toBeFocused();
      await page.keyboard.type('Q');
      await expect(firstChecklistLine).toHaveText('Qbody line');

      await firstChecklistLine.click({ position: { x: 4, y: 8 } });
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowLeft');
      await expect(titleInput).toBeFocused();
      await page.keyboard.type('Y');
      await expect(titleInput).toHaveValue('Arrow LR baselineY');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves focus to title end without changing body when Backspace is pressed at the start of the first body line', async ({ page }) => {
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
      title: 'Backspace bridge baseline',
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
      due_start: '14:45:00',
      due_end: '15:45:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 50375,
      slug: 'backspace-bridge-baseline',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();

      await expect(titleInput).toHaveValue('Backspace bridge baseline');
      await expect(firstChecklistLine).toHaveText('body line');

      await firstChecklistLine.click({ position: { x: 4, y: 8 } });
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');

      await expect(titleInput).toBeFocused();
      await page.keyboard.type('Z');
      await expect(titleInput).toHaveValue('Backspace bridge baselineZ');
      await expect(firstChecklistLine).toHaveText('body line');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('deletes an empty leading paragraph before moving focus to title end on Backspace', async ({ page }) => {
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
      title: 'Backspace empty paragraph baseline',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph' },
          { type: 'paragraph', content: [{ type: 'text', text: 'remaining body line' }] },
        ],
      },
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
      id_short: 50376,
      slug: 'backspace-empty-paragraph-baseline',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] textarea').first();
      const firstParagraph = modal.locator('.ProseMirror > p').nth(0);

      await expect(modal.locator('.ProseMirror > p')).toHaveCount(2);
      await firstParagraph.click({ position: { x: 4, y: 8 } });
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');

      await expect(titleInput).toBeFocused();
      await expect(modal.locator('.ProseMirror > p')).toHaveCount(1);
      await expect(modal.locator('.ProseMirror > p').nth(0)).toContainText('remaining body line');
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

      const eventCard = page.locator(`[data-card-id="${cardId}"][data-shortcut-context="timeline-card"]`).first();
      await expect(eventCard).toBeVisible();

      await eventCard.focus();
      await expect(eventCard).toBeFocused();

      const boardBar = page.getByTestId('board-shortcut-bar');
      await expect(boardBar).toBeVisible();
      await expect(boardBar).toContainText('タイムライン');
      await expect(boardBar).toContainText('開く');
      await expect(boardBar).toContainText('完了');
      const boardBarBox = await boardBar.boundingBox();
      const eventCardBox = await eventCard.boundingBox();
      expect(boardBarBox).not.toBeNull();
      expect(eventCardBox).not.toBeNull();
      expect(boardBarBox!.y).toBeLessThan(eventCardBox!.y);

      await eventCard.press('Escape');
      const cardMenu = page.getByRole('menu', { name: 'カード操作メニュー' });
      await expect(cardMenu).toBeVisible();
      await expect(boardBar).toContainText('タイムライン');
      await expect(boardBar).toContainText('閉じる');
      await expect(boardBar).toContainText('選択');
      await expect(boardBar).toContainText('決定');
      await page.keyboard.press('Escape');
      await expect(cardMenu).toBeHidden();
      await expect(eventCard).toBeFocused();

      await eventCard.press('Enter');

      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();
      await expect(boardBar).toBeVisible();

      const modalBar = page.getByTestId('modal-shortcut-bar');
      await expect(modalBar).toBeVisible();

      const titleInput = modal.locator('[data-shortcut-context="cardmodal-title"]').first();
      await titleInput.focus();
      await expect(modalBar).toContainText('カードタイトル');
      await expect(modalBar).toContainText('本文へ');
      await expect(modalBar).toContainText('元に戻す');
      const modalBarBox = await modalBar.boundingBox();
      const titleInputBox = await titleInput.boundingBox();
      expect(modalBarBox).not.toBeNull();
      expect(titleInputBox).not.toBeNull();
      expect(modalBarBox!.y).toBeLessThan(titleInputBox!.y);

      await page.keyboard.press('ArrowDown');
      await expect(modalBar).toContainText('カード本文');
      await expect(modalBar).toContainText('タイトルへ');

      await page.keyboard.press('ArrowUp');
      await expect(modalBar).toContainText('カードタイトル');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('supports keyboard shortcuts in the card context menu and restores focus on close', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const shortId = `CM${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Context menu keyboard test',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'context menu body line' }],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1894,
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
      id_short: 5040,
      slug: 'context-menu-keyboard-test',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();

      const eventCard = page.locator(`[data-card-id="${cardId}"][data-shortcut-context="timeline-card"]`).first();
      await expect(eventCard).toBeVisible();
      await eventCard.focus();
      await expect(eventCard).toBeFocused();

      await eventCard.press('Escape');

      const cardMenu = page.getByRole('menu', { name: 'カード操作メニュー' });
      const boardBar = page.getByTestId('board-shortcut-bar');
      await expect(cardMenu).toBeVisible();
      await expect(boardBar).toContainText('閉じる');
      await expect(boardBar).toContainText('選択');
      await expect(boardBar).toContainText('決定');
      await expect(cardMenu.getByRole('menuitem', { name: 'カードを開く' })).toBeFocused();

      await page.keyboard.press('ArrowDown');
      await expect(cardMenu.getByRole('menuitem', { name: '完了にする' })).toBeFocused();

      await page.keyboard.press('ArrowUp');
      await expect(cardMenu.getByRole('menuitem', { name: 'カードを開く' })).toBeFocused();

      await page.keyboard.press('Enter');

      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();
      await expect(boardBar).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
      await eventCard.focus();
      await expect(eventCard).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(cardMenu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(cardMenu).toBeHidden();
      await expect(eventCard).toBeFocused();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('toggles the desktop main header from the shortcut bar', async ({ page }) => {
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }

    await page.goto(boardContext.canonicalPath);

    const boardMenuButton = page.getByTestId('board-menu-button');
    const boardMainHeader = page.getByTestId('board-main-header');
    const headerToggle = page.getByTestId('board-header-toggle');

    await expect(boardMenuButton).toBeVisible();
    await expect(boardMainHeader).toHaveAttribute('aria-hidden', 'false');
    await expect(headerToggle).toHaveAttribute('aria-label', 'メインヘッダーを隠す');

    await headerToggle.click();

    await expect(boardMainHeader).toHaveAttribute('aria-hidden', 'true');
    await expect(headerToggle).toHaveAttribute('aria-label', 'メインヘッダーを表示');
    const collapsedHeaderBox = await boardMainHeader.boundingBox();
    expect(collapsedHeaderBox?.height ?? 0).toBeLessThan(4);

    await headerToggle.click();

    await expect(boardMainHeader).toHaveAttribute('aria-hidden', 'false');
    await expect(boardMenuButton).toBeVisible();
    await expect(headerToggle).toHaveAttribute('aria-label', 'メインヘッダーを隠す');
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
      const modal = cardDetailRoot(page);
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
      const reopenedModal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
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
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const listItemHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="listItem"]');
      await expect(listItemHandles).toHaveCount(3);
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

  test('moves top-level task item with nested task list up within the same list', async ({ page }) => {
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
      title: 'Block action move nested task parent',
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
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First parent task' }] }],
              },
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Second parent task' }] },
                  {
                    type: 'taskList',
                    content: [
                      {
                        type: 'taskItem',
                        attrs: { checked: false },
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested child task' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      excerpt: '[ ] First parent task\n[x] Second parent task\n  [ ] Nested child task',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1887,
      tags: [],
      due_date: isoDay,
      due_start: '13:40:00',
      due_end: '14:40:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5034,
      slug: 'block-action-move-nested-task-parent',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const topTaskItems = modal.locator('.ProseMirror > ul[data-type="taskList"] > li');
      await expect(topTaskItems).toHaveCount(2);
      const secondTopTaskItem = topTaskItems.nth(1);
      const nestedTaskItems = secondTopTaskItem.locator(':scope > div > ul[data-type="taskList"] > li');
      await expect(nestedTaskItems).toHaveCount(1);

      const taskItemHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]');
      await expect(taskItemHandles).toHaveCount(3);

      await openBlockActionMenu(page, modal, taskItemHandles.nth(1), 'move-up');
      await expect(modal.getByTestId('tiptap-block-menu-move-down')).toHaveAttribute('aria-disabled', 'true');
      await triggerBlockAction(page, modal, taskItemHandles.nth(1), 'move-up', 'move-up');

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as {
            content?: Array<{
              type?: string;
              content?: Array<{
                attrs?: { checked?: boolean };
                content?: Array<{
                  type?: string;
                  content?: Array<{
                    attrs?: { checked?: boolean };
                    content?: Array<{ content?: Array<{ text?: string }> }>;
                  }>;
                } | { content?: Array<{ text?: string }> }>;
              }>;
            }>;
          } | null;
          const listNode = Array.isArray(content?.content) ? content.content[0] : null;
          const itemTexts = Array.isArray(listNode?.content)
            ? listNode.content.map((item) => item?.content?.[0]?.content?.[0]?.text ?? null)
            : [];
          const checkedStates = Array.isArray(listNode?.content)
            ? listNode.content.map((item) => item?.attrs?.checked ?? null)
            : [];
          const nestedTexts = Array.isArray(listNode?.content)
            ? listNode.content.map((item) => {
                const nestedList = item?.content?.find((child) => child?.type === 'taskList');
                return Array.isArray(nestedList?.content)
                  ? nestedList.content.map((nestedItem) => nestedItem?.content?.[0]?.content?.[0]?.text ?? null)
                  : [];
              })
            : [];
          return { itemTexts, checkedStates, nestedTexts };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          itemTexts: ['Second parent task', 'First parent task'],
          checkedStates: [true, false],
          nestedTexts: [['Nested child task'], []],
        });

      const reorderedTaskItems = modal.locator('.ProseMirror > ul[data-type="taskList"] > li');
      await expect(reorderedTaskItems.first().locator(':scope > div > p').first()).toHaveText('Second parent task');
      await expect(
        reorderedTaskItems.first().locator(':scope > div > ul[data-type="taskList"] > li > div > p').first(),
      ).toHaveText('Nested child task');
      await expect(
        modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]'),
      ).toHaveCount(3);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('enables both move directions for a middle top-level task item with nested task list', async ({ page }) => {
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
      title: 'Block action nested task middle move availability',
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
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First sibling task' }] }],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Middle parent task' }] },
                  {
                    type: 'taskList',
                    content: [
                      {
                        type: 'taskItem',
                        attrs: { checked: false },
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested middle child' }] }],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Last sibling task' }] }],
              },
            ],
          },
        ],
      },
      excerpt: '[ ] First sibling task\n[ ] Middle parent task\n  [ ] Nested middle child\n[ ] Last sibling task',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1884,
      tags: [],
      due_date: isoDay,
      due_start: '13:10:00',
      due_end: '14:10:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5031,
      slug: 'block-action-nested-task-middle-move-availability',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const taskItemHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]');
      await expect(taskItemHandles).toHaveCount(3);

      await openBlockActionMenu(page, modal, taskItemHandles.nth(1), 'move-up');
      await expect(modal.getByTestId('tiptap-block-menu-move-up')).not.toHaveAttribute('aria-disabled', 'true');
      await expect(modal.getByTestId('tiptap-block-menu-move-down')).not.toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');
      await expect(modal.getByTestId('tiptap-block-menu')).toHaveCount(0);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('enables move for nested parent task across adjacent top-level task lists', async ({ page }) => {
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
      title: 'Block action adjacent top-level task lists',
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
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First isolated task' }] }],
              },
            ],
          },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Middle isolated parent' }] },
                  {
                    type: 'taskList',
                    content: [
                      {
                        type: 'taskItem',
                        attrs: { checked: false },
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested isolated child' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Last isolated task' }] }],
              },
            ],
          },
        ],
      },
      excerpt: '[ ] First isolated task\n[ ] Middle isolated parent\n  [ ] Nested isolated child\n[ ] Last isolated task',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1883,
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
      slug: 'block-action-adjacent-top-level-task-lists',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const taskItemHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]');
      await expect(taskItemHandles).toHaveCount(3);

      await openBlockActionMenu(page, modal, taskItemHandles.nth(1), 'move-up');
      await expect(modal.getByTestId('tiptap-block-menu-move-up')).not.toHaveAttribute('aria-disabled', 'true');
      await expect(modal.getByTestId('tiptap-block-menu-move-down')).not.toHaveAttribute('aria-disabled', 'true');
      await modal.getByTestId('tiptap-block-menu-move-up').click();
      await expect(modal.getByTestId('tiptap-block-menu')).toHaveCount(0);

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as {
            content?: Array<{
              type?: string;
              content?: Array<{
                content?: Array<{
                  type?: string;
                  content?: Array<{
                    content?: Array<{ text?: string }>;
                  }>;
                } | { content?: Array<{ text?: string }> }>;
              }>;
            }>;
          } | null;
          const topLevelNodes = Array.isArray(content?.content) ? content.content : [];
          const taskLists = topLevelNodes.filter((node) => node?.type === 'taskList');
          const listTaskTexts = taskLists.map((listNode) =>
            Array.isArray(listNode?.content)
              ? listNode.content.map((item) => item?.content?.[0]?.content?.[0]?.text ?? null)
              : [],
          );
          const nestedTexts = taskLists.map((listNode) =>
            Array.isArray(listNode?.content)
              ? listNode.content.map((item) => {
                  const nestedList = item?.content?.find((child) => child?.type === 'taskList');
                  return Array.isArray(nestedList?.content)
                    ? nestedList.content.map((nestedItem) => nestedItem?.content?.[0]?.content?.[0]?.text ?? null)
                    : [];
                })
              : [],
          );
          return { listTaskTexts, nestedTexts };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          listTaskTexts: [
            ['First isolated task', 'Middle isolated parent'],
            ['Last isolated task'],
          ],
          nestedTexts: [
            [[], ['Nested isolated child']],
            [[]],
          ],
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves heading with Mod-ArrowUp shortcut', async ({ page }) => {
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
    const moveUpShortcut = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+ArrowUp';

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
      const modal = cardDetailRoot(page);
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

  test('moves top-level task item with nested task list with shortcut', async ({ page }) => {
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
    const moveUpShortcut = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+ArrowUp';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action shortcut move nested task parent',
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
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First shortcut parent' }] }],
              },
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Second shortcut parent' }] },
                  {
                    type: 'taskList',
                    content: [
                      {
                        type: 'taskItem',
                        attrs: { checked: false },
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested shortcut child' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      excerpt: '[ ] First shortcut parent\n[x] Second shortcut parent\n  [ ] Nested shortcut child',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1886,
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
      id_short: 5033,
      slug: 'block-action-shortcut-move-nested-task-parent',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      await modal.locator('.ProseMirror > ul[data-type="taskList"] > li:nth-child(2) > div > p').click();
      await page.keyboard.press(moveUpShortcut);

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as {
            content?: Array<{
              content?: Array<{
                attrs?: { checked?: boolean };
                content?: Array<{
                  type?: string;
                  content?: Array<{
                    content?: Array<{ content?: Array<{ text?: string }> }>;
                  }>;
                } | { content?: Array<{ text?: string }> }>;
              }>;
            }>;
          } | null;
          const listNode = Array.isArray(content?.content) ? content.content[0] : null;
          const itemTexts = Array.isArray(listNode?.content)
            ? listNode.content.map((item) => item?.content?.[0]?.content?.[0]?.text ?? null)
            : [];
          const checkedStates = Array.isArray(listNode?.content)
            ? listNode.content.map((item) => item?.attrs?.checked ?? null)
            : [];
          const nestedTexts = Array.isArray(listNode?.content)
            ? listNode.content.map((item) => {
                const nestedList = item?.content?.find((child) => child?.type === 'taskList');
                return Array.isArray(nestedList?.content)
                  ? nestedList.content.map((nestedItem) => nestedItem?.content?.[0]?.content?.[0]?.text ?? null)
                  : [];
              })
            : [];
          return { itemTexts, checkedStates, nestedTexts };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          itemTexts: ['Second shortcut parent', 'First shortcut parent'],
          checkedStates: [true, false],
          nestedTexts: [['Nested shortcut child'], []],
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves nested task item only within the same parent list', async ({ page }) => {
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
      title: 'Block action nested task child move',
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
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First nested child' }] }],
                      },
                      {
                        type: 'taskItem',
                        attrs: { checked: true },
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second nested child' }] }],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Top-level sibling' }] }],
              },
            ],
          },
        ],
      },
      excerpt: '[ ] Parent task\n  [ ] First nested child\n  [x] Second nested child\n[ ] Top-level sibling',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1895,
      tags: [],
      due_date: isoDay,
      due_start: '15:05:00',
      due_end: '16:05:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5042,
      slug: 'block-action-nested-task-child-move',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const parentTaskItem = modal.locator('.ProseMirror > ul[data-type="taskList"] > li').first();
      await expect(parentTaskItem.locator(':scope > div > ul[data-type="taskList"] > li')).toHaveCount(2);

      const taskItemHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="taskItem"]');
      await expect(taskItemHandles).toHaveCount(4);

      await openBlockActionMenu(page, modal, taskItemHandles.nth(2), 'move-up');
      await expect(modal.getByTestId('tiptap-block-menu-move-up')).not.toHaveAttribute('aria-disabled', 'true');
      await expect(modal.getByTestId('tiptap-block-menu-move-down')).toHaveAttribute('aria-disabled', 'true');
      await triggerBlockAction(page, modal, taskItemHandles.nth(2), 'move-up', 'move-up');

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as {
            content?: Array<{
              type?: string;
              content?: Array<{
                content?: Array<{
                  type?: string;
                  content?: Array<{
                    content?: Array<{ text?: string }>;
                    attrs?: { checked?: boolean };
                  }>;
                } | { content?: Array<{ text?: string }> }>;
              }>;
            }>;
          } | null;
          const topList = Array.isArray(content?.content) ? content.content[0] : null;
          const parentItem = Array.isArray(topList?.content) ? topList.content[0] : null;
          const nestedList = Array.isArray(parentItem?.content)
            ? parentItem.content.find((child) => child?.type === 'taskList')
            : null;
          const nestedTexts = Array.isArray(nestedList?.content)
            ? nestedList.content.map((item) => item?.content?.[0]?.content?.[0]?.text ?? null)
            : [];
          const nestedChecked = Array.isArray(nestedList?.content)
            ? nestedList.content.map((item) => item?.attrs?.checked ?? null)
            : [];
          return { nestedTexts, nestedChecked };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          nestedTexts: ['Second nested child', 'First nested child'],
          nestedChecked: [true, false],
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('moves nested task item with shortcut and preserves same-parent ordering', async ({ page }) => {
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
    const moveUpShortcut = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+ArrowUp';

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block action nested task child shortcut move',
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
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut nested first' }] }],
                      },
                      {
                        type: 'taskItem',
                        attrs: { checked: false },
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut nested second' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      excerpt: '[ ] Parent task\n  [ ] Shortcut nested first\n  [ ] Shortcut nested second',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1894,
      tags: [],
      due_date: isoDay,
      due_start: '14:55:00',
      due_end: '15:55:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5041,
      slug: 'block-action-nested-task-child-shortcut-move',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      await modal.locator('.ProseMirror > ul[data-type="taskList"] > li > div > ul[data-type="taskList"] > li:nth-child(2) > div > p').click();
      await page.keyboard.press(moveUpShortcut);

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as {
            content?: Array<{
              content?: Array<{
                content?: Array<{
                  type?: string;
                  content?: Array<{ content?: Array<{ text?: string }> }>;
                } | { content?: Array<{ text?: string }> }>;
              }>;
            }>;
          } | null;
          const topList = Array.isArray(content?.content) ? content.content[0] : null;
          const parentItem = Array.isArray(topList?.content) ? topList.content[0] : null;
          const nestedList = Array.isArray(parentItem?.content)
            ? parentItem.content.find((child) => child?.type === 'taskList')
            : null;
          const nestedTexts = Array.isArray(nestedList?.content)
            ? nestedList.content.map((item) => item?.content?.[0]?.content?.[0]?.text ?? null)
            : [];
          return { nestedTexts };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          nestedTexts: ['Shortcut nested second', 'Shortcut nested first'],
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('renders nested list item handles with indented anchors and inserts sibling list items', async ({ page }) => {
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
      title: 'Block action nested list item insert',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Top bullet' }] }],
              },
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Parent bullet' }] },
                  {
                    type: 'bulletList',
                    content: [
                      {
                        type: 'listItem',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested bullet' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      excerpt: 'Top bullet\nParent bullet\nNested bullet',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1893,
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
      id_short: 5040,
      slug: 'block-action-nested-list-item-insert',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const listItemHandles = modal.locator('[data-testid="tiptap-block-handle"][data-block-node-type="listItem"]');
      await expect(listItemHandles).toHaveCount(3);

      const parentHandle = listItemHandles.nth(1);
      const nestedHandle = listItemHandles.nth(2);
      const handleBoxes = await Promise.all([
        parentHandle.boundingBox(),
        nestedHandle.boundingBox(),
      ]);

      expect(handleBoxes[0]).not.toBeNull();
      expect(handleBoxes[1]).not.toBeNull();
      expect((handleBoxes[1]?.x ?? 0)).toBeGreaterThan((handleBoxes[0]?.x ?? 0) + 8);

      await openBlockActionMenu(page, modal, nestedHandle, 'insert-above');
      await expect(modal.getByTestId('tiptap-block-menu-move-up')).toHaveAttribute('aria-disabled', 'true');
      await expect(modal.getByTestId('tiptap-block-menu-move-down')).toHaveAttribute('aria-disabled', 'true');
      await triggerBlockAction(page, modal, nestedHandle, 'insert-above', 'insert-above');

      await expect
        .poll(async () => {
          const nextCard = await fetchSavedCard(cardId);
          const content = nextCard?.content as {
            content?: Array<{
              content?: Array<{
                content?: Array<{
                  type?: string;
                  content?: Array<{ content?: Array<{ text?: string }> }>;
                } | { content?: Array<{ text?: string }> }>;
              }>;
            }>;
          } | null;
          const topList = Array.isArray(content?.content) ? content.content[0] : null;
          const parentItem = Array.isArray(topList?.content) ? topList.content[1] : null;
          const nestedList = Array.isArray(parentItem?.content)
            ? parentItem.content.find((child) => child?.type === 'bulletList')
            : null;
          const nestedEntries = Array.isArray(nestedList?.content)
            ? nestedList.content.map((item) => ({
                type: item?.type ?? null,
                text: item?.content?.[0]?.content?.[0]?.text ?? null,
              }))
            : [];
          return { nestedEntries };
        }, { timeout: 20000, intervals: [500, 1000, 2000] })
        .toMatchObject({
          nestedEntries: [
            { type: 'listItem', text: null },
            { type: 'listItem', text: 'Nested bullet' },
          ],
        });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('shows block handle for nested task items', async ({ page }) => {
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
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      expect(await countVisibleTaskItemHandles(modal)).toBe(2);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('dims checked task lines and toggles completed line visibility in the modal sidebar', async ({ page }) => {
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
    const initialContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Visible task' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hidden task' }] }],
            },
          ],
        },
      ],
    };

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Completed line visibility',
      checklist: { version: 1, lines: [] },
      content: initialContent,
      excerpt: '[ ] Visible task\n[x] Hidden task',
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
      slug: 'completed-line-visibility',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const checkedTaskLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li[data-checked="true"] p').first();
      const uncheckedTaskLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li[data-checked="false"] p').first();
      const completedLinesPanel = modal.getByTestId('card-modal-completed-lines-panel');

      if (!(await completedLinesPanel.isVisible())) {
        await modal.getByTitle('Show details').click();
      }
      await expect(completedLinesPanel).toBeVisible();
      const showCompletedLines = modal.getByTestId('card-modal-show-completed-lines');
      await expect(showCompletedLines).toBeChecked();

      const savedBeforeToggle = await fetchSavedCard(cardId);
      expect(Date.parse(savedBeforeToggle?.updatedAt ?? '')).toBe(Date.parse(timestamp));

      await expect(checkedTaskLine).toBeVisible();
      await expect(uncheckedTaskLine).toBeVisible();
      expect(await countVisibleTaskItemHandles(modal)).toBe(2);

      await showCompletedLines.uncheck();
      await expect(showCompletedLines).not.toBeChecked();
      await expect(checkedTaskLine).toBeHidden();
      expect(await countVisibleTaskItemHandles(modal)).toBe(1);

      const checkedLineStyles = await checkedTaskLine.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          color: style.color,
          textDecorationLine: style.textDecorationLine,
        };
      });
      expect(checkedLineStyles.color).toBe('rgb(148, 163, 184)');
      expect(checkedLineStyles.textDecorationLine).toContain('line-through');

      const savedAfterToggle = await fetchSavedCard(cardId);
      expect(savedAfterToggle).toMatchObject({
        title: 'Completed line visibility',
        checked: false,
        excerpt: '[ ] Visible task\n[x] Hidden task',
      });
      expect(Date.parse(savedAfterToggle?.updatedAt ?? '')).toBe(Date.parse(timestamp));
      expect(savedAfterToggle?.content).toEqual(initialContent);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('applies subtree completion visibility rules for nested task items', async ({ page }) => {
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
    const initialContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent only done' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: false },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child stays visible' }] }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent active' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: true },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child done only' }] }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent subtree done' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: true },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child done with parent' }] }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent and child done' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: true },
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'Child and grandchild branch' }] },
                        {
                          type: 'taskList',
                          content: [
                            {
                              type: 'taskItem',
                              attrs: { checked: false },
                              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Grandchild keeps branch visible' }] }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Subtree completion visibility',
      checklist: { version: 1, lines: [] },
      content: initialContent,
      excerpt: '[x] Parent only done\n  [ ] Child stays visible\n[ ] Parent active\n  [x] Child done only\n[x] Parent subtree done\n  [x] Child done with parent\n[x] Parent and child done\n  [x] Child and grandchild branch\n    [ ] Grandchild keeps branch visible',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1898,
      tags: [],
      due_date: isoDay,
      due_start: '15:35:00',
      due_end: '16:35:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5046,
      slug: 'subtree-completion-visibility',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const completedLinesPanel = modal.getByTestId('card-modal-completed-lines-panel');
      if (!(await completedLinesPanel.isVisible())) {
        await modal.getByTitle('Show details').click();
      }
      await expect(completedLinesPanel).toBeVisible();
      const showCompletedLines = modal.getByTestId('card-modal-show-completed-lines');
      await expect(showCompletedLines).toBeChecked();

      const topTaskItems = modal.locator('.ProseMirror > ul[data-type="taskList"] > li');
      const parentOnlyDone = topTaskItems.filter({ hasText: 'Parent only done' }).first();
      const parentActive = topTaskItems.filter({ hasText: 'Parent active' }).first();
      const parentSubtreeDone = topTaskItems.filter({ hasText: 'Parent subtree done' }).first();
      const parentAndChildDone = topTaskItems.filter({ hasText: 'Parent and child done' }).first();

      const parentOnlyDoneLine = parentOnlyDone.locator(':scope > div > p').first();
      const childStaysVisibleLine = parentOnlyDone.locator(':scope > div > ul[data-type="taskList"] > li > div > p').first();
      const childDoneOnlyLine = parentActive.locator(':scope > div > ul[data-type="taskList"] > li > div > p').first();
      const parentAndChildDoneLine = parentAndChildDone.locator(':scope > div > p').first();
      const childAndGrandchildBranchLine = parentAndChildDone.locator(':scope > div > ul[data-type="taskList"] > li > div > p').first();
      const grandchildKeepsBranchVisibleLine = parentAndChildDone.locator(':scope > div > ul[data-type="taskList"] > li > div > ul[data-type="taskList"] > li > div > p').first();

      await expect(parentOnlyDone).toHaveAttribute('data-completion-visibility', 'visible');
      await expect(parentOnlyDone).toHaveAttribute('data-subtree-complete', 'false');
      await expect(parentActive).toHaveAttribute('data-completion-visibility', 'visible');
      await expect(parentSubtreeDone).toHaveAttribute('data-completion-visibility', 'visible');
      await expect(parentSubtreeDone.locator(':scope > div > p').first()).toBeVisible();
      await expect(parentSubtreeDone.locator(':scope > div > ul[data-type="taskList"] > li > div > p').first()).toBeVisible();
      await expect(parentAndChildDone).toHaveAttribute('data-completion-visibility', 'visible');
      await expect(parentOnlyDoneLine).toBeVisible();
      await expect(childStaysVisibleLine).toBeVisible();
      await expect(childDoneOnlyLine).toBeVisible();
      await expect(parentAndChildDoneLine).toBeVisible();
      await expect(childAndGrandchildBranchLine).toBeVisible();
      await expect(grandchildKeepsBranchVisibleLine).toBeVisible();

      const lineDecorations = await Promise.all([
        parentOnlyDoneLine,
        childStaysVisibleLine,
        parentAndChildDoneLine,
        childAndGrandchildBranchLine,
        grandchildKeepsBranchVisibleLine,
      ].map(async (locator) => locator.evaluate((element) => window.getComputedStyle(element).textDecorationLine)));

      expect(lineDecorations[0]).toContain('line-through');
      expect(lineDecorations[1]).not.toContain('line-through');
      expect(lineDecorations[2]).toContain('line-through');
      expect(lineDecorations[3]).toContain('line-through');
      expect(lineDecorations[4]).not.toContain('line-through');

      expect(await countVisibleTaskItemHandles(modal)).toBe(9);

      await showCompletedLines.uncheck();
      await expect(showCompletedLines).not.toBeChecked();
      await expect(parentSubtreeDone).toHaveAttribute('data-completion-visibility', 'hidden');
      await expect(parentSubtreeDone.locator(':scope > div > p').first()).toBeHidden();
      await expect(parentSubtreeDone.locator(':scope > div > ul[data-type="taskList"] > li > div > p').first()).toBeHidden();
      await expect(childDoneOnlyLine).toBeHidden();
      expect(await countVisibleTaskItemHandles(modal)).toBe(6);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('aggregates hidden subtree runs onto the next visible sibling and trailing task list', async ({ page }) => {
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
    const hiddenLeaf = (text: string) => ({
      type: 'taskItem',
      attrs: { checked: true },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const initialContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Visible start' }] }],
            },
            hiddenLeaf('Hidden middle 1'),
            hiddenLeaf('Hidden middle 2'),
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Visible after middle run' }] }],
            },
            hiddenLeaf('Hidden trailing 1'),
            hiddenLeaf('Hidden trailing 2'),
            hiddenLeaf('Hidden trailing 3'),
            hiddenLeaf('Hidden trailing 4'),
            hiddenLeaf('Hidden trailing 5'),
            hiddenLeaf('Hidden trailing 6'),
          ],
        },
      ],
    };

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Hidden run aggregation',
      checklist: { version: 1, lines: [] },
      content: initialContent,
      excerpt: '[ ] Visible start\n[x] Hidden middle 1\n[x] Hidden middle 2\n[ ] Visible after middle run\n[x] Hidden trailing 1\n[x] Hidden trailing 2\n[x] Hidden trailing 3\n[x] Hidden trailing 4\n[x] Hidden trailing 5\n[x] Hidden trailing 6',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1899,
      tags: [],
      due_date: isoDay,
      due_start: '15:40:00',
      due_end: '16:40:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5047,
      slug: 'hidden-run-aggregation',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const topTaskList = modal.locator('.ProseMirror > ul[data-type="taskList"]').first();
      const topTaskItems = topTaskList.locator(':scope > li:not([data-hidden-run-marker="true"])');
      await expect(topTaskItems).toHaveCount(10);

      const visibleAfterMiddleRun = topTaskItems.filter({ hasText: 'Visible after middle run' }).first();
      await expect(visibleAfterMiddleRun).toHaveAttribute('data-hidden-run-start', 'true');
      await expect(visibleAfterMiddleRun).toHaveAttribute('data-hidden-run-length', '2');
      await expect(topTaskList).toHaveAttribute('data-hidden-run-start', 'true');
      await expect(topTaskList).toHaveAttribute('data-hidden-run-length', '6');
      await expect(topTaskItems.filter({ hasText: 'Hidden middle 1' }).first().locator(':scope > div > p').first()).toBeHidden();
      await expect(topTaskItems.filter({ hasText: 'Hidden trailing 6' }).first().locator(':scope > div > p').first()).toBeHidden();

      const hiddenRunButtons = modal.getByTestId('tiptap-hidden-run-marker-button');
      await expect(hiddenRunButtons).toHaveCount(2);
      await expect(hiddenRunButtons.nth(0)).toHaveText('2');
      await expect(hiddenRunButtons.nth(1)).toHaveText('6');

      await hiddenRunButtons.nth(0).click();
      await expect(topTaskItems.filter({ hasText: 'Hidden middle 1' }).first().locator(':scope > div > p').first()).toBeVisible();
      await expect(topTaskItems.filter({ hasText: 'Hidden middle 2' }).first().locator(':scope > div > p').first()).toBeVisible();
      await expect(topTaskItems.filter({ hasText: 'Hidden trailing 6' }).first().locator(':scope > div > p').first()).toBeHidden();
      await expect(hiddenRunButtons).toHaveCount(1);
      await expect(hiddenRunButtons.first()).toHaveText('6');

      await hiddenRunButtons.first().click();
      await expect(hiddenRunButtons).toHaveCount(0);
      await expect(topTaskItems.filter({ hasText: 'Hidden trailing 6' }).first().locator(':scope > div > p').first()).toBeVisible();
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('renders nested hidden-run marker buttons in-flow and expands only the targeted nested run', async ({ page }) => {
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
    const initialContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent visible task' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: true },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested hidden 1' }] }],
                    },
                    {
                      type: 'taskItem',
                      attrs: { checked: true },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested hidden 2' }] }],
                    },
                    {
                      type: 'taskItem',
                      attrs: { checked: false },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested visible after run' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Nested hidden run markers',
      checklist: { version: 1, lines: [] },
      content: initialContent,
      excerpt: '[ ] Parent visible task\n  [x] Nested hidden 1\n  [x] Nested hidden 2\n  [ ] Nested visible after run',
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
      id_short: 5046,
      slug: 'nested-hidden-run-markers',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const completedLinesPanel = modal.getByTestId('card-modal-completed-lines-panel');
      if (!(await completedLinesPanel.isVisible())) {
        await modal.getByTitle('Show details').click();
      }
      await expect(completedLinesPanel).toBeVisible();
      const showCompletedLines = modal.getByTestId('card-modal-show-completed-lines');
      await expect(showCompletedLines).toBeChecked();
      await showCompletedLines.uncheck();
      await expect(showCompletedLines).not.toBeChecked();

      const nestedTaskList = modal.locator('.ProseMirror > ul[data-type="taskList"] > li > div > ul[data-type="taskList"]').first();
      const nestedRunButton = nestedTaskList.getByTestId('tiptap-hidden-run-marker-button').first();
      await expect(nestedRunButton).toBeVisible();
      await expect(nestedRunButton).toHaveText('2');
      await expect(nestedTaskList.locator(':scope > li').filter({ hasText: 'Nested hidden 1' }).first().locator(':scope > div > p').first()).toBeHidden();
      expect(await countVisibleTaskItemHandles(modal)).toBe(2);

      await nestedRunButton.click();

      await expect(nestedTaskList.getByTestId('tiptap-hidden-run-marker-button')).toHaveCount(0);
      await expect(nestedTaskList.locator(':scope > li').filter({ hasText: 'Nested hidden 1' }).first().locator(':scope > div > p').first()).toBeVisible();
      await expect(nestedTaskList.locator(':scope > li').filter({ hasText: 'Nested hidden 2' }).first().locator(':scope > div > p').first()).toBeVisible();
      await expect(nestedTaskList.locator(':scope > li').filter({ hasText: 'Nested visible after run' }).first().locator(':scope > div > p').first()).toBeVisible();
      expect(await countVisibleTaskItemHandles(modal)).toBe(4);
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('renders per-block ruling for paragraphs, lists, and details without li borders', async ({ page }) => {
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
    const initialContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Section heading' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body paragraph' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet item' }] }],
            },
          ],
        },
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
        {
          type: 'details',
          attrs: { open: true },
          content: [
            {
              type: 'detailsSummary',
              content: [{ type: 'text', text: 'Details summary' }],
            },
            {
              type: 'detailsContent',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Details body' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'Block ruling coverage',
      checklist: { version: 1, lines: [] },
      content: initialContent,
      excerpt: 'Body paragraph\n- Bullet item\n[ ] Parent task\n  [ ] Nested task\nDetails summary',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1898,
      tags: [],
      due_date: isoDay,
      due_start: '15:25:00',
      due_end: '16:25:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5145,
      slug: 'block-ruling-coverage',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const heading = bodyEditor.locator('h2').first();
      const paragraph = bodyEditor.locator(':scope > p').first();
      const bulletItem = bodyEditor.locator(':scope > ul:not([data-type="taskList"]) > li').first();
      const bulletLine = bulletItem.locator(':scope > p').first();
      const topTaskItem = modal.locator('.ProseMirror > ul[data-type="taskList"] > li').first();
      const topTaskLine = topTaskItem.locator(':scope > div > p').first();
      const nestedTaskItem = topTaskItem.locator(':scope > div > ul[data-type="taskList"] > li').first();
      const nestedTaskLine = nestedTaskItem.locator(':scope > div > p').first();
      const detailsSummary = bodyEditor.locator('summary').first();

      await expect(heading).toHaveText('Section heading');
      await expect(paragraph).toHaveText('Body paragraph');
      await expect(bulletLine).toHaveText('Bullet item');
      await expect(topTaskLine).toHaveText('Parent task');
      await expect(nestedTaskLine).toHaveText('Nested task');
      await expect(detailsSummary).toHaveText('Details summary');

      const lineStyles = await bodyEditor.evaluate((editorRoot) => {
        const heading = editorRoot.querySelector(':scope > h2');
        const paragraph = editorRoot.querySelector(':scope > p');
        const bulletItem = editorRoot.querySelector(':scope > ul:not([data-type="taskList"]) > li');
        const bulletParagraph = bulletItem?.querySelector(':scope > p');
        const taskItem = editorRoot.querySelector(':scope > ul[data-type="taskList"] > li');
        const taskLabel = taskItem?.querySelector(':scope > label');
        if (!(heading instanceof HTMLElement) || !(taskItem instanceof HTMLElement)) {
          return null;
        }
        const topParagraph = taskItem.querySelector(':scope > div > p');
        const nestedTaskItem = taskItem.querySelector(':scope > div > ul[data-type="taskList"] > li');
        const nestedParagraph = nestedTaskItem?.querySelector(':scope > div > p');
        const detailsSummary = editorRoot.querySelector('summary');
        const bulletItemStyle = bulletItem ? window.getComputedStyle(bulletItem) : null;
        const topTaskItemStyle = window.getComputedStyle(taskItem);
        const paragraphAfterStyle = paragraph ? window.getComputedStyle(paragraph, '::after') : null;
        const bulletParagraphAfterStyle = bulletParagraph ? window.getComputedStyle(bulletParagraph, '::after') : null;
        const bulletMarkerStyle = bulletItem ? window.getComputedStyle(bulletItem, '::before') : null;
        const taskLabelStyle = taskLabel ? window.getComputedStyle(taskLabel) : null;
        const topParagraphStyle = topParagraph ? window.getComputedStyle(topParagraph) : null;
        const nestedTaskItemStyle = nestedTaskItem ? window.getComputedStyle(nestedTaskItem) : null;
        const nestedParagraphStyle = nestedParagraph ? window.getComputedStyle(nestedParagraph) : null;
        const headingAfterStyle = window.getComputedStyle(heading, '::after');
        const detailsSummaryAfterStyle = detailsSummary ? window.getComputedStyle(detailsSummary, '::after') : null;
        const topParagraphAfterStyle = topParagraph ? window.getComputedStyle(topParagraph, '::after') : null;
        const nestedParagraphAfterStyle = nestedParagraph ? window.getComputedStyle(nestedParagraph, '::after') : null;

        return {
          paragraphAfterBorderBottomWidth: paragraphAfterStyle?.borderBottomWidth ?? null,
          paragraphAfterLeft: paragraphAfterStyle?.left ?? null,
          bulletItemBorderBottomWidth: bulletItemStyle?.borderBottomWidth ?? null,
          bulletParagraphAfterBorderBottomWidth: bulletParagraphAfterStyle?.borderBottomWidth ?? null,
          bulletParagraphAfterLeft: bulletParagraphAfterStyle?.left ?? null,
          bulletMarkerDisplay: bulletMarkerStyle?.display ?? null,
          bulletMarkerWidth: bulletMarkerStyle?.width ?? null,
          topTaskItemBorderBottomWidth: topTaskItemStyle.borderBottomWidth,
          taskLabelWidth: taskLabelStyle?.width ?? null,
          topParagraphBorderBottomWidth: topParagraphStyle?.borderBottomWidth ?? null,
          nestedTaskItemBorderBottomWidth: nestedTaskItemStyle?.borderBottomWidth ?? null,
          nestedParagraphBorderBottomWidth: nestedParagraphStyle?.borderBottomWidth ?? null,
          headingAfterBorderBottomWidth: headingAfterStyle.borderBottomWidth,
          headingAfterLeft: headingAfterStyle.left,
          detailsSummaryAfterBorderBottomWidth: detailsSummaryAfterStyle?.borderBottomWidth ?? null,
          detailsSummaryAfterLeft: detailsSummaryAfterStyle?.left ?? null,
          topParagraphAfterBorderBottomWidth: topParagraphAfterStyle?.borderBottomWidth ?? null,
          topParagraphAfterLeft: topParagraphAfterStyle?.left ?? null,
          nestedParagraphAfterBorderBottomWidth: nestedParagraphAfterStyle?.borderBottomWidth ?? null,
          nestedParagraphAfterLeft: nestedParagraphAfterStyle?.left ?? null,
        };
      });

      expect(lineStyles).not.toBeNull();
      expect(lineStyles?.headingAfterBorderBottomWidth).toBe('1px');
      expect(lineStyles?.headingAfterLeft).toBe('0px');
      expect(lineStyles?.paragraphAfterBorderBottomWidth).toBe('1px');
      expect(lineStyles?.paragraphAfterLeft).toBe('0px');
      expect(lineStyles?.bulletItemBorderBottomWidth).toBe('0px');
      expect(lineStyles?.bulletParagraphAfterBorderBottomWidth).toBe('1px');
      expect(lineStyles?.bulletParagraphAfterLeft).toBe('0px');
      expect(lineStyles?.bulletMarkerDisplay).toBe('flex');
      expect(lineStyles?.bulletMarkerWidth).toBe(lineStyles?.taskLabelWidth);
      expect(lineStyles.topTaskItemBorderBottomWidth).toBe('0px');
      expect(lineStyles.topParagraphBorderBottomWidth).toBe('0px');
      expect(lineStyles?.topParagraphAfterBorderBottomWidth).toBe('1px');
      expect(lineStyles?.topParagraphAfterLeft).toBe('0px');
      expect(lineStyles.nestedTaskItemBorderBottomWidth).toBe('0px');
      expect(lineStyles.nestedParagraphBorderBottomWidth).toBe('0px');
      expect(lineStyles?.nestedParagraphAfterBorderBottomWidth).toBe('1px');
      expect(lineStyles?.nestedParagraphAfterLeft).toBe('0px');
      expect(lineStyles?.detailsSummaryAfterBorderBottomWidth).toBe('1px');
      expect(lineStyles?.detailsSummaryAfterLeft).toBe('0px');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('resets completed line visibility on modal reopen and does not autosave during history preview', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const cardId = crypto.randomUUID();
    const historyId = crypto.randomUUID();
    const shortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const historyExcerpt = '[x] Completed task history preview entry';
    const initialContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completed task' }] }],
            },
          ],
        },
      ],
    };

    const { error: insertError } = await supabaseAdmin.from('cards').insert({
      id: cardId,
      title: 'History preview completed lines',
      checklist: { version: 1, lines: [] },
      content: initialContent,
      excerpt: '[x] Completed task',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1898,
      tags: [],
      due_date: isoDay,
      due_start: '15:30:00',
      due_end: '16:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5045,
      slug: 'history-preview-completed-lines',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    const { error: historyError } = await supabaseAdmin.from('card_content_history').insert({
      id: historyId,
      card_id: cardId,
      board_id: boardContext.boardId,
      content: initialContent,
      excerpt: historyExcerpt,
      saved_by: testUserId,
      created_at: timestamp,
    });

    expect(historyError).toBeNull();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const completedLinesPanel = modal.getByTestId('card-modal-completed-lines-panel');
      if (!(await completedLinesPanel.isVisible())) {
        await modal.getByTitle('Show details').click();
      }
      await expect(completedLinesPanel).toBeVisible();
      const showCompletedLines = modal.getByTestId('card-modal-show-completed-lines');
      await showCompletedLines.uncheck();
      await expect(showCompletedLines).not.toBeChecked();
      await expect(modal.locator('.ProseMirror > ul[data-type="taskList"] > li[data-checked="true"] p').first()).toBeHidden();
      const hiddenRunButton = modal.getByTestId('tiptap-hidden-run-marker-button').first();
      await expect(hiddenRunButton).toBeVisible();
      await hiddenRunButton.click();
      await expect(modal.getByTestId('tiptap-hidden-run-marker-button')).toHaveCount(0);
      await expect(modal.locator('.ProseMirror > ul[data-type="taskList"] > li[data-checked="true"] p').first()).toBeVisible();

      await modal.getByRole('button', { name: '履歴' }).click();
      await expect(modal.getByText('履歴プレビュー中', { exact: true })).toHaveCount(0);
      await modal.getByRole('button', { name: historyExcerpt }).click();
      await expect(modal.getByText('履歴プレビュー中', { exact: true })).toBeVisible();

      const savedBeforePreviewToggle = await fetchSavedCard(cardId);
      await showCompletedLines.check();
      await expect(showCompletedLines).toBeChecked();

      await expect.poll(async () => {
        const savedCard = await fetchSavedCard(cardId);
        return savedCard?.updatedAt ?? null;
      }, { timeout: 5000, intervals: [500, 1000] }).toBe(savedBeforePreviewToggle?.updatedAt ?? null);

      await page.goto(boardContext.canonicalPath);
      await expect(cardDetailRoot(page)).toHaveCount(0);

      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const reopenedModal = cardDetailRoot(page);
      await expect(reopenedModal).toBeVisible();
      const reopenedCompletedLinesPanel = reopenedModal.getByTestId('card-modal-completed-lines-panel');
      if (!(await reopenedCompletedLinesPanel.isVisible())) {
        await reopenedModal.getByTitle('Show details').click();
      }
      await expect(reopenedCompletedLinesPanel).toBeVisible();
      await expect(reopenedModal.getByTestId('card-modal-show-completed-lines')).toBeChecked();
      await expect(reopenedModal.locator('.ProseMirror > ul[data-type="taskList"] > li[data-checked="true"] p').first()).toBeVisible();
      await expect(reopenedModal.getByTestId('tiptap-hidden-run-marker-button')).toHaveCount(0);
    } finally {
      await supabaseAdmin.from('card_content_history').delete().eq('card_id', cardId);
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
      const modal = cardDetailRoot(page);
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

  test('opens empty-title card with focus on title input', async ({ page }) => {
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
      title: '',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [],
      },
      excerpt: '',
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1898,
      tags: [],
      due_date: isoDay,
      due_start: '15:30:00',
      due_end: '16:30:00',
      due_bucket: null,
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5045,
      slug: 'untitled-card-focus',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = cardDetailRoot(page);
      await expect(modal).toBeVisible();

      const titleInput = modal.getByTestId('card-modal-title-input');
      await expect(titleInput).toBeFocused();

      await expect.poll(async () => {
        return titleInput.evaluate((element) => {
          const input = element as HTMLTextAreaElement;
          return {
            valueLength: input.value.length,
            selectionStart: input.selectionStart,
            selectionEnd: input.selectionEnd,
          };
        });
      }).toEqual({
        valueLength: 0,
        selectionStart: 0,
        selectionEnd: 0,
      });
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
      const modal = cardDetailRoot(page);
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
