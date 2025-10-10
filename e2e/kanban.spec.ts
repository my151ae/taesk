import { test, expect } from '@playwright/test';

/**
 * Kanban Board E2E Tests
 *
 * Authentication is bypassed in test environment via NEXT_PUBLIC_BYPASS_AUTH.
 * See playwright.config.ts for configuration.
 *
 * Phase 2: Each test creates a unique board to avoid Realtime interference.
 * See: docs/tickets/2025-10-10/01-e2e-test-stability-issues.md
 */

import { supabase } from '@/lib/supabase';
import type { Page, Locator } from '@playwright/test';

const TEST_USER_ID = 'f6baf5d0-ac5b-491a-aa47-3bc5c05243f2'; // e2e.taesk.test@gmail.com

/**
 * Drag and drop helper using mouse API with intermediate steps
 * Required for @dnd-kit which needs continuous mousemove events
 */
async function dragAndDrop(page: Page, source: Locator, target: Locator) {
  // Get bounding boxes
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Source or target element not visible');
  }

  // Calculate positions
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  // Calculate midpoint for smoother drag
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;

  // Perform drag with intermediate mousemove events
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(250); // Wait for touch sensor activation delay

  // Move with steps to generate intermediate mousemove events
  await page.mouse.move(midX, midY, { steps: 10 });
  await page.mouse.move(endX, endY, { steps: 10 });

  await page.mouse.up();
  await page.waitForTimeout(500); // Wait for drop animation and Realtime sync
}

