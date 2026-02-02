import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';
import { generateShortId, slugify as slugifyCardTitle } from '@/lib/card-utils';

const TEST_BOARD_NAME = 'E2E Comments Test Board';
const TEST_USER_ID = 'f6baf5d0-ac5b-491a-aa47-3bc5c05243f2'; // e2e.taesk.test@gmail.com
const DEFAULT_LIST_TITLE = 'Comments List';
const TEST_DISPLAY_NAME = 'Test Display Name Updated';
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

const isoDateJst = (): string => {
  const now = Date.now();
  const jst = new Date(now + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = `${jst.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${jst.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
    full_name: TEST_DISPLAY_NAME,
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

  // Wait for board to be ready - use timeline grid as reliable indicator
  await page.locator('[data-testid="timeline-grid"]').waitFor({ state: 'visible', timeout: 10000 });

  // Ensure network is settled
  await page.waitForLoadState('networkidle');
}

async function createTestCard(board: TestBoardContext): Promise<TestCardContext> {
  const cardId = crypto.randomUUID();
  const shortId = generateShortId();
  const now = new Date().toISOString();

  const { data: lastCard } = await supabaseAdmin
    .from('cards')
    .select('position, id_short')
    .eq('board_id', board.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = lastCard?.position != null ? lastCard.position + 10 : 1000;
  const idShort = (lastCard?.id_short ?? 0) + 1;

  const { error } = await supabaseAdmin.from('cards').insert({
    id: cardId,
    title: 'New Card',
    checklist: { version: 1, lines: [] },
    board_id: board.id,
    list_id: board.listId,
    user_id: TEST_USER_ID,
    position,
    tags: [],
    due_date: `${isoDateJst()}T00:00:00+09:00`,
    due_bucket: 'a',
    due_bucket_position: 1000,
    priority: 'medium',
    assigned_to: null,
    assignee_id: null,
    assignee_ids: null,
    short_id: shortId,
    id_short: idShort,
    slug: slugifyCardTitle('New Card'),
    created_at: now,
    updated_at: now,
  });

  if (error) {
    throw new Error(`Failed to insert test card: ${error.message}`);
  }

  return {
    id: cardId,
    shortId,
    title: 'New Card',
  };
}

async function openCardModalViaQuery(page: Page, card: TestCardContext, boardContext?: TestBoardContext): Promise<void> {
  const waitForCardDetail = boardContext
    ? page
      .waitForResponse(
        (response) =>
          response.url().includes('/api/cards/') && response.url().includes('/detail') && response.status() === 200,
        { timeout: 15000 }
      )
      .catch(() => null)
    : null;

  if (boardContext && card.shortId) {
    const targetUrl = `${boardContext.canonicalPath}?card=${card.shortId}`;
    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForURL(`**card=${card.shortId}**`, { timeout: 10000 });
  } else {
    const openButton = page.getByTestId(`cardOpenButton-${card.id}`).first();
    await openButton.waitFor({ state: 'visible', timeout: 10000 });
    await openButton.click();
  }

  // Wait for modal to open with extended timeout
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 15000 });

  // Give the modal a moment to finish rendering
  await page.waitForTimeout(500);

  // Switch to Comments tab explicitly
  const commentsTab = page.getByRole('tab', { name: 'Comments' });
  if (await commentsTab.isVisible()) {
    await commentsTab.click();
    await page.waitForTimeout(300);
  }

  // Wait for Comments section to be ready
  await expect(page.getByText('Comments', { exact: true }).first()).toBeVisible({ timeout: 10000 });

  // Give it a moment to settle
  await page.waitForTimeout(500);

  if (waitForCardDetail) {
    await waitForCardDetail;
  }
}

async function waitForMentionOptions(page: Page, filterText?: string) {
  const suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
  await expect(suggestionPopup).toBeVisible({ timeout: 10000 });
  const options = suggestionPopup.locator('button');
  await expect(options.first()).toBeVisible({ timeout: 10000 });
  if (filterText) {
    await expect(options.filter({ hasText: filterText }).first()).toBeVisible({ timeout: 10000 });
  }
}

test.describe('Comments Feature @feature:comments', () => {
  let board: TestBoardContext | null = null;
  let card: TestCardContext | null = null;
  const requireBoardContext = (): TestBoardContext => assertContext(board, 'Board context not initialised');

  test.beforeEach(async ({ page }) => {
    const boardName = `${TEST_BOARD_NAME}-${Date.now()}`;
    board = await seedTestBoard(boardName);
    card = await createTestCard(board);
    await loadBoard(page, board);
    await page.locator(`[data-testid="ab-card-${card.id}"]`).first().waitFor({ state: 'visible', timeout: 15000 });
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

    await openCardModalViaQuery(page, currentCard, requireBoardContext());

    // Wait for Comments section to be visible (can be h3 or text)
    await expect(page.getByText('Comments', { exact: true }).first()).toBeVisible();

    // TipTap editor uses .ProseMirror contenteditable div, not textarea
    const commentEditor = page.locator('[data-testid="comments-panel"] .ProseMirror').first();
    await expect(commentEditor).toBeVisible();
  });

  test('should preserve card modal state on reload with ?card= query', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
    const urlBeforeReload = page.url();
    expect(urlBeforeReload).toContain(`card=${currentCard.shortId}`);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    expect(page.url()).toContain(`card=${currentCard.shortId}`);
  });

  test('should create a comment successfully', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());

    const commentText = `Test comment ${Date.now()}`;

    // TipTap uses contenteditable div, not textarea
    const commentEditor = page.locator('[data-testid="comments-panel"] .ProseMirror').first();
    await commentEditor.click();
    await commentEditor.fill(commentText);

    const createResponsePromise = page.waitForResponse((res) => {
      return (
        res.request().method() === 'POST' &&
        res.url().includes(`/api/cards/${currentCard.id}/comments`) &&
        res.ok()
      );
    });

    await page.getByRole('button', { name: 'コメントを投稿' }).click();
    await createResponsePromise;

    const createdComment = page.locator('[data-testid="comment-body"]', { hasText: commentText }).first();
    await expect(createdComment).toBeVisible({ timeout: 5000 });
  });

  test('should edit and delete own comment', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());

    const commentText = `Comment to edit ${Date.now()}`;

    // Create comment with TipTap editor
    const commentEditor = page.locator('[data-testid="comments-panel"] .ProseMirror').first();
    await commentEditor.click();
    await commentEditor.fill(commentText);
    const createResponsePromise = page.waitForResponse((res) => {
      return (
        res.request().method() === 'POST' &&
        res.url().includes(`/api/cards/${currentCard.id}/comments`) &&
        res.ok()
      );
    });
    await page.getByRole('button', { name: 'コメントを投稿' }).click();
    await createResponsePromise;

    // Edit comment
    await page.getByTestId('comments-panel').getByRole('button', { name: '編集' }).click();
    const editedText = `${commentText} (edited)`;
    const editEditor = page.getByTestId('comments-panel').locator('.ProseMirror').filter({ hasText: commentText }).first();
    await editEditor.click();
    await editEditor.fill(editedText);
    const updateResponsePromise = page.waitForResponse((res) => {
      return (
        res.request().method() === 'PATCH' &&
        res.url().includes('/api/comments/') &&
        res.ok()
      );
    });
    await page.getByTestId('comments-panel').getByRole('button', { name: '保存' }).click();
    await updateResponsePromise;

    await expect(page.locator('[data-testid="comment-body"]', { hasText: editedText })).toBeVisible({ timeout: 5000 });

    // Delete comment
    page.once('dialog', (dialog) => dialog.accept());
    const deleteResponsePromise = page.waitForResponse((res) => {
      return (
        res.request().method() === 'DELETE' &&
        res.url().includes('/api/comments/') &&
        res.ok()
      );
    });
    await page.getByTestId('comments-panel').getByRole('button', { name: '削除' }).click();
    await deleteResponsePromise;

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

    await openCardModalViaQuery(page, currentCard, requireBoardContext());

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

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
    await page.waitForLoadState('networkidle');
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
    const userOption = suggestionPopup.locator('button').filter({ hasText: TEST_DISPLAY_NAME });
    await expect(userOption).toBeVisible({ timeout: 5000 });

    // Click to select mention
    await userOption.click();
    await page.waitForTimeout(500);

    // Verify mention node is inserted (displays as @Display Name)
    const mentionNode = editor.locator('span.mention').filter({ hasText: `@${TEST_DISPLAY_NAME}` });
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
    const mentionInList = commentBody.locator('[data-mention-id]').filter({ hasText: `@${TEST_DISPLAY_NAME}` });
    await expect(mentionInList).toBeVisible({ timeout: 10000 });
  });

  test('should show all members when typing @ with empty query @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Type @ to trigger mention suggestion
    await editor.pressSequentially('@');
    await waitForMentionOptions(page);

    // Verify at least one member is shown (E2E Test User should always be there)
    const suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
    const memberOptions = suggestionPopup.locator('button');
    const optionCount = await memberOptions.count();
    expect(optionCount).toBeGreaterThan(0);
  });

  test('should filter members by name when typing after @ @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Type @e2e to filter and wait for suggestion list
    await editor.pressSequentially('@e2e');
    await waitForMentionOptions(page, 'Test');
  });

  test('should use Enter to select mention and Shift+Enter to submit @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Type @ to trigger mention suggestion
    await editor.pressSequentially('@e2e');
    await waitForMentionOptions(page);

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

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Insert mention
    await editor.pressSequentially('@e2e');
    await waitForMentionOptions(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await editor.pressSequentially(' storage format test');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(2000);

    // Check database to verify storage format is <@id>
    await expect.poll(async () => {
      const { data } = await supabaseAdmin
        .from('comments')
        .select('body, mentions')
        .eq('card_id', currentCard.id)
        .ilike('body', '%storage format test%')
        .order('created_at', { ascending: false })
        .limit(1);

      return data?.length ?? 0;
    }, { timeout: 15000 }).toBeGreaterThan(0);

    const { data: comments } = await supabaseAdmin
      .from('comments')
      .select('body, mentions')
      .eq('card_id', currentCard.id)
      .ilike('body', '%storage format test%')
      .order('created_at', { ascending: false })
      .limit(1);

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

    // Should show @Test (display name), not <@uuid>
    await expect(commentBody.locator('[data-mention-id]').filter({ hasText: '@Test' })).toBeVisible();
    // Should NOT show <@uuid> pattern
    const bodyText = await commentBody.textContent();
    expect(bodyText).not.toMatch(/<@[a-f0-9-]{36}>/);
  });

  test('should validate mention user_id as UUID v4', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
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

  test('should support full-width ＠ trigger @e2e:essential @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
    await page.waitForLoadState('networkidle');

    // Wait for members API to complete (not needed as initialProfiles are passed)
    // await membersResponsePromise;
    await page.waitForTimeout(500); // Extra wait for React to update props

    // Find TipTap editor (ProseMirror)
    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });

    await editor.click();
    await page.waitForTimeout(500);

    // Type full-width ＠ to trigger mention suggestion
    await editor.pressSequentially('＠');
    await waitForMentionOptions(page, TEST_DISPLAY_NAME);

    const suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
    const userOption = suggestionPopup.locator('button').filter({ hasText: TEST_DISPLAY_NAME });
    await expect(userOption).toBeVisible({ timeout: 5000 });

    // Click to select mention
    await userOption.click();
    await page.waitForTimeout(500);

    // Verify mention node was inserted in editor
    const mention = editor.locator('.mention').filter({ hasText: `@${TEST_DISPLAY_NAME}` });
    await expect(mention).toBeVisible({ timeout: 5000 });

    // Add some text after mention
    await editor.pressSequentially(' test full-width trigger');

    // Submit comment
    await page.getByRole('button', { name: 'コメントを投稿' }).click();
    await page.waitForTimeout(1000);

    // Verify comment appears in list with mention displayed
    const commentBody = page.locator('[data-testid="comment-body"]').filter({ hasText: 'test full-width trigger' });
    await expect(commentBody).toBeVisible({ timeout: 10000 });

    // Verify mention renders with data-mention-id
    const mentionInList = commentBody.locator('[data-mention-id]').filter({ hasText: `@${TEST_DISPLAY_NAME}` });
    await expect(mentionInList).toBeVisible({ timeout: 10000 });
  });

  test('should support mixed full-width and half-width triggers @feature:comments', async ({ page }) => {
    const currentCard = assertContext(card, 'Card context not initialised');

    await openCardModalViaQuery(page, currentCard, requireBoardContext());
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const editor = page.locator('.ProseMirror').last();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.waitForTimeout(500);

    // Test 1: Full-width ＠
    await editor.pressSequentially('＠');
    await waitForMentionOptions(page);

    let suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
    let userOption = suggestionPopup.locator('button').first();
    await userOption.click();
    await page.waitForTimeout(300);

    // Add space and test half-width @
    await editor.pressSequentially(' and @');
    await waitForMentionOptions(page);

    suggestionPopup = page.locator('.bg-white.border.border-gray-200.rounded-lg');
    userOption = suggestionPopup.locator('button').first();
    await userOption.click();
    await page.waitForTimeout(300);

    // Verify both mentions are in the editor
    const mentions = editor.locator('.mention');
    await expect(mentions).toHaveCount(2, { timeout: 5000 });
  });
});

test.describe('Comments Realtime @feature:comments', () => {
  test('should sync comments across multiple browser contexts @wip', async ({ browser }) => {
    test.slow();
    const boardName = `RT Test ${Date.now()}`;
    const board = await seedTestBoard(boardName);

    const context1 = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const context2 = await browser.newContext({ storageState: 'playwright/.auth/user.json' });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      const card = await createTestCard(board);
      await loadBoard(page1, board);
      await loadBoard(page2, board);
      await page1.locator(`[data-testid="ab-card-${card.id}"]`).first().waitFor({ state: 'visible', timeout: 15000 });
      await page2.locator(`[data-testid="ab-card-${card.id}"]`).first().waitFor({ state: 'visible', timeout: 15000 });

      await openCardModalViaQuery(page1, card, board);
      await openCardModalViaQuery(page2, card, board);

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
            await openCardModalViaQuery(page2, card, board);
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

test.describe('Comments Performance @feature:comments', () => {
  test.describe.configure({ mode: 'serial' });
  let board: TestBoardContext | null = null;
  let card: TestCardContext | null = null;

  test.beforeAll(async () => {
    const boardName = `Perf Test ${Date.now()}`;
    board = await seedTestBoard(boardName);
  });

  test.afterAll(async () => {
    if (board) {
      await supabaseAdmin.from('boards').delete().eq('id', board.id);
    }
  });

  test('should load comments modal within performance budget @perf', async ({ page }) => {
    const currentBoard = assertContext(board, 'Board context not initialized');

    const createdCard = await createTestCard(currentBoard);
    await loadBoard(page, currentBoard);

    card = createdCard;
    // Measure performance: Open modal and wait for comments to render
    const startTime = Date.now();
    await openCardModalViaQuery(page, createdCard, currentBoard);

    // Wait for modal to be visible
    await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 5000 });

    // Wait for comments panel to be visible
    await page.locator('[data-testid="comments-panel"]').waitFor({ state: 'visible', timeout: 5000 });

    // Wait for comments to finish loading (no "読み込み中..." text)
    await expect(page.getByText('読み込み中...')).not.toBeVisible({ timeout: 10000 });

    const endTime = Date.now();
    const loadTime = endTime - startTime;

    console.log(`[Perf] Comments modal load time: ${loadTime}ms`);

    // Performance budget: allow more time due to query navigation + modal rendering
    expect(loadTime).toBeLessThan(5000);
  });

  test('should not redundantly fetch members on modal reopen @perf', async ({ page }) => {
    const currentBoard = assertContext(board, 'Board context not initialized');
    const currentCard = assertContext(card, 'Card context not initialized');

    await page.goto(currentBoard.canonicalPath);
    await page.waitForLoadState('domcontentloaded');

    // Setup network monitoring
    const memberRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/boards/') && url.includes('/members')) {
        memberRequests.push(url);
        console.log(`[Network] Member fetch: ${url}`);
      }
    });

    // First modal open
    await openCardModalViaQuery(page, currentCard);
    await page.locator('[data-testid="comments-panel"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1000); // Allow time for any network requests

    const firstOpenRequests = memberRequests.length;
    console.log(`[Perf] First modal open: ${firstOpenRequests} member requests`);

    // Close modal
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });

    // Clear requests array
    memberRequests.length = 0;

    // Second modal open - should use cache
    await openCardModalViaQuery(page, currentCard);
    await page.locator('[data-testid="comments-panel"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1000);

    const secondOpenRequests = memberRequests.length;
    console.log(`[Perf] Second modal open: ${secondOpenRequests} member requests`);

    // Should not fetch members again (cache hit)
    expect(secondOpenRequests).toBe(0);
  });
});
