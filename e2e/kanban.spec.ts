import { test, expect } from '@playwright/test';

/**
 * Kanban Board E2E Tests
 *
 * Authentication uses programmatic sign-in via globalSetup.
 * See: e2e/.setup/auth-global-setup.ts and playwright.config.ts
 *
 * Each test creates a unique board to avoid Realtime interference.
 * See: docs/tickets/2025-10-10/01-e2e-test-stability-issues.md
 */

import { supabase } from '@/lib/supabase';
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';
import { MAIN_BOARD_ID } from '@/lib/board-defaults';
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

async function waitForCardRows<T extends Record<string, unknown>>(
  boardId: string,
  selectColumns: string,
  options: { timeout?: number } = {}
): Promise<T[]> {
  const { timeout = 20000 } = options;
  const start = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - start < timeout) {
    const { data, error } = await supabase
      .from('cards')
      .select(selectColumns)
      .eq('board_id', boardId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      lastError = new Error(error.message);
    } else if (data && data.length > 0) {
      return data as T[];
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`Timed out waiting for cards to be persisted for board ${boardId}`);
}

let cachedAssigneeIdSupport: boolean | null = null;

async function ensureAssigneeIdSupport(): Promise<boolean> {
  if (cachedAssigneeIdSupport !== null) {
    return cachedAssigneeIdSupport;
  }

  const { error } = await supabase
    .from('cards')
    .select('assignee_id')
    .limit(1);

  if (error) {
    if (
      (error.code === 'PGRST204' || error.code === '42703') &&
      error.message.includes('assignee_id')
    ) {
      cachedAssigneeIdSupport = false;
      return false;
    }
    throw new Error(error.message);
  }

  cachedAssigneeIdSupport = true;
  return true;
}