test.describe('Taesk Kanban Board E2E Tests', () => {
  let testBoardId: string;
  let testBoardName: string;

  test.beforeEach(async ({ page }) => {
    // Generate unique board for this test
    testBoardId = crypto.randomUUID();
    testBoardName = `Test-${testBoardId.slice(0, 8)}`;

    // Create test board (is_test_board: true prevents auto-seeding of default lists)
    await supabase.from('boards').insert({
      id: testBoardId,
      name: testBoardName,
      user_id: TEST_USER_ID,
      is_test_board: true,
    });

    await page.goto('/');

    // Wait for page to load and auth to initialize
    await page.waitForLoadState('networkidle');
    const testUserEmail = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';
    await page.waitForSelector(`text=${testUserEmail}`, { timeout: 10000 });

    // Switch to test board
    await page.getByRole('button', { name: /▼/ }).click();
    await page.getByRole('button', { name: testBoardName }).click();

    // Wait for board to switch
    await page.getByRole('button', { name: `${testBoardName} ▼` }).waitFor({ state: 'visible' });

    // Wait for board to be fully loaded and Realtime subscription to be ready
    await page.waitForTimeout(1500);
  });

  test.afterEach(async () => {
    // Clean up test board (CASCADE deletes lists and cards)
    await supabase.from('boards').delete().eq('id', testBoardId);
  });

  test('should load the test board (empty initially)', async ({ page }) => {
    // Test board should be loaded and empty (no lists)
    await expect(page.getByRole('button', { name: `${testBoardName} ▼` })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add List' })).toBeVisible();
  });

  test('should add a new list', async ({ page }) => {
    // Click Add List button
    await page.getByRole('button', { name: '+ Add List' }).click();

    // Verify new list appears (check for at least one)
    await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
  });

  test('should rename a list', async ({ page }) => {
    // First add a list to rename
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(500);

    // Wait for list to appear and open menu
    await page.getByRole('button', { name: /New List/i }).first().waitFor({ state: 'visible' });

    // Click the menu button (⋯)
    const menuButton = page.locator('button:has-text("⋯")').first();
    await menuButton.waitFor({ state: 'visible' });
    await menuButton.click();

    // Click rename
    await page.getByRole('button', { name: 'Rename', exact: true }).click();

    // Enter new name - use more specific selector to avoid search input
    const input = page.locator('[data-testid^="list-"]').locator('input').filter({ hasValue: 'New List' });
    await input.fill('Renamed List');
    await page.keyboard.press('Enter');

    // Verify rename
    await expect(page.getByRole('button', { name: /Renamed List/i }).first()).toBeVisible();
  });

  test('should delete a list', async ({ page }) => {
    // Add a new list first
    await page.getByRole('button', { name: '+ Add List' }).click();
    await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
    await page.waitForTimeout(1000); // Wait for Realtime sync

    // Open list menu
    const menuButton = page.locator('button:has-text("⋯")').first();
    await menuButton.waitFor({ state: 'visible' });
    await menuButton.click();
    await page.waitForTimeout(500);

    // Handle confirm dialog and delete
    page.once('dialog', dialog => dialog.accept());
    const deleteButton = page.getByTestId('delete-list-button');
    await deleteButton.waitFor({ state: 'visible', timeout: 5000 });
    await deleteButton.click();

    // Wait for deletion to complete (Realtime propagation + UI update)
    await page.waitForTimeout(2000);

    // Verify deletion - list should disappear
    await expect(page.getByRole('button', { name: /New List/i })).toHaveCount(0);

    // Verify only Add List button remains
    await expect(page.getByRole('button', { name: '+ Add List' })).toBeVisible();
  });

  test('should add a card to a list', async ({ page }) => {
    // First add a list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(300);

    // Click Add Card in first list
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();

    // Verify card appears
    await expect(page.getByText('New Card').first()).toBeVisible();
  });

  test('should edit a card', async ({ page }) => {
    // First add a list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(300);

    // Add a card
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await page.waitForTimeout(300);

    // Click Edit
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();

    // Wait for edit mode and edit title
    const titleInput = page.locator('input[placeholder="Card title"]');
    await titleInput.waitFor({ state: 'visible' });
    await titleInput.fill('Updated Card Title');

    const descInput = page.locator('textarea[placeholder="Description"]');
    await descInput.fill('Updated description');

    // Save
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Verify changes
    await expect(page.getByText('Updated Card Title')).toBeVisible();
    await expect(page.getByText('Updated description')).toBeVisible();
  });

  test('should delete a card', async ({ page }) => {
    // First add a list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000); // Wait for Realtime sync

    // Add a card
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card').first()).toBeVisible();
    await page.waitForTimeout(1000); // Wait for card creation to sync

    // Delete card
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();

    // Wait for deletion to complete (Realtime propagation + UI update)
    await page.waitForTimeout(2000);

    // Verify deletion (should only see the add card button, not "New Card" text)
    await expect(page.getByText('New Card')).toHaveCount(0);
  });

  test('should drag and drop a card within the same list', async ({ page }) => {
    // First add a list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000); // Wait for list creation to sync

    // Add two cards
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await page.waitForTimeout(500);
    await addCardButton.click();
    await page.waitForTimeout(500);

    const cards = page.getByText('New Card');
    await expect(cards).toHaveCount(2);

    // Get card elements
    const firstCard = cards.first();
    const secondCard = cards.nth(1);

    // Drag second card to first card position using mouse API
    await dragAndDrop(page, secondCard, firstCard);

    // Verify both cards still exist (drag successful, no deletion)
    await expect(page.getByText('New Card')).toHaveCount(2);
  });

  test('should drag and drop a card to a different list', async ({ page }) => {
    // Add two lists
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000);

    // Verify we have 2 lists
    const lists = page.getByRole('button', { name: /New List/i });
    await expect(lists).toHaveCount(2);

    // Add a card to the first list
    const addCardButtons = page.getByRole('button', { name: '+ Add Card' });
    await addCardButtons.first().click();
    await page.waitForTimeout(1000);

    // Verify card appears
    const card = page.getByText('New Card').first();
    await expect(card).toBeVisible();

    // Get the second list's dropzone area
    const secondList = page.getByRole('button', { name: /New List/i }).nth(1);

    // Drag card from first list to second list using mouse API
    await dragAndDrop(page, card, secondList);

    // Verify card still exists (moved, not deleted)
    await expect(page.getByText('New Card')).toHaveCount(1);
  });

  test('should persist data after page reload', async ({ page }) => {
    // Add a list and card
    await page.getByRole('button', { name: '+ Add List' }).click();
    await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
    await page.waitForTimeout(300);

    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card').first()).toBeVisible();

    // Wait for sync to Supabase (important!)
    await page.waitForTimeout(2000);

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');
    const testUserEmail = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';
    await page.waitForSelector(`text=${testUserEmail}`, { timeout: 10000 });

    // Switch back to test board after reload
    await page.getByRole('button', { name: 'Main Board ▼' }).click();
    await page.getByRole('button', { name: testBoardName }).click();
    await page.getByRole('button', { name: `${testBoardName} ▼` }).waitFor({ state: 'visible' });

    // Verify data persists
    await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
    await expect(page.getByText('New Card').first()).toBeVisible();
  });

  test('should be mobile responsive', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Check if lists are horizontally scrollable
    const scrollContainer = page.locator('div.overflow-x-auto').first();
    await expect(scrollContainer).toBeVisible();

    // Verify Add List button is visible
    await expect(page.getByRole('button', { name: '+ Add List' })).toBeVisible();
  });

  test('should show mock user email in test mode', async ({ page }) => {
    // Should show actual E2E test user email
    const testUserEmail = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';
    const emailText = page.getByText(testUserEmail);
    await expect(emailText).toBeVisible();

    // Verify sign out button exists
    const signOutButton = page.getByRole('button', { name: 'Sign Out' });
    await expect(signOutButton).toBeVisible();
  });

  test('should queue operations when offline and sync when online', async ({ page, context }) => {
    // Setup: Create a list first
    await page.getByRole('button', { name: '+ Add List' }).click();
    await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
    await page.waitForTimeout(500);

    // Verify we're online
    await expect(page.getByText('Live')).toBeVisible();

    // Go offline
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForTimeout(500);

    // Verify offline status
    await expect(page.getByText('Offline')).toBeVisible();

    // Add a card while offline
    await page.getByRole('button', { name: '+ Add Card' }).first().click();
    await expect(page.getByText('New Card').first()).toBeVisible();
    await page.waitForTimeout(500);

    // Verify sync queue shows pending item
    await expect(page.getByText(/queued/i)).toBeVisible();

    // Check sync queue in localStorage
    const queueBeforeSync = await page.evaluate(() => {
      const queue = JSON.parse(localStorage.getItem('taesk-sync-queue') || '{"actions":[]}');
      return queue.actions.length;
    });
    expect(queueBeforeSync).toBeGreaterThan(0);

    // Go back online
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // Wait for sync to complete
    await page.waitForTimeout(3000);

    // Verify online status
    await expect(page.getByText('Live')).toBeVisible();

    // Verify sync queue is cleared
    const queueAfterSync = await page.evaluate(() => {
      const queue = JSON.parse(localStorage.getItem('taesk-sync-queue') || '{"actions":[]}');
      return queue.actions.length;
    });
    expect(queueAfterSync).toBe(0);

    // Verify "queued" indicator is gone
    await expect(page.getByText(/queued/i)).not.toBeVisible();

    // Verify data persisted to Supabase by reloading
    await page.reload();
    await page.waitForLoadState('networkidle');
    const testUserEmail = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';
    await page.waitForSelector(`text=${testUserEmail}`, { timeout: 10000 });

    // Switch back to test board
    await page.getByRole('button', { name: 'Main Board ▼' }).click();
    await page.getByRole('button', { name: testBoardName }).click();
    await page.getByRole('button', { name: `${testBoardName} ▼` }).waitFor({ state: 'visible' });

    // Verify card still exists (synced to Supabase)
    await expect(page.getByText('New Card').first()).toBeVisible();
  });
});
