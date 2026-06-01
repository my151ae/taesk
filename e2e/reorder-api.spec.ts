import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '@/lib/board-utils';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const E2E_SECRET = process.env.E2E_SECRET;
const TEST_USER_EMAIL = process.env.E2E_USER_EMAIL;
const MAIN_TEST_BOARD_ID = '00000000-0000-0000-0000-000000000001';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !serviceRoleKey || !E2E_SECRET || !TEST_USER_EMAIL) {
  throw new Error('Missing Supabase admin credentials, E2E_SECRET, or E2E_USER_EMAIL for reorder-api.spec.ts');
}

const API_HEADERS = { 'x-e2e-secret': E2E_SECRET } as const;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

let cachedTestUserId: string | null = null;
let cachedTestTeamId: string | null = null;

async function getTestUserId(): Promise<string> {
  if (cachedTestUserId) return cachedTestUserId;

  const targetEmail = TEST_USER_EMAIL.trim().toLowerCase();
  const perPage = 200;
  const maxPages = 25;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to resolve test user: ${error.message}`);
    }

    const found = data.users?.find((u) => (u.email ?? '').toLowerCase() === targetEmail);
    if (found?.id) {
      cachedTestUserId = found.id;
      return found.id;
    }

    if (!data.users || data.users.length < perPage) {
      break;
    }
  }

  throw new Error(`Test user not found for email: ${TEST_USER_EMAIL}`);
}

async function getTestTeamId(): Promise<string> {
  if (cachedTestTeamId) return cachedTestTeamId;

  const { data, error } = await supabaseAdmin
    .from('boards')
    .select('team_id')
    .eq('id', MAIN_TEST_BOARD_ID)
    .maybeSingle();

  const teamId = data?.team_id;
  if (error || !teamId) {
    throw new Error(`Failed to resolve test team_id: ${error?.message ?? 'missing team_id'}`);
  }

  cachedTestTeamId = teamId;
  return teamId;
}

async function createReorderFixture(ownerId: string): Promise<{ boardId: string; listId: string; cardIds: string[] }> {
  const now = new Date().toISOString();
  const boardId = crypto.randomUUID();
  const boardName = `Reorder Test Board ${Date.now()}`;
  const shortId = await createUniqueBoardShortId();
  const idShort = await getNextBoardIdShort();
  const slug = slugifyBoardName(boardName);
  const listId = crypto.randomUUID();
  const teamId = await getTestTeamId();

  const { error: boardError } = await supabaseAdmin.from('boards').insert({
    id: boardId,
    team_id: teamId,
    name: boardName,
    user_id: ownerId,
    short_id: shortId,
    id_short: idShort,
    slug,
    is_test_board: true,
    created_at: now,
    updated_at: now,
  });
  if (boardError) {
    throw new Error(`Failed to create test board fixture: ${boardError.message}`);
  }

  const { error: memberError } = await supabaseAdmin.from('board_members').insert({
    board_id: boardId,
    profile_id: ownerId,
    role: 'owner',
    created_at: now,
  });
  if (memberError) {
    throw new Error(`Failed to add test owner membership: ${memberError.message}`);
  }

  const { error: listError } = await supabaseAdmin.from('lists').insert({
    id: listId,
    title: 'Reorder Test List',
    position: 1000,
    board_id: boardId,
    user_id: ownerId,
    created_at: now,
    updated_at: now,
  });
  if (listError) {
    throw new Error(`Failed to create test list fixture: ${listError.message}`);
  }

  const cards = Array.from({ length: 5 }, (_, index) => ({
    id: crypto.randomUUID(),
    board_id: boardId,
    list_id: listId,
    user_id: ownerId,
    title: `Card ${index + 1}`,
    position: 1000 + index * 10,
    created_at: now,
    updated_at: now,
  }));
  const { error: cardsError } = await supabaseAdmin.from('cards').insert(cards);
  if (cardsError) {
    throw new Error(`Failed to create test cards fixture: ${cardsError.message}`);
  }

  return {
    boardId,
    listId,
    cardIds: cards.map((card) => card.id),
  };
}

test.describe('Reorder API (Timeline) @feature:reorder', () => {
  let boardId: string;
  let listId: string;
  let cardIds: string[] = [];
  let testUserId: string;

  test.beforeAll(async () => {
    testUserId = await getTestUserId();
  });

  test.beforeEach(async ({ page }) => {
    const fixture = await createReorderFixture(testUserId);
    boardId = fixture.boardId;
    listId = fixture.listId;
    cardIds = fixture.cardIds;
    await page.goto('/board');
  });

  test.afterEach(async () => {
    if (boardId) {
      await supabaseAdmin.from('boards').delete().eq('id', boardId);
    }
  });

  test('should reorder cards successfully', async ({ page }) => {
    const updates = [
      { id: cardIds[0], position: 1050 },
      { id: cardIds[1], position: 1040 },
      { id: cardIds[2], position: 1030 },
    ];

    const res = await page.request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
      headers: API_HEADERS,
    });

    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.updated).toBe(3);
    expect(result.unchanged).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test('should reject duplicate IDs @failure:validation', async ({ page }) => {
    const updates = [
      { id: cardIds[0], position: 1000 },
      { id: cardIds[0], position: 1010 },
    ];

    const res = await page.request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
      headers: API_HEADERS,
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error?.code).toBeDefined();
    expect(['VALIDATION_ERROR', 'INVALID_BODY']).toContain(result.error.code);
    if (Array.isArray(result.issues)) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  test('should reject invalid UUID format @failure:validation', async ({ page }) => {
    const updates = [
      { id: '00000000-0000-0000-0000-000000000999', position: 1000 },
    ];

    const res = await page.request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
      headers: API_HEADERS,
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error?.code).toBeDefined();
    expect(['INVALID_BODY', 'VALIDATION_ERROR']).toContain(result.error.code);
  });

  test('should reject invalid schema (missing position) @failure:validation', async ({ page }) => {
    const updates = [
      { id: cardIds[0] },
    ];

    const res = await page.request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
      headers: API_HEADERS,
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error?.code).toBeDefined();
    expect(['INVALID_BODY', 'VALIDATION_ERROR']).toContain(result.error.code);
  });

  test('should renumber card positions in a list', async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/boards/${boardId}/cards/renumber`, {
      data: { listId },
      headers: API_HEADERS,
    });

    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.updated).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test('should handle concurrent reorders (transaction test)', async ({ page }) => {
    const now = new Date().toISOString();
    const extraCards = Array.from({ length: 10 }, (_, index) => ({
      id: crypto.randomUUID(),
      board_id: boardId,
      list_id: listId,
      user_id: testUserId,
      title: `Concurrent Card ${index + 1}`,
      position: 2000 + index * 10,
      created_at: now,
      updated_at: now,
    }));
    const { error: extraCardsError } = await supabaseAdmin.from('cards').insert(extraCards);
    if (extraCardsError) {
      throw new Error(`Failed to create concurrent cards: ${extraCardsError.message}`);
    }
    const concurrentCardIds = extraCards.map((card) => card.id);

    const updates1 = concurrentCardIds.slice(0, 3).map((id, i) => ({ id, position: 3000 + i * 10 }));
    const updates2 = concurrentCardIds.slice(3, 6).map((id, i) => ({ id, position: 3030 + i * 10 }));
    const updates3 = concurrentCardIds.slice(6, 9).map((id, i) => ({ id, position: 3060 + i * 10 }));

    const [res1, res2, res3] = await Promise.all([
      page.request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
        data: { updates: updates1 },
        headers: API_HEADERS,
      }),
      page.request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
        data: { updates: updates2 },
        headers: API_HEADERS,
      }),
      page.request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
        data: { updates: updates3 },
        headers: API_HEADERS,
      }),
    ]);

    expect(res1.status()).toBe(200);
    expect(res2.status()).toBe(200);
    expect(res3.status()).toBe(200);

    const result1 = await res1.json();
    const result2 = await res2.json();
    const result3 = await res3.json();

    expect(result1.updated).toBe(3);
    expect(result2.updated).toBe(3);
    expect(result3.updated).toBe(3);
  });
});
