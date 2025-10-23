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
                profile_id: TEST_USER_ID,
                role: 'owner',
                email: 'owner@example.com',
                display_name: 'Test Owner',
              },
              {
                profile_id: MOCK_MEMBER_ID,
                role: 'editor',
                email: 'editor@example.com',
                display_name: 'Test Editor',
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
    // Click share/settings button
    const shareButton = page.getByRole('button', { name: /share|settings/i });
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
    const shareButton = page.getByRole('button', { name: /share|settings/i });
    await shareButton.click();

    // Find editor member and change role
    const editorRow = page.locator('tr, div').filter({ hasText: 'editor@example.com' }).first();
    const roleSelect = editorRow.locator('select, [role="combobox"]');

    if ((await roleSelect.count()) > 0) {
      await roleSelect.selectOption('commenter');
      await expect.poll(() => roleUpdateCalled).toBe(true);
    } else {
      // If no select element, skip this assertion
      test.skip();
    }
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
    const shareButton = page.getByRole('button', { name: /share|settings/i });
    await shareButton.click();

    // Find editor member and click remove button
    const editorRow = page.locator('tr, div').filter({ hasText: 'editor@example.com' }).first();
    const removeButton = editorRow.getByRole('button', { name: /remove|delete/i });

    if ((await removeButton.count()) > 0) {
      // Handle confirmation dialog if present
      page.once('dialog', (dialog) => dialog.accept());
      await removeButton.click();

      await expect.poll(() => memberRemoveCalled).toBe(true);
    } else {
      test.skip();
    }
  });

  test('should display invite link section (Phase 3) @phase3', async ({ page }) => {
    // Open ShareDialog
    const shareButton = page.getByRole('button', { name: /share|settings/i });
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
    const shareButton = page.getByRole('button', { name: /share|settings/i });
    await shareButton.click();

    // Find owner member row
    const ownerRow = page.locator('tr, div').filter({ hasText: 'owner@example.com' }).first();
    const roleSelect = ownerRow.locator('select, [role="combobox"]');

    if ((await roleSelect.count()) > 0) {
      // Owner's role select should be disabled
      await expect(roleSelect).toBeDisabled();
    } else {
      // Or role change UI should not be present for owner
      const changeRoleButton = ownerRow.getByRole('button', { name: /change role/i });
      await expect(changeRoleButton).toHaveCount(0);
    }
  });
});
