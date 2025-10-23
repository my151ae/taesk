#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const MAIN_BOARD_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: boards, error: boardsError } = await supabase
    .from('boards')
    .select('id, is_test_board');

  if (boardsError) {
    throw boardsError;
  }

  if (!boards || boards.length === 0) {
    console.log('No boards found.');
    return;
  }

  const idsToDelete = boards
    .filter((board) => board.id !== MAIN_BOARD_ID && !board.is_test_board)
    .map((board) => board.id);

  if (idsToDelete.length === 0) {
    console.log('No extra boards to delete.');
    return;
  }

  console.log(`Deleting ${idsToDelete.length} non-default board(s):`);
  idsToDelete.forEach((id) => console.log(`  - ${id}`));

  const cleanupTargets = [
    { table: 'activity_logs', column: 'board_id' },
    { table: 'cards', column: 'board_id' },
    { table: 'lists', column: 'board_id' },
    { table: 'board_members', column: 'board_id' },
    { table: 'notifications', column: 'board_id' },
    { table: 'notification_preferences', column: 'board_id' },
    { table: 'push_subscriptions', column: 'board_id' },
  ];

  for (const target of cleanupTargets) {
    const { error } = await supabase
      .from(target.table)
      .delete()
      .in(target.column, idsToDelete);

    if (error) {
      // Ignore missing-table errors (42P01) so the script can run across different schemas
      if (error.code === '42P01') {
        console.warn(`[skip] Table ${target.table} does not exist (ignored).`);
        continue;
      }

      console.warn(`[warn] Failed to clean ${target.table}: ${error.message}`);
    } else {
      console.log(`[ok] Cleaned ${target.table}`);
    }
  }

  const { error: deleteBoardsError } = await supabase
    .from('boards')
    .delete()
    .in('id', idsToDelete);

  if (deleteBoardsError) {
    throw deleteBoardsError;
  }

  console.log('Board reset complete.');
}

main().catch((err) => {
  console.error('[reset-boards] Failed:', err);
  process.exit(1);
});
