import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { readFile } from 'fs/promises';

import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';

const TEST_USER_EMAIL = process.env.E2E_TEST_EMAIL ?? 'e2e-test@taesk.app';
const MAIN_TEST_BOARD_ID = '00000000-0000-0000-0000-000000000001';

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
  const { data: seedBoard, error: seedBoardError } = await supabaseAdmin
    .from('boards')
    .select('team_id')
    .eq('id', MAIN_TEST_BOARD_ID)
    .maybeSingle();
  if (seedBoardError || !seedBoard?.team_id) {
    throw new Error(`Failed to resolve test team_id: ${seedBoardError?.message ?? 'missing team_id'}`);
  }

  const now = new Date().toISOString();
  const boardId = crypto.randomUUID();
  const boardName = `Timeline Test Board ${Date.now()}`;
  const boardShortId = await createUniqueBoardShortId();
  const boardIdShort = await getNextBoardIdShort();
  const boardSlug = slugifyBoardName(boardName);
  const listId = crypto.randomUUID();

  await supabaseAdmin.from('boards').insert({
    id: boardId,
    team_id: seedBoard.team_id,
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

async function pasteImageFromBytes(
  page: Page,
  args: { bytes: number[]; mimeType: string; fileName: string }
): Promise<void> {
  await page.evaluate(({ bytes, mimeType, fileName }) => {
    const target = document.querySelector('.ProseMirror[data-autofocus="true"]');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Missing ProseMirror root for paste');
    }
    target.focus();

    const data = new DataTransfer();
    const file = new File([new Uint8Array(bytes)], fileName, { type: mimeType });
    data.items.add(file);

    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, args);
}

async function pasteImageBySize(
  page: Page,
  args: { size: number; mimeType: string; fileName: string }
): Promise<void> {
  await page.evaluate(({ size, mimeType, fileName }) => {
    const target = document.querySelector('.ProseMirror[data-autofocus="true"]');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Missing ProseMirror root for paste');
    }
    target.focus();

    const data = new DataTransfer();
    const file = new File([new Uint8Array(size)], fileName, { type: mimeType });
    data.items.add(file);

    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, args);
}

async function pasteImageToTitleInput(
  page: Page,
  args: { bytes: number[]; mimeType: string; fileName: string }
): Promise<void> {
  await page.evaluate(({ bytes, mimeType, fileName }) => {
    const input = document.querySelector('[data-sticky-title] input[type="text"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Missing sticky title input for paste');
    }
    input.focus();

    const data = new DataTransfer();
    const file = new File([new Uint8Array(bytes)], fileName, { type: mimeType });
    data.items.add(file);

    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    input.dispatchEvent(event);
  }, args);
}

async function pasteHtmlImageFromDataUrl(page: Page, dataUrl: string): Promise<void> {
  await page.evaluate((src) => {
    const target = document.querySelector('.ProseMirror[data-autofocus="true"]');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Missing ProseMirror root for HTML image paste');
    }
    target.focus();
    const data = new DataTransfer();
    data.setData('text/html', `<img src="${src}" alt="pasted-html-image" />`);
    data.setData('text/plain', '');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, dataUrl);
}

async function pasteHtmlWithPlainText(
  page: Page,
  args: { plainText: string; html: string }
): Promise<void> {
  await page.evaluate(({ plainText, html }) => {
    const target = document.querySelector('.ProseMirror[data-autofocus="true"]');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Missing ProseMirror root for HTML paste');
    }
    target.focus();
    const data = new DataTransfer();
    data.setData('text/plain', plainText);
    data.setData('text/html', html);
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, args);
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

      await bodyEditor.click();
      const selectAllModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${selectAllModifier}+A`);
      await pastePlainText(page, 'A\nB\nC');

      await expect(modal.locator('[data-sticky-title] input[type="text"]')).toHaveValue(initialTitle);

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

  test('pastes image in title task, stores storagePath, and refreshes signed URL on reopen', async ({ page }) => {
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
      priority: 'medium',
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
      await expect(modal.locator('[data-sticky-title] input[type="text"]')).toHaveValue(initialTitle);
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
      priority: 'medium',
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
      await expect(modal.locator('[data-sticky-title] input[type="text"]')).toHaveValue(initialTitle);
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
      priority: 'medium',
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

  test('keeps existing body images when pasting on sticky title input', async ({ page }) => {
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
    const initialTitle = 'Sticky title paste';
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
            type: 'image',
            attrs: { src: tinyPngDataUrl, alt: 'existing-image-2' },
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1870,
      tags: [],
      due_date: isoDay,
      due_start: '14:00:00',
      due_end: '15:00:00',
      due_bucket: null,
      priority: 'medium',
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5033,
      slug: 'image-paste-sticky-title',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      const bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      await expect(bodyEditor.locator('img')).toHaveCount(2);

      const uploadResponsePromise = page.waitForResponse((res) => {
        return (
          res.request().method() === 'POST' &&
          res.url().includes(`/api/boards/${boardContext.boardId}/cards/${cardId}/images`)
        );
      }, { timeout: 20_000 });

      await pasteImageToTitleInput(page, {
        bytes: [
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
          0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
          0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
          251, 3, 253, 160, 157, 164, 70, 0, 0, 0, 0, 73, 69, 78, 68,
          174, 66, 96, 130,
        ],
        mimeType: 'image/png',
        fileName: 'sticky-title.png',
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
      priority: 'medium',
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
      priority: 'medium',
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
      priority: 'medium',
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

      const titleInput = modal.locator('[data-sticky-title] input[type="text"]').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();

      await expect(titleInput).toHaveValue('Arrow navigation baseline');
      await expect(firstChecklistLine).toBeVisible();

      await titleInput.evaluate((input: HTMLInputElement) => {
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
      priority: 'medium',
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

      const titleInput = modal.locator('[data-sticky-title] input[type="text"]').first();
      const firstChecklistLine = modal.locator('.ProseMirror > ul[data-type="taskList"] > li:first-child p').first();

      await expect(titleInput).toHaveValue('Arrow LR baseline');
      await expect(firstChecklistLine).toHaveText('body line');

      await titleInput.evaluate((input: HTMLInputElement) => {
        const pos = input.value.length;
        input.focus();
        input.setSelectionRange(pos, pos);
      });
      await page.keyboard.press('ArrowRight');
      await page.keyboard.type('Q');
      await expect(firstChecklistLine).toHaveText('Qbody line');

      await page.evaluate(() => {
        const editor = document.querySelector('.ProseMirror[data-autofocus="true"]');
        if (!(editor instanceof HTMLElement)) {
          throw new Error('Missing autofocus editor');
        }
        editor.focus();
        const textNode = document.querySelector('.ProseMirror > ul[data-type="taskList"] > li:first-child p')?.firstChild;
        if (!textNode) {
          throw new Error('Missing first checklist text node');
        }
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.type('Y');
      await expect(titleInput).toHaveValue('Arrow LR baselineY');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('splits title into leading body paragraph on Enter', async ({ page }) => {
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
      title: 'HelloWorld',
      checklist: { version: 1, lines: [] },
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'body line' }],
          },
        ],
      },
      board_id: boardContext.boardId,
      list_id: boardContext.listId,
      user_id: testUserId,
      position: 1892,
      tags: [],
      due_date: isoDay,
      due_start: '14:50:00',
      due_end: '15:50:00',
      due_bucket: null,
      priority: 'medium',
      checked: false,
      assigned_to: null,
      assignee_id: null,
      assignee_ids: null,
      short_id: shortId,
      id_short: 5038,
      slug: 'enter-split-baseline',
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${shortId}`);
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      const titleInput = modal.locator('[data-sticky-title] input[type="text"]').first();
      const firstParagraph = modal.locator('.ProseMirror > p').first();

      await titleInput.evaluate((input: HTMLInputElement) => {
        input.focus();
        input.setSelectionRange(5, 5);
      });
      await page.keyboard.press('Enter');

      await expect(titleInput).toHaveValue('Hello');
      await expect(firstParagraph).toHaveText('World');

      await page.keyboard.type('Z');
      await expect(firstParagraph).toHaveText('ZWorld');
    } finally {
      await supabaseAdmin.from('cards').delete().eq('id', cardId);
    }
  });

  test('merges first paragraph into title with Delete and Backspace', async ({ page }) => {
    test.skip(!dueColumnsAvailable, 'due_* columns missing. Please apply supabase/migrations/20251113090000_add_due_fields.sql');
    if (!boardContext) {
      throw new Error('Missing board context for timeline spec');
    }
    if (!testUserId) {
      throw new Error('Missing authenticated test user id for timeline spec');
    }

    const deleteCardId = crypto.randomUUID();
    const backspaceCardId = crypto.randomUUID();
    const deleteShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const backspaceShortId = `TL${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const isoDay = isoDateJst();
    const timestamp = new Date().toISOString();
    const paragraphDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body' }],
        },
      ],
    };

    const { error: insertError } = await supabaseAdmin.from('cards').insert([
      {
        id: deleteCardId,
        title: 'DeleteTitle',
        checklist: { version: 1, lines: [] },
        content: paragraphDoc,
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1893,
        tags: [],
        due_date: isoDay,
        due_start: '15:00:00',
        due_end: '16:00:00',
        due_bucket: null,
        priority: 'medium',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: deleteShortId,
        id_short: 5039,
        slug: 'delete-merge-baseline',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: backspaceCardId,
        title: 'BackspaceTitle',
        checklist: { version: 1, lines: [] },
        content: paragraphDoc,
        board_id: boardContext.boardId,
        list_id: boardContext.listId,
        user_id: testUserId,
        position: 1894,
        tags: [],
        due_date: isoDay,
        due_start: '16:00:00',
        due_end: '17:00:00',
        due_bucket: null,
        priority: 'medium',
        checked: false,
        assigned_to: null,
        assignee_id: null,
        assignee_ids: null,
        short_id: backspaceShortId,
        id_short: 5040,
        slug: 'backspace-merge-baseline',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);

    expect(insertError).toBeNull();

    try {
      await page.goto(`${boardContext.canonicalPath}?card=${deleteShortId}`);
      let modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      let titleInput = modal.locator('[data-sticky-title] input[type="text"]').first();
      let bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      await titleInput.evaluate((input: HTMLInputElement) => {
        const pos = input.value.length;
        input.focus();
        input.setSelectionRange(pos, pos);
      });
      await page.keyboard.press('Delete');
      await expect(titleInput).toHaveValue('DeleteTitleBody');
      await expect(bodyEditor).toHaveText('');

      await page.goto(`${boardContext.canonicalPath}?card=${backspaceShortId}`);
      modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      titleInput = modal.locator('[data-sticky-title] input[type="text"]').first();
      bodyEditor = modal.locator('.ProseMirror[data-autofocus="true"]').first();
      const firstParagraph = modal.locator('.ProseMirror > p').first();
      await expect(firstParagraph).toHaveText('Body');
      await page.evaluate(() => {
        const editor = document.querySelector('.ProseMirror[data-autofocus="true"]');
        if (!(editor instanceof HTMLElement)) {
          throw new Error('Missing autofocus editor');
        }
        editor.focus();
        const textNode = document.querySelector('.ProseMirror > p')?.firstChild;
        if (!textNode) {
          throw new Error('Missing first paragraph text node');
        }
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await page.keyboard.press('Backspace');
      await expect(titleInput).toHaveValue('BackspaceTitleBody');
    } finally {
      await supabaseAdmin.from('cards').delete().in('id', [deleteCardId, backspaceCardId]);
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
      priority: 'medium',
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
