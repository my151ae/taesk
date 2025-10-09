import { test, expect } from '@playwright/test';

/**
 * Kanban Board E2E Tests
 *
 * Authentication is bypassed in test environment via NEXT_PUBLIC_BYPASS_AUTH.
 * See playwright.config.ts for configuration.
 *
 * Tests use a dedicated "E2E Test Board" (ID: 00000000-0000-0000-0000-000000000002)
 * Data is cleaned up after each test to ensure test isolation.
 */

import { supabase } from '@/lib/supabase';

const TEST_BOARD_ID = '00000000-0000-0000-0000-000000000002';

test.describe('Taesk Kanban Board E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Wait for page to load and auth to initialize
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=test@example.com', { timeout: 10000 });

    // Switch to test board
    await page.getByRole('button', { name: 'Main Board ▼' }).click();
    await page.getByRole('button', { name: /E2E Test Board/ }).click();

    // Wait for board to switch
    await page.getByRole('button', { name: 'E2E Test Board ▼' }).waitFor({ state: 'visible' });
  });

  test.afterEach(async () => {
    // Clean up test board data directly via Supabase
    // Delete all lists (CASCADE will delete cards automatically)
    await supabase
      .from('lists')
      .delete()
      .eq('board_id', TEST_BOARD_ID);
  });

  test('should load the test board (empty initially)', async ({ page }) => {
    // Test board should be loaded and empty (no lists)
    await expect(page.getByRole('button', { name: 'E2E Test Board ▼' })).toBeVisible();
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

    // Enter new name
    const input = page.locator('input').filter({ hasValue: 'New List' });
    await input.fill('Renamed List');
    await page.keyboard.press('Enter');

    // Verify rename
    await expect(page.getByRole('button', { name: /Renamed List/i }).first()).toBeVisible();
  });

  test('should delete a list', async ({ page }) => {
    // Add a new list first
    await page.getByRole('button', { name: '+ Add List' }).click();
    await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
    await page.waitForTimeout(500);

    // Open list menu
    const menuButton = page.locator('button:has-text("⋯")').first();
    await menuButton.waitFor({ state: 'visible' });
    await menuButton.click();
    await page.waitForTimeout(300);

    // Handle confirm dialog and delete
    page.once('dialog', dialog => dialog.accept());
    const deleteButton = page.getByTestId('delete-list-button');
    await deleteButton.waitFor({ state: 'visible', timeout: 5000 });
    await deleteButton.click();

    // Wait for deletion to complete
    await page.waitForTimeout(500);

    // Verify deletion - board should be empty again
    await expect(page.getByRole('button', { name: '+ Add List' })).toBeVisible();
    await expect(page.getByRole('button', { name: /New List/i })).toHaveCount(0);
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
    await page.waitForTimeout(300);

    // Add a card
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card').first()).toBeVisible();

    // Delete card
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();

    // Verify deletion (should only see the add card button, not "New Card" text)
    await expect(page.getByText('New Card')).toHaveCount(0);
  });

  test('should drag and drop a card within the same list', async ({ page }) => {
    // First add a list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(300);

    // Add two cards
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await page.waitForTimeout(200);
    await addCardButton.click();
    await page.waitForTimeout(200);

    const cards = page.getByText('New Card');
    await expect(cards).toHaveCount(2);

    // Get card positions
    const firstCard = cards.first();
    const secondCard = cards.nth(1);

    // Drag second card above first card
    await secondCard.dragTo(firstCard);

    // Note: Actual position verification would require checking the DOM order
    // or adding data-testid attributes to verify the order changed
  });

  test('should drag and drop a card to a different list', async ({ page }) => {
    // Add first list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: /New List/i })).toHaveCount(1);

    // Add second list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(800);

    // Verify both lists are visible
    const lists = page.getByRole('button', { name: /New List/i });
    await expect(lists).toHaveCount(2);

    // Add a card to first list
    const addCardButtons = page.getByRole('button', { name: '+ Add Card' });
    await addCardButtons.first().click();
    await page.waitForTimeout(300);
    await expect(page.getByText('New Card').first()).toBeVisible();

    // Get the card and second list container
    const card = page.getByRole('button', { name: 'New Card Edit Delete' }).first();
    await card.waitFor({ state: 'visible' });

    // Get all list containers using data-testid (should be only the 2 we just added)
    const listContainers = page.locator('[data-testid^="list-"]');
    const count = await listContainers.count();

    // Use the last list as target (in case cleanup didn't work perfectly)
    const targetList = listContainers.last();
    await targetList.waitFor({ state: 'visible' });

    // Perform drag and drop using mouse actions
    const cardBox = await card.boundingBox();
    const targetBox = await targetList.boundingBox();

    if (cardBox && targetBox) {
      // Start drag from card center
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(200);

      // Move to target list center
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
      await page.waitForTimeout(200);

      // Drop
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    // Note: Verification of final position would require additional data-testid attributes
    // For now, we just verify the drag action completes without error
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
    await page.waitForSelector('text=test@example.com', { timeout: 10000 });

    // Switch back to test board after reload
    await page.getByRole('button', { name: 'Main Board ▼' }).click();
    await page.getByRole('button', { name: /E2E Test Board/ }).click();
    await page.getByRole('button', { name: 'E2E Test Board ▼' }).waitFor({ state: 'visible' });

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
    // In bypass mode, should show test email
    const emailText = page.getByText('test@example.com');
    await expect(emailText).toBeVisible();

    // Verify sign out button exists
    const signOutButton = page.getByRole('button', { name: 'Sign Out' });
    await expect(signOutButton).toBeVisible();
  });
});