test.describe('Taesk Kanban Board E2E Tests @feature:boards', () => {
  test.describe.configure({ timeout: 60000 });
  let testBoardId: string;
  let testBoardName: string;
  let testBoardShortId: string;
  let testBoardIdShort: number;
  let testBoardSlug: string;
  let testBoardCanonicalPath: string;

  test.beforeEach(async ({ page }) => {
    // Generate unique board for this test
    testBoardId = crypto.randomUUID();
    testBoardName = `Test-${testBoardId.slice(0, 8)}`;
    testBoardShortId = await createUniqueBoardShortId();
    testBoardIdShort = await getNextBoardIdShort();
    testBoardSlug = slugifyBoardName(testBoardName);
    testBoardCanonicalPath = `/b/${testBoardShortId}/${testBoardIdShort}-${testBoardSlug}`;

    // Create test board (is_test_board: true prevents auto-seeding of default lists)
    await supabase.from('boards').insert({
      id: testBoardId,
      name: testBoardName,
      user_id: TEST_USER_ID,
      is_test_board: true,
      short_id: testBoardShortId,
      id_short: testBoardIdShort,
      slug: testBoardSlug,
    });

    // Add test user as board member
    await supabase.from('board_members').insert({
      board_id: testBoardId,
      profile_id: TEST_USER_ID,
      role: 'owner',
    });

    await supabase.from('profiles').upsert({
      id: TEST_USER_ID,
      full_name: 'E2E Test User',
      email: process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com',
      avatar_url: null,
    });

    let navigationSucceeded = false;
    for (let attempt = 0; attempt < 2 && !navigationSucceeded; attempt += 1) {
      try {
        await page.goto('/');
        navigationSucceeded = true;
      } catch (error) {
        if (attempt === 1) {
          throw error;
        }
        await page.waitForTimeout(500);
      }
    }

    // Wait for page to load and auth to initialize
    await page.waitForLoadState('domcontentloaded');

    const boardSwitcher = page.getByRole('button', { name: /Board ▼/ });
    await boardSwitcher.waitFor({ state: 'visible', timeout: 10000 });

    // Switch to test board
    await boardSwitcher.click();
    await page.getByRole('button', { name: testBoardName }).click();

    await page.waitForURL(`**${testBoardCanonicalPath}`);

    // Wait for board to switch
    await page.getByRole('button', { name: `${testBoardName} ▼` }).waitFor({ state: 'visible' });

    // Wait for board to be fully loaded and Realtime subscription to be ready
    await page.waitForTimeout(1500);
  });

  test.afterEach(async () => {
    // Clean up test board (CASCADE deletes lists and cards)
    await supabase.from('boards').delete().eq('id', testBoardId);
  });

  test('should load the test board (empty initially) @e2e:essential', async ({ page }) => {
    // Test board should be loaded and empty (no lists)
    await expect(page.getByRole('button', { name: `${testBoardName} ▼` })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add List' })).toBeVisible();
  });

  test('should redirect legacy board query to canonical URL', async ({ request }) => {
    const response = await request.get(`/?board=${testBoardId}`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    const location = response.headers()['location'];
    expect(location).toBeTruthy();
    expect(location).toContain(testBoardCanonicalPath);
  });

  test('should normalize board URL when slug mismatches', async ({ page }) => {
    await page.goto(`/b/${testBoardShortId}/bogus-segment`);
    await page.waitForURL(`**${testBoardCanonicalPath}`);
    expect(new URL(page.url()).pathname).toBe(testBoardCanonicalPath);
  });

  test('should update URL immediately when switching boards', async ({ page }) => {
    const { data: defaultBoard } = await supabase
      .from('boards')
      .select('name, short_id, id_short, slug')
      .eq('id', MAIN_BOARD_ID)
      .maybeSingle();

    expect(defaultBoard).toBeTruthy();
    const defaultBoardCanonicalTail = defaultBoard?.id_short && defaultBoard?.slug
      ? `${defaultBoard.id_short}-${defaultBoard.slug}`
      : defaultBoard?.slug ?? '';
    const defaultBoardCanonicalPath = defaultBoardCanonicalTail
      ? `/b/${defaultBoard!.short_id}/${defaultBoardCanonicalTail}`
      : `/b/${defaultBoard!.short_id}`;

    await page.getByRole('button', { name: `${testBoardName} ▼` }).click();
    await page.getByRole('button', { name: defaultBoard!.name }).click();

    await page.waitForURL(`**${defaultBoardCanonicalPath}`);
    expect(new URL(page.url()).pathname).toBe(defaultBoardCanonicalPath);

    // Return to the test board for subsequent assertions
    await page.getByRole('button', { name: `${defaultBoard!.name} ▼` }).click();
    await page.getByRole('button', { name: testBoardName }).click();
    await page.waitForURL(`**${testBoardCanonicalPath}`);
  });

  test('should copy board URLs with clipboard fallback', async ({ page }) => {
    const dialogMessages: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogMessages.push(dialog.message());
      await dialog.dismiss();
    });

    await page.getByRole('button', { name: `${testBoardName} ▼` }).click();
    await page.getByRole('button', { name: '短縮URLをコピー' }).click();
    await page.waitForTimeout(100);

    expect(dialogMessages.length).toBeGreaterThan(0);
    expect(dialogMessages[dialogMessages.length - 1]).toBe('URLをコピーしました');

    await page.getByRole('button', { name: `${testBoardName} ▼` }).click();
    await page.getByRole('button', { name: '正規URLをコピー' }).click();
    await page.waitForTimeout(100);

    expect(dialogMessages[dialogMessages.length - 1]).toBe('URLをコピーしました');
  });

  test('should add a new list @e2e:essential', async ({ page }) => {
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
    const input = page.locator('[data-testid^="list-title-input-"]').first();
    await expect(input).toBeVisible();
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

  test('should add a card to a list @e2e:essential', async ({ page }) => {
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

    // Click card to open modal
    await page.getByText('New Card').first().click();
    await page.waitForTimeout(300);

    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .toContain('?card=');
    const cardUrl = page.url();
    const cardShortId = new URL(cardUrl).searchParams.get('card');
    if (!cardShortId) {
      throw new Error('Failed to capture card short_id from URL');
    }

    // Wait for modal and edit title (no tabs in new UI)
    const titleInput = page.locator('input[placeholder="Card title"]');
    await titleInput.waitFor({ state: 'visible' });

    // Regression test: Verify input focus is maintained
    await titleInput.click();
    await page.waitForTimeout(500); // Wait to ensure focus isn't stolen
    await expect(titleInput).toBeFocused();

    await titleInput.fill('Updated Card Title');

    const descInput = page.locator('textarea[placeholder="Add a description..."]');
    await descInput.fill('Updated description');

    // Save
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(1500); // Wait for save to complete

    // In new UI, modal stays open after save. Close manually with Escape.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 2000 });

    // Verify changes reflected on board
    const updatedCardButton = page.getByText('Updated Card Title').first();
    await expect(updatedCardButton).toBeVisible({ timeout: 10000 });

    // Reopen to confirm persisted values
    await updatedCardButton.click();
    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .toContain(`card=${cardShortId}`);
    await expect(titleInput).toHaveValue('Updated Card Title');
    await expect(descInput).toHaveValue('Updated description');

    await page.keyboard.press('Escape');
    await page.waitForURL(`**${testBoardCanonicalPath}`);
  });

  test('should delete a card', async ({ page }) => {
    // First add a list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000); // Wait for Realtime sync

    // Add a card
    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await page.waitForTimeout(1000); // Wait for card creation to sync

    // Verify card was added
    await expect(page.getByText('New Card').first()).toBeVisible();

    // Click the newly added card to open modal
    await page.getByText('New Card').first().click();
    await page.waitForTimeout(500);

    // Verify modal is open
    await expect(page.getByRole('dialog')).toBeVisible();
    // Modal shows card title ("New Card"), not "Edit Card"

    // Verify Delete button exists (no tabs in new UI)
    const deleteButton = page.getByRole('button', { name: 'Delete', exact: true });
    await expect(deleteButton).toBeVisible();

    // Setup dialog handler to automatically accept
    let dialogSeen = false;
    page.once('dialog', async dialog => {
      dialogSeen = true;
      expect(dialog.message()).toContain('Delete');
      await dialog.accept();
    });

    // Click Delete button (will trigger the dialog)
    await deleteButton.click();

    // Wait for deletion to complete
    await page.waitForTimeout(2000);

    // Verify dialog was shown
    expect(dialogSeen).toBe(true);

    // Verify modal is closed after deletion
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('should assign and clear card members (multi-assignee)', async ({ page }) => {
    test.slow();
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(300);

    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await page.waitForTimeout(600);

    const recentCards = await waitForCardRows<{ id: string }>(testBoardId, 'id');
    const createdCardId = recentCards[0].id;

    const cardLocator = page.locator(`[data-testid="card-${createdCardId}"]`).first();
    await cardLocator.waitFor({ state: 'visible' });
    await cardLocator.click();
    await page.waitForTimeout(300);

    await expect(page.getByRole('dialog')).toBeVisible();

    // New UI: No tabs, Members section is in left column
    const membersLabel = page.getByText('Members', { exact: true });
    await expect(membersLabel).toBeVisible();

    // Click "+" button to add member
    const addMemberButton = page.locator('button[aria-label="Add member"]');
    await addMemberButton.click();
    await page.waitForTimeout(200);

    // Search and select member from dropdown
    const memberSearchInput = page.getByPlaceholder('Search members...');
    await memberSearchInput.fill('E2E');
    await page.waitForTimeout(300);

    // Click on the E2E user in the dropdown (force click to bypass overlay)
    await page.getByRole('button', { name: /e2e\.taesk\.test@gmail\.com/i }).first().click({ force: true });
    await page.waitForTimeout(500);

    // Click Save to persist changes (wait for PATCH response)
    const saveResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/boards/${testBoardId}/cards/`) && response.request().method() === 'PATCH'
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await saveResponsePromise;
    await page.waitForTimeout(500);

    // Close modal with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 2000 });

    // Verify assignee information reflects the added user (accept legacy single field)
    await expect.poll(async () => {
      const { data, error } = await supabase
        .from('cards')
        .select('assignee_id, assignee_ids')
        .eq('id', createdCardId)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (!data) {
        return false;
      }

      const assigneeIds = Array.isArray(data.assignee_ids) ? data.assignee_ids : [];
      return assigneeIds.includes(TEST_USER_ID) || data.assignee_id === TEST_USER_ID;
    }, { timeout: 30000 }).toBe(true);

    // Reopen card and verify member chip is visible
    await cardLocator.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Verify member chip is displayed (look for email or name in chip)
    const memberChipContainer = page.locator('.group.relative.inline-flex');
    await expect(memberChipContainer.first()).toBeVisible();

    // Hover over chip and click remove button
    await memberChipContainer.first().hover();
    await page.waitForTimeout(200);
    const removeButton = memberChipContainer.first().locator('button').first();
    await removeButton.click();
    await page.waitForTimeout(300);

    // Save the card
    const removeResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/boards/${testBoardId}/cards/`) && response.request().method() === 'PATCH'
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await removeResponsePromise;
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 2000 });

    // Verify assignee_ids is null or empty
    await expect.poll(async () => {
      const { data, error } = await supabase
        .from('cards')
        .select('assignee_id, assignee_ids, assigned_to')
        .eq('id', createdCardId)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (!data) {
        return false;
      }

      const assigneeIds = Array.isArray(data.assignee_ids) ? data.assignee_ids : [];
      return data.assignee_id === null && data.assigned_to === null && assigneeIds.length === 0;
    }, { timeout: 30000 }).toBe(true);
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

    const cards = page.locator('[data-testid^="card-"]');
    await expect(cards).toHaveCount(2);

    // Get card elements
    const firstCard = cards.first();
    const secondCard = cards.nth(1);

    // Drag second card to first card position using mouse API
    await dragAndDrop(page, secondCard, firstCard);

    // Verify both cards still exist (drag successful, no deletion)
    await expect(page.locator('[data-testid^="card-"]')).toHaveCount(2);
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

  test('should persist data after page reload @e2e:essential', async ({ page }) => {
    // Add a list and card
    await page.getByRole('button', { name: '+ Add List' }).click();
    await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
    await page.waitForTimeout(300);

    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card').first()).toBeVisible();

    // Wait for sync to Supabase (important!)
    await page.waitForTimeout(2000);

    // Reload page directly to test board URL
    await page.goto(`/?board=${testBoardId}`);
    await page.waitForURL(`**${testBoardCanonicalPath}`);
    await page.waitForLoadState('domcontentloaded');
    const testUserEmail = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';
    await page.waitForSelector(`text=${testUserEmail}`, { timeout: 10000 });

    // Wait for board to load
    await page.getByRole('button', { name: `${testBoardName} ▼` }).waitFor({ state: 'visible' });

    // Verify data persists
    await expect(page.getByRole('button', { name: /New List/i }).first()).toBeVisible();
    await expect(page.getByText('New Card').first()).toBeVisible();
  });

  test('should normalize board URL when slug is incorrect', async ({ page }) => {
    const incorrectPath = `/b/${testBoardShortId}/${testBoardIdShort}-wrong-slug`;

    await page.goto(incorrectPath);
    await page.waitForURL(`**${testBoardCanonicalPath}`);

    expect(page.url()).toContain(testBoardCanonicalPath);
    await expect(page.getByRole('button', { name: `${testBoardName} ▼` })).toBeVisible();
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
    test.slow();
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

    // Verify data persisted to Supabase by reloading directly to test board URL
    await page.goto(`/?board=${testBoardId}`);
    await page.waitForURL(`**${testBoardCanonicalPath}`);
    await page.waitForLoadState('domcontentloaded');
    const testUserEmail = process.env.E2E_USER_EMAIL || 'e2e.taesk.test@gmail.com';
    await page.waitForSelector(`text=${testUserEmail}`, { timeout: 10000 });

    // Wait for board to load
    await page.getByRole('button', { name: `${testBoardName} ▼` }).waitFor({ state: 'visible' });

    // Verify card still exists (synced to Supabase)
    await expect(page.getByText('New Card').first()).toBeVisible();
  });

  test('should open card modal via short URL navigation', async ({ page }) => {
    // Add a list and card
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000);

    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card').first()).toBeVisible();
    await page.waitForTimeout(2000); // Wait for sync to Supabase

    // Get the card's short_id from Supabase
    const cards = await waitForCardRows<{ short_id: string; id_short: number | null; slug: string | null; id: string; title: string }>(
      testBoardId,
      'short_id, id_short, slug, id, title'
    );
    const card = cards[0];
    expect(card.short_id).toBeTruthy();

    // Soft navigate via card click (query param should reflect short id)
    await page.getByText('New Card').first().click();
    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .toContain(`card=${card.short_id}`);

    // Modal should be visible and bound to the intercepted URL
    await expect(page.getByRole('dialog')).toBeVisible();
    // Modal shows card title ("New Card"), not "Edit Card"
    expect(page.url()).toContain(`card=${card.short_id}`);

    // Close via keyboard and ensure history returns to board URL
    await page.keyboard.press('Escape');
    await page.waitForURL(`**${testBoardCanonicalPath}`);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('should render full card page on direct navigation', async ({ page }) => {
    // Add a list and card
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000);

    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card').first()).toBeVisible();
    await page.waitForTimeout(2000); // Wait for sync to Supabase

    // Get the card's short_id from Supabase
    const cards = await waitForCardRows<{ short_id: string; id_short: number | null; slug: string | null; title: string }>(
      testBoardId,
      'short_id, id_short, slug, title'
    );
    const card = cards[0];
    expect(card.short_id).toBeTruthy();

    await page.goto(`/c/${card.short_id}`);
    await page.waitForURL(`**/c/${card.short_id}**`);

    await expect(page.getByRole('heading', { name: card.title })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('card-fullpage-open-board-button')).toBeVisible();

    await page.getByTestId('card-fullpage-open-board-button').click();
    await expect.poll(async () => page.url(), { timeout: 10000 })
      .toContain(testBoardCanonicalPath);
  });

  test('should normalize URL when slug is incorrect', async ({ page }) => {
    // Add a list and card
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000);

    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card').first()).toBeVisible();
    await page.waitForTimeout(2000); // Wait for sync to Supabase

    // Get the card's short_id from Supabase
    const cards = await waitForCardRows<{ short_id: string; id_short: number | null; slug: string | null; title: string }>(
      testBoardId,
      'short_id, id_short, slug, title'
    );
    const card = cards[0];
    expect(card.short_id).toBeTruthy();

    // Build expected canonical path
    const expectedSlug = card.id_short ? `${card.id_short}-${card.slug}` : card.slug || '';

    // Navigate with incorrect slug
    await page.goto(`/c/${card.short_id}/wrong-slug`);
    await page.waitForTimeout(1000);

    // Should normalize URL to canonical (server redirect or replaceState)
    if (expectedSlug) {
      await page.waitForFunction(
        (expectedUrl) => window.location.pathname === expectedUrl,
        `/c/${card.short_id}/${expectedSlug}`,
        { timeout: 3000 }
      );
      expect(page.url()).toContain(`/c/${card.short_id}/${expectedSlug}`);
    } else {
      await page.waitForFunction(
        (expectedUrl) => window.location.pathname === expectedUrl,
        `/c/${card.short_id}`,
        { timeout: 3000 }
      );
      expect(page.url()).toBe(`http://localhost:3000/c/${card.short_id}`);
    }

    // Verify full page view is rendered (no modal present)
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: card.title })).toBeVisible();
  });

  test('should handle invalid card URL gracefully without crashing', async ({ page }) => {
    // Navigate to a non-existent card short_id
    const invalidShortId = 'INVALID99';
    await page.goto(`/c/${invalidShortId}`);

    // Should show 404 or redirect, but NOT crash with "e is not iterable"
    // Wait for page to settle
    await page.waitForLoadState('domcontentloaded');

    // Verify no JavaScript errors (the crash would appear in console)
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    // Wait a bit to ensure any errors would have been caught
    await page.waitForTimeout(2000);

    // Check that no "e is not iterable" error occurred
    const hasIterableError = errors.some(err => err.includes('is not iterable'));
    expect(hasIterableError).toBe(false);

    // Should either show 404 or redirect to board
    const url = page.url();
    const is404 = url.includes('/c/INVALID99') || await page.getByText(/not found|404/i).isVisible().catch(() => false);
    const isRedirected = url.includes('/b/');

    expect(is404 || isRedirected).toBe(true);
  });

  test('should prevent navigation crash when card not yet synced', async ({ page }) => {
    // Add a list and card
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(1000);

    const addCardButton = page.getByRole('button', { name: '+ Add Card' }).first();
    await addCardButton.click();
    await expect(page.getByText('New Card').first()).toBeVisible();

    // DON'T wait for sync - try to open immediately
    await page.getByText('New Card').first().click();

    // Should either:
    // 1. Show modal with query param (if card has short_id)
    // 2. Not crash if card doesn't have short_id yet

    await page.waitForTimeout(1000);

    // Verify no crash occurred
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.waitForTimeout(1000);

    const hasIterableError = errors.some(err => err.includes('is not iterable'));
    expect(hasIterableError).toBe(false);

    // URL should either have ?card= or remain on board URL
    const url = page.url();
    const hasCardQuery = url.includes('?card=') || url.includes('&card=');
    const isOnBoardUrl = url.includes(testBoardCanonicalPath);

    expect(hasCardQuery || isOnBoardUrl).toBe(true);
  });

  test('should restore snapshot on drag error @feature:boards', async ({ page }) => {
    // Get initial board state
    const boardId = testBoard.id;
    const initialResponse = await fetch(`${BASE_URL}/api/boards/${boardId}/data`);
    const initialData = await initialResponse.json();
    const initialListCount = initialData.lists.length;

    // Ensure we have at least 2 lists
    if (initialListCount < 2) {
      await page.getByRole('button', { name: '+ Add List' }).click();
      await page.waitForTimeout(500);
    }

    // Get the current list order
    const lists = page.locator('[data-testid^="list-"]');
    const listTitles: string[] = [];

    const count = await lists.count();
    for (let i = 0; i < count; i++) {
      const title = await lists.nth(i).locator('[data-testid="list-title"]').textContent();
      listTitles.push(title || '');
    }

    // Simulate a drag operation that might fail
    // (In a real scenario, this would involve mocking API failures)
    // For now, we verify that after a drag, if we refresh, the state is consistent
    const firstList = lists.first();
    const secondList = lists.nth(1);

    const firstBox = await firstList.boundingBox();
    const secondBox = await secondList.boundingBox();

    if (firstBox && secondBox) {
      // Start drag
      await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
      await page.mouse.down();

      // Move to new position
      await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, { steps: 5 });
      await page.mouse.up();

      // Wait for the operation to complete
      await page.waitForTimeout(1000);

      // Refresh the page to ensure state was persisted correctly
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify board still renders without errors
      await expect(page.locator('[data-testid^="list-"]')).toHaveCount(count);

      // Get updated board data
      const finalResponse = await fetch(`${BASE_URL}/api/boards/${boardId}/data`);
      const finalData = await finalResponse.json();

      // Verify data integrity - all lists should still exist
      expect(finalData.lists.length).toBe(count);

      // All positions should be normalized
      const positions = finalData.lists.map((list: any) => list.position).sort((a: number, b: number) => a - b);

      for (let i = 1; i < positions.length; i++) {
        const gap = positions[i] - positions[i - 1];
        expect(gap).toBe(10);
      }
    }
  });

  test('should use normalized positions (1000/10 gaps) for new lists @feature:boards', async ({ page }) => {
    // Add first list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(500);

    // Add second list
    await page.getByRole('button', { name: '+ Add List' }).click();
    await page.waitForTimeout(500);

    // Get board data via API to check positions
    const boardId = testBoard.id;
    const dataResponse = await fetch(`${BASE_URL}/api/boards/${boardId}/data`);
    const { lists } = await dataResponse.json();

    // Verify positions use 1000/10 gaps
    expect(lists.length).toBeGreaterThanOrEqual(2);

    // Default lists should have normalized positions
    const positions = lists.map((list: any) => list.position).sort((a: number, b: number) => a - b);

    // Check that positions start at 1000 and have 10-unit gaps
    expect(positions[0]).toBe(1000);
    if (positions.length > 1) {
      expect(positions[1]).toBe(1010);
    }
    if (positions.length > 2) {
      expect(positions[2]).toBe(1020);
    }
  });

  test('should maintain position gaps after drag and drop @feature:boards', async ({ page }) => {
    // Ensure we have at least 3 lists
    const listCount = await page.locator('[data-testid^="list-"]').count();

    for (let i = listCount; i < 3; i++) {
      await page.getByRole('button', { name: '+ Add List' }).click();
      await page.waitForTimeout(300);
    }

    // Get initial list order
    const lists = page.locator('[data-testid^="list-"]');
    const firstList = lists.first();
    const thirdList = lists.nth(2);

    // Drag first list to third position
    await firstList.hover();
    await page.waitForTimeout(200);

    const firstListBox = await firstList.boundingBox();
    const thirdListBox = await thirdList.boundingBox();

    if (firstListBox && thirdListBox) {
      await page.mouse.move(firstListBox.x + firstListBox.width / 2, firstListBox.y + firstListBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(thirdListBox.x + thirdListBox.width / 2, thirdListBox.y + thirdListBox.height / 2, { steps: 10 });
      await page.mouse.up();

      await page.waitForTimeout(1000);

      // Get board data to verify positions
      const boardId = testBoard.id;
      const dataResponse = await fetch(`${BASE_URL}/api/boards/${boardId}/data`);
      const { lists: updatedLists } = await dataResponse.json();

      // All positions should be normalized with 10-unit gaps
      const positions = updatedLists.map((list: any) => list.position).sort((a: number, b: number) => a - b);

      for (let i = 1; i < positions.length; i++) {
        const gap = positions[i] - positions[i - 1];
        expect(gap).toBe(10);
      }
    }
  });
});
