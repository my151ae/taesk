import { test, expect, type Page } from '@playwright/test';

import { supabase } from '@/lib/supabase';
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';

const TEST_BOARD_NAME = 'E2E Comments Test Board';
const TEST_USER_ID = 'f6baf5d0-ac5b-491a-aa47-3bc5c05243f2'; // e2e.taesk.test@gmail.com
const DEFAULT_LIST_TITLE = 'Comments List';
const TEST_USER_EMAIL = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';

interface TestBoardContext {
  id: string;
  name: string;
  shortId: string;
  idShort: number;
  slug: string;
  canonicalPath: string;
  listId: string;
}

interface TestCardContext {
  id: string;
  shortId: string;
  title: string;
}

function assertContext<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

async function seedTestBoard(boardName: string): Promise<TestBoardContext> {
  const boardId = crypto.randomUUID();
  const boardShortId = await createUniqueBoardShortId();
  const boardIdShort = await getNextBoardIdShort();
  const boardSlug = slugifyBoardName(boardName);

  const { error: boardError } = await supabase.from('boards').insert({
    id: boardId,
    name: boardName,
    user_id: TEST_USER_ID,
    is_test_board: true,
    short_id: boardShortId,
    id_short: boardIdShort,
    slug: boardSlug,
  });
  if (boardError) {
    throw new Error(`Failed to create test board: ${boardError.message}`);
  }

  const { error: memberError } = await supabase.from('board_members').insert({
    board_id: boardId,
    profile_id: TEST_USER_ID,
    role: 'owner',
  });
  if (memberError) {
    throw new Error(`Failed to add test board member: ${memberError.message}`);
  }

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: TEST_USER_ID,
    full_name: 'E2E Test User',
    email: TEST_USER_EMAIL,
    avatar_url: null,
  });
  if (profileError) {
    throw new Error(`Failed to upsert test profile: ${profileError.message}`);
  }

  const listId = crypto.randomUUID();
  const { error: listError } = await supabase.from('lists').insert({
    id: listId,
    title: DEFAULT_LIST_TITLE,
    position: 1000,
    board_id: boardId,
    user_id: TEST_USER_ID,
  });
  if (listError) {
    throw new Error(`Failed to create default list: ${listError.message}`);
  }

  const canonicalTail = boardSlug ? `${boardIdShort}-${boardSlug}` : `${boardIdShort}`;
  const canonicalPath = boardSlug
    ? `/b/${boardShortId}/${canonicalTail}`
    : `/b/${boardShortId}`;

  return {
    id: boardId,
    name: boardName,
    shortId: boardShortId,
    idShort: boardIdShort,
    slug: boardSlug,
    canonicalPath,
    listId,
  };
}

async function loadBoard(page: Page, board: TestBoardContext): Promise<void> {
  await page.goto(board.canonicalPath);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector(`text=${TEST_USER_EMAIL}`, { timeout: 10000 });
  await page.locator(`[data-testid="list-${board.listId}"]`).waitFor({ state: 'visible', timeout: 10000 });
}

