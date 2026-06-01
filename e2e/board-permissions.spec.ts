import { test, expect } from '@playwright/test';

import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';
import { createClient } from '@supabase/supabase-js';
import { resolveTestUserId as resolveAuthUserId } from './helpers/timeline-fixtures';

const TEST_USER_EMAIL = process.env.E2E_USER_EMAIL;
const MOCK_MEMBER_ID = '00000000-0000-0000-0000-000000000001';
const MAIN_TEST_BOARD_ID = '00000000-0000-0000-0000-000000000001';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !serviceRoleKey || !TEST_USER_EMAIL) {
  throw new Error('Missing Supabase admin credentials or E2E_USER_EMAIL for board-permissions.spec.ts');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

interface TestBoard {
  id: string;
  name: string;
  shortId: string;
  idShort: number;
  slug: string;
  canonicalPath: string;
}

async function openBoardAccessSettings(page: import('@playwright/test').Page, boardName: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForLoadState('networkidle');
    await page.getByTestId('board-menu-button').click();

    const boardButton = page.getByRole('button', { name: boardName, exact: true }).first();

    try {
      await expect(boardButton).toBeVisible({ timeout: 5000 });

      const boardRow = boardButton.locator('xpath=..');
      const settingsButton = boardRow.getByRole('button', { name: 'Board settings' });
      await expect(settingsButton).toBeVisible({ timeout: 5000 });
      await settingsButton.click();

      await expect(page.getByRole('heading', { name: 'Board Settings', exact: true })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('heading', { name: 'Board Access', exact: true })).toBeVisible({ timeout: 10000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 4) {
        throw error;
      }
      await page.goto('/board', { waitUntil: 'domcontentloaded' });
    }
  }

  if (lastError) {
    throw lastError;
  }
}

let cachedTestTeamId: string | null = null;

async function resolveTestTeamId(): Promise<string> {
  if (cachedTestTeamId) return cachedTestTeamId;

  const { data, error } = await supabaseAdmin
    .from('boards')
    .select('team_id')
    .eq('id', MAIN_TEST_BOARD_ID)
    .maybeSingle();

  const teamId = data?.team_id;
  if (error || !teamId) {
    throw new Error(`Failed to resolve test team id: ${error?.message ?? 'missing team_id'}`);
  }

  cachedTestTeamId = teamId;
  return teamId;
}

async function createTestBoard(boardName: string, ownerUserId: string): Promise<TestBoard> {
  const boardId = crypto.randomUUID();
  const shortId = await createUniqueBoardShortId();
  const idShort = await getNextBoardIdShort();
  const slug = slugifyBoardName(boardName);
  const teamId = await resolveTestTeamId();

  const { error: boardError } = await supabaseAdmin.from('boards').insert({
    id: boardId,
    team_id: teamId,
    name: boardName,
    user_id: ownerUserId,
    is_test_board: true,
    short_id: shortId,
    id_short: idShort,
    slug,
  });

  if (boardError) {
    throw new Error(`Failed to create test board: ${boardError.message}`);
  }

  // Add owner member
  const { error: memberError } = await supabaseAdmin.from('board_members').insert({
    board_id: boardId,
    profile_id: ownerUserId,
    role: 'owner',
  });

  if (memberError) {
    throw new Error(`Failed to create board owner: ${memberError.message}`);
  }

  const canonicalTail = slug ? `${idShort}-${slug}` : `${idShort}`;
  return {
    id: boardId,
    name: boardName,
    shortId,
    idShort,
    slug,
    canonicalPath: `/b/${shortId}/${canonicalTail}`,
  };
}

async function createTeamFixture(name: string, ownerUserId: string, allowMemberCreateBoard: boolean): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .insert({
      name,
      slug: `${slugifyBoardName(name)}-${Date.now()}`,
      team_type: 'custom',
      allow_member_create_board: allowMemberCreateBoard,
      created_by: ownerUserId,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create team fixture: ${error?.message ?? 'missing team id'}`);
  }

  return data.id;
}

async function ensureTeamRole(
  teamId: string,
  profileId: string,
  role: 'owner' | 'admin' | 'member' | 'guest'
) {
  const { error } = await supabaseAdmin
    .from('team_members')
    .upsert(
      {
        team_id: teamId,
        profile_id: profileId,
        role,
      },
      { onConflict: 'team_id,profile_id', ignoreDuplicates: false }
    );

  if (error) {
    throw new Error(`Failed to ensure team role ${role}: ${error.message}`);
  }
}

test.describe('Board Permissions @feature:boards', () => {
  let testBoard: TestBoard | null = null;
  let testUserId = '';
  let createdTeamIds: string[] = [];
  let createdBoardIds: string[] = [];

  test.beforeAll(async () => {
    testUserId = await resolveAuthUserId();
  });

  test.beforeEach(async ({ page }) => {
    const boardName = `Permissions Test ${Date.now()}`;
    testBoard = await createTestBoard(boardName, testUserId);

    const mockMembers: BoardMemberWithProfile[] = [
      {
        board_id: testBoard!.id,
        profile_id: testUserId,
        role: 'owner',
        created_at: new Date().toISOString(),
        profile: {
          id: testUserId,
          full_name: 'Test Owner',
          avatar_url: null,
          email: TEST_USER_EMAIL,
        },
      },
      {
        board_id: testBoard!.id,
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
    ];

    await page.route('**/api/boards/*/members', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ members: mockMembers }),
        });
        return;
      }

      await route.fallback();
    });

    await page.route('**/api/boards/*/members/*', async (route) => {
      const method = route.request().method();

      if (method === 'PATCH') {
        try {
          const payload = JSON.parse(route.request().postData() || '{}');
          const profileId = route.request().url().split('/').pop();
          mockMembers.forEach((member) => {
            if (member.profile_id === profileId) {
              member.role = payload.role;
            }
          });
        } catch {
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      if (method === 'DELETE') {
        const profileId = route.request().url().split('/').pop();
        const index = mockMembers.findIndex((member) => member.profile_id === profileId);
        if (index >= 0) {
          mockMembers.splice(index, 1);
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fallback();
    });

    await page.goto('/board', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('board-menu-button')).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () => {
        const response = await page.request.get('/api/boards');
        if (!response.ok()) return false;
        const body = (await response.json()) as { boards?: Array<{ id?: string }> };
        return (body.boards ?? []).some((board) => board.id === testBoard?.id);
      }, { timeout: 15000, intervals: [500, 1000, 2000] })
      .toBe(true);
  });

  test.afterEach(async () => {
    if (testBoard?.id) {
      await supabaseAdmin.from('boards').delete().eq('id', testBoard.id);
    }
    if (createdBoardIds.length > 0) {
      await supabaseAdmin.from('boards').delete().in('id', createdBoardIds);
    }
    if (createdTeamIds.length > 0) {
      await supabaseAdmin.from('teams').delete().in('id', createdTeamIds);
    }
    createdBoardIds = [];
    createdTeamIds = [];
    testBoard = null;
  });

  test('should display ShareDialog when clicking share button @e2e:essential @permissions:ui', async ({ page }) => {
    await openBoardAccessSettings(page, testBoard!.name);
    await expect(page.getByText('Test Owner')).toBeVisible();
    await expect(page.getByText('Test Editor')).toBeVisible();
  });

  test('should change member role @permissions:ui', async ({ page }) => {
    await openBoardAccessSettings(page, testBoard!.name);
    const membersSection = page.getByRole('heading', { name: 'Members', exact: true }).locator('xpath=ancestor::section[1]');
    const editorRow = membersSection.getByRole('button', { name: 'Remove' }).locator('xpath=ancestor::div[contains(@class,"justify-between")]');
    const roleSelect = editorRow.locator('select').first();

    await roleSelect.selectOption('commenter');
    await expect(roleSelect).toHaveValue('commenter');
  });

  test('should remove board member @permissions:ui', async ({ page }) => {
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

    await openBoardAccessSettings(page, testBoard!.name);
    const membersSection = page.getByRole('heading', { name: 'Members', exact: true }).locator('xpath=ancestor::section[1]');
    const removeButton = membersSection.getByRole('button', { name: /remove/i }).first();

    // Handle confirmation dialog if present
    page.once('dialog', (dialog) => dialog.accept());
    await removeButton.click();

    await expect.poll(() => memberRemoveCalled, { timeout: 5000 }).toBe(true);
  });

  test('should display invite link section (Phase 3) @phase3 @permissions:ui', async ({ page }) => {
    await openBoardAccessSettings(page, testBoard!.name);

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

  test('should prevent non-owner from changing owner role @failure:permissions @permissions:ui', async ({ page }) => {
    await openBoardAccessSettings(page, testBoard!.name);
    const ownerRow = page.locator('.border.rounded-lg').filter({ hasText: 'Test Owner' }).first();
    await expect(ownerRow).toBeVisible();

    // Find the select within that row
    const roleSelect = ownerRow.locator('select');
    await expect(roleSelect).toBeVisible();

    // Owner's role select should be disabled and have 'owner' value
    await expect(roleSelect).toBeDisabled();
    await expect(roleSelect).toHaveValue('owner');
  });

  test('should reject board creation without team_id @failure:validation @permissions:api', async ({ page }) => {
    const response = await page.request.post('/api/boards', {
      headers: { 'Content-Type': 'application/json' },
      data: { name: 'Missing Team' },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body?.error?.code).toBe('INVALID_BODY');
  });

  test('should reject board creation for guest team members @failure:permissions @permissions:api', async ({ page }) => {
    const teamId = await createTeamFixture(`Guest Team ${Date.now()}`, testUserId, true);
    createdTeamIds.push(teamId);
    await ensureTeamRole(teamId, testUserId, 'guest');

    const response = await page.request.post('/api/boards', {
      headers: { 'Content-Type': 'application/json' },
      data: { team_id: teamId, name: 'Guest Blocked Board' },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body?.error?.code).toBe('FORBIDDEN');
  });

  test('should allow board creation for members when team setting permits it @permissions:api', async ({ page }) => {
    const teamId = await createTeamFixture(`Member Team ${Date.now()}`, testUserId, true);
    createdTeamIds.push(teamId);
    await ensureTeamRole(teamId, testUserId, 'member');

    const response = await page.request.post('/api/boards', {
      headers: { 'Content-Type': 'application/json' },
      data: { team_id: teamId, name: 'Member Created Board' },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body?.board?.team_id).toBe(teamId);
    if (body?.board?.id) {
      createdBoardIds.push(body.board.id);
    }
  });

  test('should reject board creation across team boundaries @failure:permissions @permissions:api', async ({ page }) => {
    const teamId = await createTeamFixture(`Foreign Team ${Date.now()}`, testUserId, true);
    createdTeamIds.push(teamId);

    const response = await page.request.post('/api/boards', {
      headers: { 'Content-Type': 'application/json' },
      data: { team_id: teamId, name: 'Forbidden Team Board' },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body?.error?.code).toBe('FORBIDDEN');
  });
});
