import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const E2E_SECRET = process.env.E2E_SECRET || 'redacted-e2e-secret';
const API_HEADERS = { 'x-e2e-secret': E2E_SECRET } as const;

test.describe('Reorder API (Timeline) @feature:reorder', () => {
  let boardId: string;
  let listId: string;
  let cardIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    // Create a test board for each test (ensures isolation)
    const boardRes = await request.post(`${BASE_URL}/api/boards`, {
      data: { name: 'Reorder Test Board', is_test_board: true },
    });
    const boardData = await boardRes.json();
    boardId = boardData.board.id;

    // Create 5 test cards (let API create the default list if needed)
    cardIds = [];
    for (let i = 0; i < 5; i++) {
      const cardRes = await request.post(`${BASE_URL}/api/boards/${boardId}/cards`, {
        data: {
          title: `Card ${i + 1}`,
          position: 1000 + i * 10,
        },
      });
      const cardData = await cardRes.json();
      cardIds.push(cardData.card.id);
      if (!listId) {
        listId = cardData.card.list_id;
      }
    }
  });

  test.afterEach(async ({ request }) => {
    // Clean up test board (CASCADE will delete all associated lists and cards)
    if (boardId) {
      await request.delete(`${BASE_URL}/api/boards/${boardId}`);
    }
  });

  test('should reorder cards successfully', async ({ request }) => {
    const updates = [
      { id: cardIds[0], position: 1050 },
      { id: cardIds[1], position: 1040 },
      { id: cardIds[2], position: 1030 },
    ];

    const res = await request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
    });

    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.updated).toBe(3);
    expect(result.unchanged).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test('should reject duplicate IDs @failure:validation', async ({ request }) => {
    const updates = [
      { id: cardIds[0], position: 1000 },
      { id: cardIds[0], position: 1010 }, // duplicate
    ];

    const res = await request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error).toEqual({ code: 'VALIDATION_ERROR', message: 'Bad Request' });
    expect(result.issues).toBeDefined();
    expect(result.issues.some((i: any) => i.code === 'DUPLICATE_ID')).toBe(true);
  });

  test('should reject invalid UUID format @failure:validation', async ({ request }) => {
    const updates = [
      { id: '00000000-0000-0000-0000-000000000999', position: 1000 }, // invalid UUID
    ];

    const res = await request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error.code).toBe('INVALID_BODY');
    expect(result.error.message).toBe('Validation failed');
  });

  test('should reject invalid schema (missing position) @failure:validation', async ({ request }) => {
    const updates = [
      { id: cardIds[0] }, // missing position
    ];

    const res = await request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error.code).toBe('INVALID_BODY');
    expect(result.error.message).toBe('Validation failed');
  });

  test('should renumber card positions in a list', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/boards/${boardId}/cards/renumber`, {
      data: { listId },
    });

    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.updated).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test('should handle concurrent reorders (transaction test)', async ({ request }) => {
    // Create additional cards for concurrency test
    const concurrentCardIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request.post(`${BASE_URL}/api/boards/${boardId}/cards`, {
        data: {
          title: `Concurrent Card ${i + 1}`,
          position: 2000 + i * 10,
        },
      });
      const data = await res.json();
      concurrentCardIds.push(data.card.id);
    }

    // Send 3 concurrent reorder requests
    const updates1 = concurrentCardIds.slice(0, 3).map((id, i) => ({
      id,
      position: 3000 + i * 10,
    }));

    const updates2 = concurrentCardIds.slice(3, 6).map((id, i) => ({
      id,
      position: 3030 + i * 10,
    }));

    const updates3 = concurrentCardIds.slice(6, 9).map((id, i) => ({
      id,
      position: 3060 + i * 10,
    }));

    const [res1, res2, res3] = await Promise.all([
      request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
        data: { updates: updates1 },
      }),
      request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
        data: { updates: updates2 },
      }),
      request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
        data: { updates: updates3 },
      }),
    ]);

    // All should succeed (advisory lock prevents conflicts)
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
