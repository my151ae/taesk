#!/usr/bin/env node
/**
 * Smoke test for Phase 1 reorder API
 * Tests validation logic (doesn't require auth for validation errors)
 */

const BASE_URL = 'http://localhost:3000';

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    console.error(`❌ ${name}: ${error.message}`);
    return false;
  }
}

async function testCardsReorder() {
  const url = `${BASE_URL}/api/boards/test-board-id/cards/reorder`;

  // Test 1: Duplicate ID validation
  await test('Cards: Duplicate ID validation', async () => {
    const payload = {
      updates: [
        { id: 'card-1', position: 1000 },
        { id: 'card-1', position: 1010 }, // duplicate
      ],
    };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`);
    }

    const data = await res.json();
    if (!data.issues || !data.issues.some(i => i.code === 'DUPLICATE_ID')) {
      throw new Error('Expected DUPLICATE_ID issue');
    }
  });

  // Test 2: Invalid schema (missing position)
  await test('Cards: Invalid schema validation', async () => {
    const payload = {
      updates: [
        { id: 'card-1' }, // missing position
      ],
    };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`);
    }

    const data = await res.json();
    if (!data.issues || !data.issues.some(i => i.code === 'INVALID_SCHEMA')) {
      throw new Error('Expected INVALID_SCHEMA issue');
    }
  });

  // Test 3: Non-integer position
  await test('Cards: Non-integer position validation', async () => {
    const payload = {
      updates: [
        { id: 'card-1', position: 1000.5 }, // float
      ],
    };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`);
    }
  });
}

async function testListsReorder() {
  const url = `${BASE_URL}/api/boards/test-board-id/lists/reorder`;

  // Test 1: Duplicate ID validation
  await test('Lists: Duplicate ID validation', async () => {
    const payload = {
      updates: [
        { id: 'list-1', position: 1000 },
        { id: 'list-1', position: 1010 }, // duplicate
      ],
    };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`);
    }

    const data = await res.json();
    if (!data.issues || !data.issues.some(i => i.code === 'DUPLICATE_ID')) {
      throw new Error('Expected DUPLICATE_ID issue');
    }
  });

  // Test 2: Invalid schema
  await test('Lists: Invalid schema validation', async () => {
    const payload = {
      updates: [
        { id: 'list-1' }, // missing position
      ],
    };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status !== 400) {
      throw new Error(`Expected 400, got ${res.status}`);
    }

    const data = await res.json();
    if (!data.issues || !data.issues.some(i => i.code === 'INVALID_SCHEMA')) {
      throw new Error('Expected INVALID_SCHEMA issue');
    }
  });
}

console.log('🧪 Phase 1 Reorder API Smoke Tests\n');

await testCardsReorder();
await testListsReorder();

console.log('\n✅ All smoke tests passed!');
