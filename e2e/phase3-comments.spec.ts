import { test, expect, type Page } from '@playwright/test';

const TEST_BOARD_NAME = 'E2E Comments Test Board';

// Helper to create a test board
async function createTestBoard(page: Page, boardName: string): Promise<string> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Find board selector
  const boardSelector = page.locator('[data-testid="board-selector"]');
  if (await boardSelector.isVisible()) {
    await boardSelector.click();
  }

  // Create new board
  const newBoardButton = page.locator('text=New Board').or(page.locator('button:has-text("新規ボード")'));
  if (await newBoardButton.isVisible()) {
    await newBoardButton.click();
    await page.fill('input[placeholder*="ボード名"]', boardName);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }

  // Get board ID from URL
  const url = page.url();
  const match = url.match(/\/b\/([^\/\?]+)/);
  return match ? match[1] : '';
}

// Helper to create a test card
async function createTestCard(page: Page, listIndex: number, cardTitle: string): Promise<string> {
  // Click "Add card" button in the list
  const addCardButtons = page.locator('button:has-text("+ Add")');
  await addCardButtons.nth(listIndex).click();

  // Fill card title
  await page.fill('input[placeholder="Card title"]', cardTitle);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Find the created card
  const cardElement = page.locator(`text="${cardTitle}"`).first();
  await expect(cardElement).toBeVisible();

  return cardTitle;
}

// Helper to open card modal via ?card= query
async function openCardModalViaQuery(page: Page, cardTitle: string): Promise<void> {
  // Click on card to open modal
  const card = page.locator(`text="${cardTitle}"`).first();
  await card.click();

  // Wait for modal to appear
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
}

test.describe('Comments Feature', () => {
  let boardId: string;
  let cardTitle: string;

  test.beforeEach(async ({ page }) => {
    // Create test board
    boardId = await createTestBoard(page, TEST_BOARD_NAME);
    expect(boardId).toBeTruthy();

    // Create test card
    cardTitle = `Test Card ${Date.now()}`;
    await createTestCard(page, 0, cardTitle);
  });

  test.afterEach(async ({ page }) => {
    // Clean up: delete test board
    if (boardId) {
      // Board cleanup logic would go here
      // For now, we'll leave test boards for manual inspection
    }
  });

  test('should show Comments tab in card modal via ?card= route', async ({ page }) => {
    await openCardModalViaQuery(page, cardTitle);

    // Check for Comments tab
    const commentsTab = page.locator('button:has-text("Comments")');
    await expect(commentsTab).toBeVisible();

    // Click Comments tab
    await commentsTab.click();
    await page.waitForTimeout(300);

    // Check for comment form
    const commentTextarea = page.locator('textarea[placeholder*="コメントを書く"]');
    await expect(commentTextarea).toBeVisible();
  });

  test('should preserve card modal state on reload with ?card= query', async ({ page }) => {
    await openCardModalViaQuery(page, cardTitle);

    // Get current URL with ?card= query
    const urlBeforeReload = page.url();
    expect(urlBeforeReload).toContain('?card=');

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Modal should still be visible
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

    // URL should still have ?card= query
    expect(page.url()).toContain('?card=');
  });

  test('should create a comment successfully', async ({ page }) => {
    await openCardModalViaQuery(page, cardTitle);

    // Switch to Comments tab
    await page.click('button:has-text("Comments")');
    await page.waitForTimeout(300);

    // Type comment
    const commentText = `Test comment ${Date.now()}`;
    await page.fill('textarea[placeholder*="コメントを書く"]', commentText);

    // Submit comment
    await page.click('button:has-text("コメントを投稿")');
    await page.waitForTimeout(1000);

    // Verify comment appears
    await expect(page.locator(`text="${commentText}"`)).toBeVisible({ timeout: 5000 });
  });

  test('should edit and delete own comment', async ({ page }) => {
    await openCardModalViaQuery(page, cardTitle);

    // Switch to Comments tab
    await page.click('button:has-text("Comments")');
    await page.waitForTimeout(300);

    // Create comment
    const commentText = `Comment to edit ${Date.now()}`;
    await page.fill('textarea[placeholder*="コメントを書く"]', commentText);
    await page.click('button:has-text("コメントを投稿")');
    await page.waitForTimeout(1000);

    // Edit comment
    await page.click('button:has-text("編集")');
    const editedText = `${commentText} (edited)`;
    await page.fill('textarea', editedText);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Verify edited text
    await expect(page.locator(`text="${editedText}"`)).toBeVisible();

    // Delete comment
    page.on('dialog', dialog => dialog.accept());
    await page.click('button:has-text("削除")');
    await page.waitForTimeout(1000);

    // Verify comment is gone
    await expect(page.locator(`text="${editedText}"`)).not.toBeVisible();
  });

  test('should allow replying to comments', async ({ page }) => {
    await openCardModalViaQuery(page, cardTitle);

    // Switch to Comments tab
    await page.click('button:has-text("Comments")');
    await page.waitForTimeout(300);

    // Create parent comment
    const parentText = `Parent comment ${Date.now()}`;
    await page.fill('textarea[placeholder*="コメントを書く"]', parentText);
    await page.click('button:has-text("コメントを投稿")');
    await page.waitForTimeout(1000);

    // Click reply button
    await page.click('button:has-text("返信")');
    await page.waitForTimeout(300);

    // Type reply
    const replyText = `Reply ${Date.now()}`;
    const replyTextarea = page.locator('textarea[placeholder*="返信を書く"]');
    await replyTextarea.fill(replyText);
    await page.click('button:has-text("返信")');
    await page.waitForTimeout(1000);

    // Verify reply appears
    await expect(page.locator(`text="${replyText}"`)).toBeVisible();
  });
});

test.describe('Comments Realtime', () => {
  let boardId: string;
  let cardTitle: string;

  test('should sync comments across multiple browser contexts', async ({ browser }) => {
    // Create two contexts (simulating two users/tabs)
    const context1 = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const context2 = await browser.newContext({ storageState: 'playwright/.auth/user.json' });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Page 1: Create board and card
      boardId = await createTestBoard(page1, `RT Test ${Date.now()}`);
      cardTitle = `RT Card ${Date.now()}`;
      await createTestCard(page1, 0, cardTitle);

      // Page 2: Navigate to same board
      await page2.goto(`/b/${boardId}`);
      await page2.waitForLoadState('networkidle');

      // Both pages: Open card modal
      await openCardModalViaQuery(page1, cardTitle);
      await openCardModalViaQuery(page2, cardTitle);

      // Both: Switch to Comments tab
      await page1.click('button:has-text("Comments")');
      await page2.click('button:has-text("Comments")');
      await page1.waitForTimeout(300);
      await page2.waitForTimeout(300);

      // Page 1: Create comment
      const commentText = `Realtime test ${Date.now()}`;
      await page1.fill('textarea[placeholder*="コメントを書く"]', commentText);
      await page1.click('button:has-text("コメントを投稿")');
      await page1.waitForTimeout(1000);

      // Page 2: Verify comment appears via Realtime
      await expect(page2.locator(`text="${commentText}"`)).toBeVisible({ timeout: 10000 });

    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
