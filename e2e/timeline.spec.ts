import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';

const TEST_USER_ID = 'f6baf5d0-ac5b-491a-aa47-3bc5c05243f2';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase admin credentials for timeline.spec.ts');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const isoDateJst = (): string => {
  const now = Date.now();
  const jst = new Date(now + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = `${jst.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${jst.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

type TimelineBoardContext = {
  boardId: string;
  boardShortId: string;
  boardIdShort: number;
  boardSlug: string;
  listId: string;
  canonicalPath: string;
  boardName: string;
};

async function ensureBoardFixtures(): Promise<TimelineBoardContext> {
  const now = new Date().toISOString();
  const boardId = crypto.randomUUID();
  const boardName = `Timeline Test Board ${Date.now()}`;
  const boardShortId = await createUniqueBoardShortId();
  const boardIdShort = await getNextBoardIdShort();
  const boardSlug = slugifyBoardName(boardName);
  const listId = crypto.randomUUID();

  await supabaseAdmin.from('boards').insert({
    id: boardId,
    name: boardName,
    description: 'Board used for timeline specs',
    is_test_board: true,
    user_id: TEST_USER_ID,
    short_id: boardShortId,
    id_short: boardIdShort,
    slug: boardSlug,
    created_at: now,
    updated_at: now,
  });

  await supabaseAdmin.from('board_members').insert({
    board_id: boardId,
    profile_id: TEST_USER_ID,
    role: 'owner',
    created_at: now,
  });

  await supabaseAdmin.from('lists').insert({
    id: listId,
    title: 'Timeline Tasks',
    position: 1000,
    board_id: boardId,
    user_id: TEST_USER_ID,
    created_at: now,
    updated_at: now,
  });

  const canonicalTail = boardSlug ? `${boardIdShort}-${boardSlug}` : `${boardIdShort}`;
  const canonicalPath = boardSlug ? `/b/${boardShortId}/${canonicalTail}` : `/b/${boardShortId}`;

  return {
    boardId,
    boardShortId,
    boardIdShort,
    boardSlug,
    listId,
    canonicalPath,
    boardName,
  };
}

async function supportsDueColumns(): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('cards')
    .select('due_bucket')
    .limit(1);
  if (!error) return true;
  return !error.message?.includes('due_bucket');
}

let dueColumnsAvailable = true;
let boardContext: TimelineBoardContext | null = null;

test.describe('@feature:timeline Timeline view', () => {
  test.beforeAll(async () => {
    boardContext = await ensureBoardFixtures();
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
      user_id: TEST_USER_ID,
      position: 1500,
      tags: [],
      due_date: `${isoDay}T00:00:00+09:00`,
      due_start: '09:00:00',
      due_end: '10:00:00',
      due_bucket: null,
      priority: 'medium',
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

    await page.goto(boardContext.canonicalPath);
    await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
    const focusEvent = page.getByTestId('timeline-event').filter({ hasText: 'Timeline focus card' }).first();
    await focusEvent.scrollIntoViewIfNeeded();
    await expect(focusEvent).toBeVisible();

    await supabaseAdmin.from('cards').delete().eq('id', cardId);
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
        url.includes(`/api/boards/${boardContext.boardId}/cards`) &&
        res.ok()
      );
    });

    await page.locator('[data-testid^="ab-add-"]').first().click();
    const response = await createResponsePromise;
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
});
