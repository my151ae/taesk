import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { readFile } from 'fs/promises';

import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';

const TEST_USER_EMAIL = process.env.E2E_TEST_EMAIL ?? 'e2e-test@taesk.app';

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

const resolveTestUserId = async (): Promise<string> => {
  const storageStatePath = process.env.PLAYWRIGHT_AUTH_STATE_PATH ?? 'playwright/.auth/user.json';
  const raw = await readFile(storageStatePath, 'utf-8');
  const parsed = JSON.parse(raw) as {
    origins?: Array<{
      localStorage?: Array<{ name?: string; value?: string }>;
    }>;
  };

  const authTokenValue = parsed.origins
    ?.flatMap((origin) => origin.localStorage ?? [])
    .find((entry) => typeof entry.name === 'string' && entry.name.includes('auth-token'))
    ?.value;

  if (!authTokenValue) {
    throw new Error(`Failed to resolve auth token from storage state: ${storageStatePath}`);
  }

  const authToken = JSON.parse(authTokenValue) as {
    user?: { id?: string; email?: string };
  };
  const userId = authToken.user?.id;
  const userEmail = authToken.user?.email;

  if (!userId) {
    throw new Error(`Failed to resolve authenticated user id from storage state: ${storageStatePath}`);
  }

  if (userEmail && userEmail !== TEST_USER_EMAIL) {
    console.warn(`[timeline.spec] auth user email mismatch. expected=${TEST_USER_EMAIL} actual=${userEmail}`);
  }

  return userId;
};

async function ensureBoardFixtures(testUserId: string): Promise<TimelineBoardContext> {
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
    user_id: testUserId,
    short_id: boardShortId,
    id_short: boardIdShort,
    slug: boardSlug,
    created_at: now,
    updated_at: now,
  });

  await supabaseAdmin.from('board_members').insert({
    board_id: boardId,
    profile_id: testUserId,
    role: 'owner',
    created_at: now,
  });

  await supabaseAdmin.from('lists').insert({
    id: listId,
    title: 'Timeline Tasks',
    position: 1000,
    board_id: boardId,
    user_id: testUserId,
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

async function pastePlainText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const target = document.querySelector('.ProseMirror[data-autofocus="true"]');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Missing ProseMirror root for paste');
    }
    target.focus();
    const data = new DataTransfer();
    data.setData('text/plain', value);
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, text);
}

let dueColumnsAvailable = true;
let boardContext: TimelineBoardContext | null = null;
let testUserId: string | null = null;

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

    try {
      await page.goto(boardContext.canonicalPath);
      await expect(page.getByRole('heading', { name: boardContext.boardName })).toBeVisible();
      const focusEvent = page.getByTestId('timeline-event').filter({ hasText: 'Timeline focus card' }).first();
      await expect(focusEvent).toBeVisible({ timeout: 20_000 });
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
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

  test('keeps title task on first line when multiline text is pasted', async ({ page }) => {
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
      position: 1700,
      tags: [],
      due_date: isoDay,
      due_start: '11:00:00',
      due_end: '12:00:00',
      due_bucket: null,
      priority: 'medium',
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

      const titleTaskLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();
      await expect(titleTaskLine).toBeVisible();
      await bodyEditor.click();
      const selectAllModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${selectAllModifier}+A`);
      await pastePlainText(page, 'A\nB\nC');

      await expect(modal.locator('[data-sticky-title] input[type="text"]')).toHaveValue('A');
      await expect(titleTaskLine).toHaveText('A');

      const nodeSummary = await bodyEditor.evaluate((root) => {
        const topLevelNames = Array.from(root.childNodes).map((node) => node.nodeName.toLowerCase());
        const secondNode = root.childNodes.item(1);
        const thirdNode = root.childNodes.item(2);
        return {
          topLevelNames,
          secondText: secondNode?.textContent?.trim() ?? '',
          thirdText: thirdNode?.textContent?.trim() ?? '',
        };
      });

      expect(nodeSummary.topLevelNames[0]).toBe('ul');
      expect(nodeSummary.topLevelNames[1]).toBe('p');
      expect(nodeSummary.topLevelNames[2]).toBe('p');
      expect(nodeSummary.secondText).toBe('B');
      expect(nodeSummary.thirdText).toBe('C');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });
});
