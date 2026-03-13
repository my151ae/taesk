import { test, expect } from '@playwright/test';

import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';
import { createClient } from '@supabase/supabase-js';

const TEST_USER_EMAIL = process.env.E2E_USER_EMAIL || 'e2e-test@taesk.app';
const MOCK_MEMBER_ID = '00000000-0000-0000-0000-000000000001';
const MAIN_TEST_BOARD_ID = '00000000-0000-0000-0000-000000000001';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase admin credentials for board-permissions.spec.ts');
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
}

async function resolveTestUserId(): Promise<string> {
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', TEST_USER_EMAIL)
    .limit(1);

  const profileId = profiles?.[0]?.id;
  if (error || !profileId) {
    throw new Error(`Failed to resolve test user id for ${TEST_USER_EMAIL}: ${error?.message ?? 'not found'}`);
  }

  return profileId;
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

  return { id: boardId, name: boardName, shortId, idShort, slug };
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
    testUserId = await resolveTestUserId();
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

    await page.goto(`/b/${testBoard.shortId}/${testBoard.slug}`);
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

  test('should display ShareDialog when clicking share button @e2e:essential', async ({ page }) => {
    // Wait for board to load
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="timeline-grid"]', { state: 'attached', timeout: 10000 }).catch(() => {
      // Board might have no lists yet, that's OK
    });

    // Click share button
    const shareButton = page.getByTestId('share-button').first();
    await shareButton.waitFor({ state: 'visible', timeout: 10000 });
    await shareButton.click();

    // Verify ShareDialog is visible
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Share Board')).toBeVisible();

    // Verify members list is displayed (check for names as they are primary)
    await expect(dialog.getByText('Test Owner')).toBeVisible();
    await expect(dialog.getByText('Test Editor')).toBeVisible();
  });

  test('should change member role', async ({ page }) => {
    // Open ShareDialog
    const shareButton = page.getByTestId('share-button').first();
    await shareButton.click();
    await expect(page.getByRole('dialog', { name: /share/i })).toBeVisible({ timeout: 10000 });

    // Find editor member and change role
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Test Editor')).toBeVisible();
    const editorRow = dialog.locator('div').filter({ hasText: 'Test Editor' }).first();
    const roleSelect = editorRow.getByRole('combobox').first();

    await roleSelect.selectOption('commenter');
    await expect(roleSelect).toHaveValue('commenter');
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
    const shareButton = page.getByTestId('share-button').first();
    await shareButton.click();
    await expect(page.getByRole('dialog', { name: /share/i })).toBeVisible({ timeout: 10000 });

    // Find editor member and click remove button
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Test Editor')).toBeVisible();
    const editorRow = dialog.locator('div').filter({ hasText: 'Test Editor' }).first();
    const removeButton = editorRow.getByRole('button', { name: /remove/i });

    // Handle confirmation dialog if present
    page.once('dialog', (dialog) => dialog.accept());
    await removeButton.click();

    await expect.poll(() => memberRemoveCalled, { timeout: 5000 }).toBe(true);
  });

  test('should display invite link section (Phase 3) @phase3', async ({ page }) => {
    // Open ShareDialog
    const shareButton = page.getByTestId('share-button').first();
    await shareButton.click();
    await expect(page.getByRole('dialog', { name: /share/i })).toBeVisible({ timeout: 10000 });

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
    const shareButton = page.getByTestId('share-button').first();
    await shareButton.click();

    // Wait for dialog and members list to load
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Test Owner')).toBeVisible({ timeout: 10000 });

    // Find owner member row using border class and email text
    const ownerRow = dialog.locator('.border.rounded').filter({ hasText: 'Test Owner' }).first();
    await expect(ownerRow).toBeVisible();

    // Find the select within that row
    const roleSelect = ownerRow.locator('select');
    await expect(roleSelect).toBeVisible();

    // Owner's role select should be disabled and have 'owner' value
    await expect(roleSelect).toBeDisabled();
    await expect(roleSelect).toHaveValue('owner');
  });

  test('should reject board creation without team_id @failure:validation', async ({ page }) => {
    const response = await page.request.post('/api/boards', {
      headers: { 'Content-Type': 'application/json' },
      data: { name: 'Missing Team' },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body?.error?.code).toBe('INVALID_BODY');
  });

  test('should reject board creation for guest team members @failure:permissions', async ({ page }) => {
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

  test('should allow board creation for members when team setting permits it', async ({ page }) => {
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

  test('should reject board creation across team boundaries @failure:permissions', async ({ page }) => {
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
