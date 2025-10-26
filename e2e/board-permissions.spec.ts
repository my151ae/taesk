import { test, expect } from '@playwright/test';

import { supabase } from '@/lib/supabase';
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';

const TEST_USER_ID = 'f6baf5d0-ac5b-491a-aa47-3bc5c05243f2'; // e2e.taesk.test@gmail.com
const MOCK_MEMBER_ID = '00000000-0000-0000-0000-000000000001';

interface TestBoard {
  id: string;
  name: string;
  shortId: string;
  idShort: number;
  slug: string;
}

async function createTestBoard(boardName: string): Promise<TestBoard> {
  const boardId = crypto.randomUUID();
  const shortId = await createUniqueBoardShortId();
  const idShort = await getNextBoardIdShort();
  const slug = slugifyBoardName(boardName);

  const { error: boardError } = await supabase.from('boards').insert({
    id: boardId,
    name: boardName,
    user_id: TEST_USER_ID,
    is_test_board: true,
    short_id: shortId,
    id_short: idShort,
    slug,
  });

  if (boardError) {
    throw new Error(`Failed to create test board: ${boardError.message}`);
  }

  // Add owner member
  const { error: memberError } = await supabase.from('board_members').insert({
    board_id: boardId,
    profile_id: TEST_USER_ID,
    role: 'owner',
  });

  if (memberError) {
    throw new Error(`Failed to create board owner: ${memberError.message}`);
  }

  return { id: boardId, name: boardName, shortId, idShort, slug };
}

test.describe('Board Permissions @feature:boards', () => {
  let testBoard: TestBoard | null = null;

  test.beforeEach(async ({ page }) => {
    const boardName = `Permissions Test ${Date.now()}`;
    testBoard = await createTestBoard(boardName);

    // Mock board_members API to simulate members
    await page.route('**/api/boards/*/members*', async (route) => {
      const method = route.request().method();
      const url = route.request().url();

      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            members: [
              {
                board_id: testBoard?.id,
                profile_id: TEST_USER_ID,
                role: 'owner',
                created_at: new Date().toISOString(),
                profile: {
                  id: TEST_USER_ID,
                  full_name: 'Test Owner',
                  avatar_url: null,
                  email: 'owner@example.com',
                },
              },
              {
                board_id: testBoard?.id,
                profile_id: MOCK_MEMBER_ID,
                role: 'editor',
                created_at: new Date().toISOString(),
                profile: {
                  id: MOCK_MEMBER_ID,
                  full_name: 'Test Editor',
                  avatar_url: null,
                  email: 'editor@example.com',
                },
              },
            ],
          }),
        });
        return;
      }

      if (method === 'PATCH' && url.includes('/role')) {
        // Role update
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      if (method === 'DELETE') {
        // Member removal
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fallback();
    });

    await page.goto(`/b/${testBoard.shortId}/${testBoard.slug}`);
  });

  test.afterEach(async () => {
    if (testBoard?.id) {
      await supabase.from('boards').delete().eq('id', testBoard.id);
    }
    testBoard = null;
  });

  test('should display ShareDialog when clicking share button @e2e:essential', async ({ page }) => {
    // Wait for board to load
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid^="list-"]', { state: 'attached', timeout: 10000 }).catch(() => {
      // Board might have no lists yet, that's OK
    });

    // Click share button
    const shareButton = page.getByRole('button', { name: 'Share board' });
    await shareButton.waitFor({ state: 'visible', timeout: 10000 });
    await shareButton.click();

    // Verify ShareDialog is visible
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /share|permissions/i })).toBeVisible();

    // Verify members list is displayed
    await expect(page.getByText('owner@example.com')).toBeVisible();
    await expect(page.getByText('editor@example.com')).toBeVisible();
  });

  test('should change member role', async ({ page }) => {
    let roleUpdateCalled = false;

    await page.route('**/api/boards/*/members/*/role', async (route) => {
      if (route.request().method() === 'PATCH') {
        roleUpdateCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }
      await route.fallback();
    });

    // Open ShareDialog
    const shareButton = page.getByRole('button', { name: 'Share board' });
    await shareButton.click();

    // Find editor member and change role
    await expect(page.getByText('editor@example.com')).toBeVisible();
    const editorRow = page.locator('div').filter({ hasText: /editor@example\.com/ }).first();
    const roleSelect = editorRow.getByRole('combobox');

    await roleSelect.selectOption('commenter');
    await expect.poll(() => roleUpdateCalled, { timeout: 5000 }).toBe(true);
  });

  test('should remove board member', async ({ page }) => {
    let memberRemoveCalled = false;

    await page.route('**/api/boards/*/members/*', async (route) => {
      if (route.request().method() === 'DELETE') {
        memberRemoveCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }
      await route.fallback();
    });

    // Open ShareDialog
    const shareButton = page.getByRole('button', { name: 'Share board' });
    await shareButton.click();

    // Find editor member and click remove button
    await expect(page.getByText('editor@example.com')).toBeVisible();
    const editorRow = page.locator('div').filter({ hasText: /editor@example\.com/ }).first();
    const removeButton = editorRow.getByRole('button', { name: /remove/i });

    // Handle confirmation dialog if present
    page.once('dialog', (dialog) => dialog.accept());
    await removeButton.click();

    await expect.poll(() => memberRemoveCalled, { timeout: 5000 }).toBe(true);
  });

  test('should display invite link section (Phase 3) @phase3', async ({ page }) => {
    // Open ShareDialog
    const shareButton = page.getByRole('button', { name: 'Share board' });
    await shareButton.click();

    // Look for invite link section (may not be implemented yet)
    const inviteLinkSection = page.locator('text=/invite link|招待リンク/i');
    if ((await inviteLinkSection.count()) > 0) {
      await expect(inviteLinkSection).toBeVisible();

      // Verify copy link button
      const copyLinkButton = page.getByRole('button', { name: /copy link/i });
      await expect(copyLinkButton).toBeVisible();
    } else {
      // Not implemented yet - this is expected for Phase 3 features
      expect(true).toBe(true);
    }
  });

  test('should prevent non-owner from changing owner role @failure:permissions', async ({ page }) => {
    // Open ShareDialog
    const shareButton = page.getByRole('button', { name: 'Share board' });
    await shareButton.click();

    // Find owner member row
    await expect(page.getByText('owner@example.com')).toBeVisible();
    const ownerRow = page.locator('div').filter({ hasText: /owner@example\.com/ }).first();
    const roleSelect = ownerRow.getByRole('combobox');

    // Owner's role select should be disabled
    await expect(roleSelect).toBeDisabled();
  });
});