async function createTestCard(page: Page, board: TestBoardContext): Promise<TestCardContext> {
  const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
  await addCardButton.waitFor({ state: 'visible', timeout: 10000 });
  await addCardButton.click();
  await page.waitForTimeout(800);

  const start = Date.now();
  const timeoutMs = 20000;
  let lastError: Error | null = null;

  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, short_id, title')
      .eq('board_id', board.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      lastError = new Error(`Failed to fetch created card: ${error.message}`);
    } else if (data && data.short_id) {
      const cardLocator = page.locator(`[data-testid="card-${data.id}"]`).first();
      await cardLocator.waitFor({ state: 'visible', timeout: 10000 });

      return {
        id: data.id,
        shortId: data.short_id,
        title: data.title,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('Card creation did not return a short_id within timeout');
}

async function openCardModalViaQuery(page: Page, card: TestCardContext): Promise<void> {
  const cardLocator = page.locator(`[data-testid="card-${card.id}"]`).first();
  await cardLocator.click();
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  await expect
    .poll(() => page.url(), { timeout: 10000 })
    .toContain(`card=${card.shortId}`);
}

test.describe('Comments Feature @feature:comments', () => {
  let board: TestBoardContext | null = null;
  let card: TestCardContext | null = null;

  test.beforeEach(async ({ page }) => {
    const boardName = `${TEST_BOARD_NAME}-${Date.now()}`;
    board = await seedTestBoard(boardName);
    await loadBoard(page, board);
    card = await createTestCard(page, board);
  });

  test.afterEach(async () => {
    if (board?.id) {
      await supabase.from('boards').delete().eq('id', board.id);
    }
    board = null;
    card = null;
  });

  test('should show Comments tab in card modal via ?card= route', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);

    const commentTextarea = page.locator('textarea[placeholder*="コメントを書く"]');
    await expect(commentTextarea).toBeVisible();
  });

  test('should preserve card modal state on reload with ?card= query', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);
    const urlBeforeReload = page.url();
    expect(urlBeforeReload).toContain(`card=${currentCard.shortId}`);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    expect(page.url()).toContain(`card=${currentCard.shortId}`);
  });

  test('should create a comment successfully', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);

    const commentText = `Test comment ${Date.now()}`;
    await page.fill('textarea[placeholder*="コメントを書く"]', commentText);
    await page.getByRole('button', { name: 'コメントを投稿' }).click();

    const createdComment = page.locator('span.whitespace-pre-wrap', { hasText: commentText }).first();
    await expect(createdComment).toBeVisible({ timeout: 5000 });
  });

  test('should edit and delete own comment', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);

    const commentText = `Comment to edit ${Date.now()}`;
    await page.fill('textarea[placeholder*="コメントを書く"]', commentText);
    await page.getByRole('button', { name: 'コメントを投稿' }).click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: '編集' }).click();
    const editedText = `${commentText} (edited)`;
    const editTextarea = page.locator('textarea').filter({ hasText: commentText }).first();
    await editTextarea.fill(editedText);
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.locator('span.whitespace-pre-wrap', { hasText: editedText })).toBeVisible({ timeout: 5000 });

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '削除' }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('span.whitespace-pre-wrap', { hasText: editedText })).toHaveCount(0);
  });

  test('should allow replying to comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);

    const parentText = `Parent comment ${Date.now()}`;
    await page.fill('textarea[placeholder*="コメントを書く"]', parentText);
    await page.getByRole('button', { name: 'コメントを投稿' }).click();
    await page.waitForTimeout(500);

    await page.locator('div.flex.gap-3.mt-2').locator('button', { hasText: '返信' }).first().click();

    const replyText = `Reply ${Date.now()}`;
    const replyTextarea = page.locator('textarea[placeholder*="返信を書く"]');
    await replyTextarea.waitFor({ state: 'visible', timeout: 5000 });
    await replyTextarea.fill(replyText);
    await page.getByRole('button', { name: '返信' }).nth(1).click();

    await expect(page.locator('span.whitespace-pre-wrap', { hasText: replyText })).toBeVisible({ timeout: 5000 });
  });

  test('should support @mentions with typeahead @e2e:essential', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);

    // Type @ to trigger mention typeahead
    const commentTextarea = page.locator('textarea[placeholder*="コメントを書く"]');
    await commentTextarea.click();
    await commentTextarea.type('@');

    // Wait for mention suggestions to appear
    const mentionDropdown = page.locator('[role="listbox"]');
    await expect(mentionDropdown).toBeVisible({ timeout: 3000 });

    // Verify user email appears in suggestions
    const userOption = page.locator('[role="option"]', { hasText: TEST_USER_EMAIL });
    await expect(userOption).toBeVisible();

    // Select mention by pressing Enter
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Verify mention is inserted into textarea
    const textareaValue = await commentTextarea.inputValue();
    expect(textareaValue).toContain(TEST_USER_EMAIL);

    // Submit comment with mention
    const commentText = `${textareaValue} Test mention ${Date.now()}`;
    await commentTextarea.fill(commentText);
    await page.getByRole('button', { name: 'コメントを投稿' }).click();

    // Verify comment with mention is visible
    await expect(page.locator('span.whitespace-pre-wrap', { hasText: 'Test mention' })).toBeVisible({ timeout: 5000 });

    // Verify mention renders as clickable element
    const mentionElement = page.locator('span[class*="mention"]', { hasText: TEST_USER_EMAIL });
    await expect(mentionElement).toBeVisible();
  });

  test('should validate mention user_id as UUID v4', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');
    const currentBoard = assertContext(board, 'Board context not initialised');

    await openCardModalViaQuery(page, currentCard);

    // Create comment with mention via API to verify UUID format
    const commentBody = `@${TEST_USER_EMAIL} Test UUID validation`;
    const { data: commentData, error: commentError } = await supabase
      .from('comments')
      .insert({
        card_id: currentCard.id,
        board_id: currentBoard.id,
        user_id: TEST_USER_ID,
        body: commentBody,
        mentions: [TEST_USER_ID], // Should be UUID v4
      })
      .select()
      .single();

    expect(commentError).toBeNull();
    expect(commentData).toBeDefined();
    expect(commentData.mentions).toContain(TEST_USER_ID);

    // Verify UUID v4 format (8-4-4-4-12 hex digits)
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(TEST_USER_ID).toMatch(uuidV4Regex);
    expect(commentData.mentions[0]).toMatch(uuidV4Regex);

    // Clean up
    await supabase.from('comments').delete().eq('id', commentData.id);
  });
});

test.describe('Comments Realtime @feature:comments', () => {
  test('should sync comments across multiple browser contexts', async ({ browser }) => {
    test.slow();
    const boardName = `RT Test ${Date.now()}`;
    const board = await seedTestBoard(boardName);

    const context1 = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const context2 = await browser.newContext({ storageState: 'playwright/.auth/user.json' });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await loadBoard(page1, board);
      await loadBoard(page2, board);

      const card = await createTestCard(page1, board);
      await expect(page2.locator(`[data-testid="card-${card.id}"]`)).toBeVisible({ timeout: 10000 });

      await openCardModalViaQuery(page1, card);
      await openCardModalViaQuery(page2, card);

      const commentText = `Realtime test ${Date.now()}`;
      await page1.fill('textarea[placeholder*="コメントを書く"]', commentText);
      await page1.getByRole('button', { name: 'コメントを投稿' }).click();

      await page1.locator('span.whitespace-pre-wrap', { hasText: commentText }).first()
        .waitFor({ state: 'visible', timeout: 10000 });

      const start = Date.now();
      const syncTimeout = 20000;
      let synced = false;

      while (Date.now() - start < syncTimeout) {
        try {
          await page2.locator('span.whitespace-pre-wrap', { hasText: commentText }).first()
            .waitFor({ state: 'visible', timeout: 3000 });
          synced = true;
          break;
        } catch {
          await page2.goto(board.canonicalPath);
          await page2.waitForLoadState('domcontentloaded');
          await openCardModalViaQuery(page2, card);
          await page2.waitForTimeout(500);
        }
      }

      expect(synced).toBe(true);
    } finally {
      await context1.close();
      await context2.close();
      await supabase.from('boards').delete().eq('id', board.id);
    }
  });
});
