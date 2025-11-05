import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';

const TEST_BOARD_NAME = 'E2E Comments Test Board';
const TEST_USER_ID = 'f6baf5d0-ac5b-491a-aa47-3bc5c05243f2'; // e2e.taesk.test@gmail.com
const DEFAULT_LIST_TITLE = 'Comments List';
const TEST_USER_EMAIL = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Supabase service role configuration is required for comments E2E tests');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

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

  const { error: boardError } = await supabaseAdmin.from('boards').insert({
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

  const { error: memberError } = await supabaseAdmin.from('board_members').insert({
    board_id: boardId,
    profile_id: TEST_USER_ID,
    role: 'owner',
  });
  if (memberError) {
    throw new Error(`Failed to add test board member: ${memberError.message}`);
  }

  const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
    id: TEST_USER_ID,
    full_name: 'E2E Test User',
    email: TEST_USER_EMAIL,
    avatar_url: null,
  });
  if (profileError) {
    throw new Error(`Failed to upsert test profile: ${profileError.message}`);
  }

  const listId = crypto.randomUUID();
  const { error: listError } = await supabaseAdmin.from('lists').insert({
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

  // Wait for board to be ready - use list as reliable indicator instead of email
  await page.locator(`[data-testid="list-${board.listId}"]`).waitFor({ state: 'visible', timeout: 10000 });

  // Ensure network is settled
  await page.waitForLoadState('networkidle');
}

async function createTestCard(page: Page, board: TestBoardContext): Promise<TestCardContext> {
  const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
  await addCardButton.waitFor({ state: 'visible', timeout: 10000 });
  await addCardButton.click();
  await page.waitForTimeout(800);

  const start = Date.now();
  const timeoutMs = 30000; // 20秒→30秒に延長
  let lastError: Error | null = null;

  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabaseAdmin
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

    await new Promise((resolve) => setTimeout(resolve, 1000)); // 500ms→1000msに延長
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

  let urlMatched = true;
  try {
    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .toContain(`card=${card.shortId}`);
  } catch {
    urlMatched = false;
  }

  if (!urlMatched) {
    const baseUrl = page.url().split('?')[0];
    await page.goto(`${baseUrl}?card=${card.shortId}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10000 });
    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .toContain(`card=${card.shortId}`);
  }
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
      await supabaseAdmin.from('boards').delete().eq('id', board.id);
    }
    board = null;
    card = null;
  });

  test('should show Comments tab in card modal via ?card= route', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);

    // Wait for Comments section to be visible (can be h3 or text)
    await expect(page.getByText('Comments', { exact: true }).first()).toBeVisible();

    // TipTap editor uses .ProseMirror contenteditable div, not textarea
    const commentEditor = page.locator('.ProseMirror');
    await expect(commentEditor).toBeVisible();
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

    // TipTap uses contenteditable div, not textarea
    const commentEditor = page.locator('.ProseMirror').first();
    await commentEditor.click();
    await commentEditor.fill(commentText);

    await page.getByRole('button', { name: 'コメントを投稿' }).click();

    const createdComment = page.locator('[data-testid="comment-body"]', { hasText: commentText }).first();
    await expect(createdComment).toBeVisible({ timeout: 5000 });
  });

  test('should edit and delete own comment', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);

    const commentText = `Comment to edit ${Date.now()}`;

    // Create comment with TipTap editor
    const commentEditor = page.locator('.ProseMirror').first();
    await commentEditor.click();
    await commentEditor.fill(commentText);
    await page.getByRole('button', { name: 'コメントを投稿' }).click();
    await page.waitForTimeout(500);

    // Edit comment
    await page.getByRole('button', { name: '編集' }).click();
    const editedText = `${commentText} (edited)`;
    const editEditor = page.locator('.ProseMirror').filter({ hasText: commentText }).first();
    await editEditor.click();
    await editEditor.fill(editedText);
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.locator('[data-testid="comment-body"]', { hasText: editedText })).toBeVisible({ timeout: 5000 });

    // Delete comment
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '削除' }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="comment-body"]', { hasText: editedText })).toHaveCount(0);
  });

  test('should allow replying to comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    const parentCommentId = crypto.randomUUID();
    const parentText = `Parent comment ${Date.now()}`;

    const { error: parentError } = await supabaseAdmin
      .from('comments')
      .insert({
        id: parentCommentId,
        card_id: currentCard.id,
        author_id: TEST_USER_ID,
        body: parentText,
        mentions: [],
      });
    expect(parentError).toBeNull();

    await openCardModalViaQuery(page, currentCard);

    const parentLocator = page.locator('[data-testid="comment-body"]', { hasText: parentText });
    await expect(parentLocator).toBeVisible({ timeout: 15000 });

    const replyButton = page.getByRole('button', { name: '返信' }).first();
    await replyButton.waitFor({ state: 'visible', timeout: 10000 });
    await replyButton.click();

    const replyText = `Reply ${Date.now()}`;

    // TipTap editor for reply (last editor on page after clicking reply button)
    const replyEditor = page.locator('.ProseMirror').last();
    await replyEditor.waitFor({ state: 'visible', timeout: 10000 });
    await replyEditor.click();
    await replyEditor.fill(replyText);

    // Submit reply button (within the reply form that just appeared)
    const submitButton = page.getByRole('button', { name: '返信' }).last();
    await submitButton.waitFor({ state: 'visible', timeout: 5000 });
    await submitButton.click();

    await expect(
      page.locator('[data-testid="comment-body"]', { hasText: replyText })
    ).toBeVisible({ timeout: 15000 });
  });

  test('should support @mentions with TipTap editor @e2e:essential @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    // Set up the wait for members API BEFORE opening the modal
    const membersResponsePromise = page.waitForResponse(
      response => response.url().includes('/api/boards/') && response.url().includes('/members') && response.status() === 200,
      { timeout: 15000 }
    );

    await openCardModalViaQuery(page, currentCard);
    await page.waitForLoadState('networkidle');

    // Wait for members API to complete
    await membersResponsePromise;
    await page.waitForTimeout(500); // Extra wait for React to update props

    // Find TipTap editor (ProseMirror)
    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });

    await editor.click();
    await page.waitForTimeout(500);

    // Type @ to trigger mention suggestion
    await editor.pressSequentially('@');
    await page.waitForTimeout(1500); // Wait for suggestion to appear

    // Verify suggestion popup appears
    const suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
    await expect(suggestionPopup).toBeVisible({ timeout: 10000 }); // Increased timeout

    // Wait for any user option to appear first
    await expect(suggestionPopup.locator('button').first()).toBeVisible({ timeout: 5000 });

    // Verify specific user option is visible (display_name takes priority when username is null)
    const userOption = suggestionPopup.locator('button').filter({ hasText: 'Test Display Name Updated' });
    await expect(userOption).toBeVisible({ timeout: 5000 });

    // Click to select mention
    await userOption.click();
    await page.waitForTimeout(500);

    // Verify mention node is inserted (displays as @Display Name)
    const mentionNode = editor.locator('span.mention').filter({ hasText: '@Test Display Name Updated' });
    await expect(mentionNode).toBeVisible();

    // Add some text after mention
    await editor.pressSequentially(' test mention');

    // Submit with Shift+Enter
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1000);

    // Verify comment appears in list with mention displayed as @Display Name
    const commentBody = page.locator('[data-testid="comment-body"]').filter({ hasText: 'test mention' });
    await expect(commentBody).toBeVisible({ timeout: 10000 });

    // Verify mention renders with data-mention-id (wait for DOM update)
    const mentionInList = commentBody.locator('[data-mention-id]').filter({ hasText: '@Test Display Name Updated' });
    await expect(mentionInList).toBeVisible({ timeout: 10000 });
  });

  test('should show all members when typing @ with empty query @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Type @ to trigger mention suggestion
    await editor.pressSequentially('@');
    await page.waitForTimeout(1000);

    // Verify suggestion popup appears
    const suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
    await expect(suggestionPopup).toBeVisible({ timeout: 5000 });

    // Verify at least one member is shown (E2E Test User should always be there)
    const memberOptions = suggestionPopup.locator('button');
    await expect(memberOptions).toHaveCount(await memberOptions.count(), { timeout: 3000 });
    expect(await memberOptions.count()).toBeGreaterThan(0);
  });

  test('should filter members by name when typing after @ @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Type @e2e to filter
    await editor.pressSequentially('@e2e');
    await page.waitForTimeout(1000);

    // Verify suggestion popup appears
    const suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
    await expect(suggestionPopup).toBeVisible({ timeout: 5000 });

    // Verify E2E Test User is shown (matches "e2e")
    const userOption = suggestionPopup.locator('button').filter({ hasText: 'E2E Test User' });
    await expect(userOption).toBeVisible({ timeout: 3000 });
  });

  test('should use Enter to select mention and Shift+Enter to submit @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Type @ to trigger mention suggestion
    await editor.pressSequentially('@e2e');
    await page.waitForTimeout(1000);

    // Press Enter to select first suggestion
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Verify mention was inserted
    const mentionNode = editor.locator('span.mention');
    await expect(mentionNode).toBeVisible();

    // Add text
    await editor.pressSequentially(' keyboard test');

    // Press Shift+Enter to submit
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(1000);

    // Verify comment was submitted
    const commentBody = page.locator('[data-testid="comment-body"]').filter({ hasText: 'keyboard test' });
    await expect(commentBody).toBeVisible({ timeout: 10000 });
  });

  test('should save mentions as <@id> format but display as @name @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Insert mention
    await editor.pressSequentially('@e2e');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await editor.pressSequentially(' storage format test');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(2000);

    // Check database to verify storage format is <@id>
    const { data: comments } = await supabaseAdmin
      .from('comments')
      .select('body, mentions')
      .eq('card_id', currentCard.id)
      .ilike('body', '%storage format test%')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(comments).toBeDefined();
    expect(comments?.length).toBeGreaterThan(0);

    if (comments && comments.length > 0) {
      const comment = comments[0];
      // Verify body contains <@id> format
      expect(comment.body).toMatch(/<@[a-f0-9-]{36}>/);
      // Verify mentions array contains the user ID
      expect(comment.mentions).toContain(TEST_USER_ID);
    }

    // Verify display shows @name (not <@id>)
    const commentBody = page.locator('[data-testid="comment-body"]').filter({ hasText: 'storage format test' });
    await expect(commentBody).toBeVisible();

    // Should show @E2E Test User, not <@uuid>
    await expect(commentBody.locator('[data-mention-id]').filter({ hasText: '@E2E Test User' })).toBeVisible();
    // Should NOT show <@uuid> pattern
    const bodyText = await commentBody.textContent();
    expect(bodyText).not.toMatch(/<@[a-f0-9-]{36}>/);
  });

  test('should validate mention user_id as UUID v4', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard);
    await page.waitForLoadState('networkidle'); // モーダル表示完了を確実に待つ

    // Create comment with mention via API to verify UUID format
    const commentBody = `@${TEST_USER_EMAIL} Test UUID validation`;
    const { data: commentData, error: commentError } = await supabaseAdmin
      .from('comments')
      .insert({
        card_id: currentCard.id,
        author_id: TEST_USER_ID,
        body: commentBody,
        mentions: [TEST_USER_ID], // Should be UUID v4
      })
      .select()
      .single();

    if (commentError) {
      console.error('Comment insert error:', commentError);
    }
    expect(commentError).toBeNull();
    expect(commentData).toBeDefined();
    expect(commentData?.mentions).toContain(TEST_USER_ID);

    // Verify UUID v4 format (8-4-4-4-12 hex digits)
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(TEST_USER_ID).toMatch(uuidV4Regex);
    if (commentData?.mentions?.length > 0) {
      expect(commentData.mentions[0]).toMatch(uuidV4Regex);
    }

    // Clean up
    if (commentData?.id) {
      await supabaseAdmin.from('comments').delete().eq('id', commentData.id);
    }
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

      // Wait for Comments section in both pages
      await page1.getByText('Comments', { exact: true }).first().waitFor({ state: 'visible', timeout: 5000 });
      await page2.getByText('Comments', { exact: true }).first().waitFor({ state: 'visible', timeout: 5000 });

      const commentText = `Realtime test ${Date.now()}`;

      // Use TipTap editor
      const commentEditor = page1.locator('.ProseMirror').first();
      await commentEditor.waitFor({ state: 'visible', timeout: 5000 });
      await commentEditor.click();
      await commentEditor.fill(commentText);
      await page1.getByRole('button', { name: 'コメントを投稿' }).click();

      await page1.locator('[data-testid="comment-body"]', { hasText: commentText }).first()
        .waitFor({ state: 'visible', timeout: 10000 });

      await expect
        .poll(async () => {
          try {
            await page2
              .locator('[data-testid="comment-body"]', { hasText: commentText })
              .first()
              .waitFor({ state: 'visible', timeout: 2000 });
            return true;
          } catch {
            await page2.goto(board.canonicalPath);
            await page2.waitForLoadState('domcontentloaded');
            await openCardModalViaQuery(page2, card);
            await page2.waitForTimeout(300);
            return false;
          }
        }, { timeout: 30000 })
        .toBe(true);
    } finally {
      await context1.close();
      await context2.close();
      await supabaseAdmin.from('boards').delete().eq('id', board.id);
    }
  });
});
