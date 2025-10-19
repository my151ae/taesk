import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const E2E_SECRET = process.env.E2E_SECRET || 'redacted-e2e-secret';

test.describe('Reorder API (Phase 2)', () => {
  let boardId: string;
  let listId: string;
  let cardIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    // Create a test board
    const boardRes = await request.post(`${BASE_URL}/api/boards`, {
      data: { name: 'Reorder Test Board', is_test_board: true },
    });
    const boardData = await boardRes.json();
    boardId = boardData.board.id;

    // Create a test list
    const listRes = await request.post(`${BASE_URL}/api/boards/${boardId}/lists`, {
      data: { title: 'Test List', position: 1000 },
    });
    const listData = await listRes.json();
    listId = listData.lists[0].id;

    // Create 5 test cards
    for (let i = 0; i < 5; i++) {
      const cardRes = await request.post(`${BASE_URL}/api/boards/${boardId}/cards`, {
        data: {
          title: `Card ${i + 1}`,
          list_id: listId,
          position: 1000 + i * 10,
        },
      });
      const cardData = await cardRes.json();
      cardIds.push(cardData.card.id);
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

  test('should reject duplicate IDs', async ({ request }) => {
    const updates = [
      { id: cardIds[0], position: 1000 },
      { id: cardIds[0], position: 1010 }, // duplicate
    ];

    const res = await request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error).toBe('Bad Request');
    expect(result.issues).toBeDefined();
    expect(result.issues.some((i: any) => i.code === 'DUPLICATE_ID')).toBe(true);
  });

  test('should reject unknown card IDs', async ({ request }) => {
    const updates = [
      { id: '00000000-0000-0000-0000-000000000999', position: 1000 }, // unknown
    ];

    const res = await request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error).toBe('Bad Request');
    expect(result.issues).toBeDefined();
    expect(result.issues.some((i: any) => i.code === 'UNKNOWN_ID')).toBe(true);
  });

  test('should reject invalid schema (missing position)', async ({ request }) => {
    const updates = [
      { id: cardIds[0] }, // missing position
    ];

    const res = await request.patch(`${BASE_URL}/api/boards/${boardId}/cards/reorder`, {
      data: { updates },
    });

    expect(res.status()).toBe(400);
    const result = await res.json();
    expect(result.error).toBe('Bad Request');
    expect(result.issues).toBeDefined();
    expect(result.issues.some((i: any) => i.code === 'INVALID_SCHEMA')).toBe(true);
  });

  test('should reorder lists successfully', async ({ request }) => {
    // Create 3 lists
    const listIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request.post(`${BASE_URL}/api/boards/${boardId}/lists`, {
        data: { title: `List ${i + 1}`, position: 1000 + i * 10 },
      });
      const data = await res.json();
      listIds.push(data.lists[0].id);
    }

    const updates = [
      { id: listIds[2], position: 1000 },
      { id: listIds[1], position: 1010 },
      { id: listIds[0], position: 1020 },
    ];

    const res = await request.patch(`${BASE_URL}/api/boards/${boardId}/lists/reorder`, {
      data: { updates },
    });

    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.updated).toBe(3);
  });

  test('should renumber card positions in a list', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/boards/${boardId}/cards/renumber`, {
      data: { listId },
    });

    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.updated).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify positions are renumbered with gaps
    const dataRes = await request.get(`${BASE_URL}/api/boards/${boardId}/data`);
    const data = await dataRes.json();
    const cards = data.lists.find((l: any) => l.id === listId)?.cards || [];

    // Check that positions have proper gaps (10)
    for (let i = 1; i < cards.length; i++) {
      const gap = cards[i].position - cards[i - 1].position;
      expect(gap).toBeGreaterThanOrEqual(10);
    }
  });

  test('should renumber list positions in a board', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/boards/${boardId}/lists/renumber`);

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
          list_id: listId,
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
