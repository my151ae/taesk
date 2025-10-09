import { test, expect } from '@playwright/test';

/**
 * Kanban Board E2E Tests
 *
 * Authentication is bypassed in test environment via NEXT_PUBLIC_BYPASS_AUTH.
 * See playwright.config.ts for configuration.
 */

test.describe('Taesk Kanban Board E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Taesk Board")');
  });

  test('should load the board with default lists', async ({ page }) => {
    // Check if default lists are loaded
    await expect(page.getByRole('button', { name: /To Do/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /In Progress/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Done/i })).toBeVisible();
  });

  test('should add a new list', async ({ page }) => {
    // Click Add List button
    await page.getByRole('button', { name: '+ Add List' }).click();

    // Verify new list appears
    await expect(page.getByRole('button', { name: /New List/i })).toBeVisible();
  });

  test('should rename a list', async ({ page }) => {
    // Open list menu
    const firstList = page.getByRole('button', { name: /To Do/i }).first();
    await firstList.locator('button:has-text("⋯")').click();

    // Click rename
    await page.getByRole('button', { name: 'Rename' }).click();

    // Enter new name
    const input = page.locator('input[value="To Do"]');
    await input.fill('Renamed List');
    await input.blur();

    // Verify rename
    await expect(page.getByRole('button', { name: /Renamed List/i })).toBeVisible();
  });

  test('should delete a list', async ({ page }) => {
    // Add a new list first
    await page.getByRole('button', { name: '+ Add List' }).click();
    await expect(page.getByRole('button', { name: /New List/i })).toBeVisible();

    // Open list menu and delete
    const newList = page.getByRole('button', { name: /New List/i }).first();
    await newList.locator('button:has-text("⋯")').click();

    // Handle confirm dialog
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).click();

    // Verify deletion
    await expect(page.getByRole('button', { name: /New List/i })).not.toBeVisible();
  });

  test('should add a card to a list', async ({ page }) => {
    // Click Add Card in first list
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();

    // Verify card appears
    await expect(page.getByText('New Card')).toBeVisible();
  });

  test('should edit a card', async ({ page }) => {
    // Add a card first
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();

    // Click Edit
    await page.getByRole('button', { name: 'Edit' }).first().click();

    // Edit title and description
    const titleInput = page.locator('input[placeholder="Card title"]');
    await titleInput.fill('Updated Card Title');

    const descInput = page.locator('textarea[placeholder="Description"]');
    await descInput.fill('Updated description');

    // Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Verify changes
    await expect(page.getByText('Updated Card Title')).toBeVisible();
    await expect(page.getByText('Updated description')).toBeVisible();
  });

  test('should delete a card', async ({ page }) => {
    // Add a card first
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card')).toBeVisible();

    // Delete card
    await page.getByRole('button', { name: 'Delete' }).first().click();

    // Verify deletion (should only see the add card button, not "New Card" text)
    await expect(page.getByText('New Card').first()).not.toBeVisible();
  });

  test('should drag and drop a card within the same list', async ({ page }) => {
    // Add two cards
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await addCardButton.click();

    const cards = page.locator('div:has-text("New Card")');
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
    // Add a card to first list
    const firstListAddCard = page.getByRole('button', { name: '+ Add Card' }).first();
    await firstListAddCard.click();
    await expect(page.getByText('New Card')).toBeVisible();

    // Get the card and target list
    const card = page.locator('div:has-text("New Card")').first();
    const targetList = page.getByRole('button', { name: /In Progress/i }).first();

    // Drag card to different list
    await card.dragTo(targetList);

    // Note: Verification would require checking which list contains the card
    // Could add data-list-id attributes for better testing
  });

  test('should persist data after page reload', async ({ page }) => {
    // Add a list and card
    await page.getByRole('button', { name: '+ Add List' }).click();
    await expect(page.getByRole('button', { name: /New List/i })).toBeVisible();

    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();

    // Wait for sync (give it a moment)
    await page.waitForTimeout(1000);

    // Reload page
    await page.reload();
    await page.waitForSelector('h1:has-text("Taesk Board")');

    // Verify data persists
    await expect(page.getByRole('button', { name: /New List/i })).toBeVisible();
    await expect(page.getByText('New Card')).toBeVisible();
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
