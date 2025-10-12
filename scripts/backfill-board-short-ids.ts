/**
 * Script to backfill short_id, id_short, and slug for existing boards
 * Run with: npx tsx scripts/backfill-board-short-ids.ts
 */

import { supabase } from '../lib/supabase';
import { createUniqueBoardShortId, getNextBoardIdShort, slugifyBoardName } from '../lib/board-utils';

async function backfillBoardShortIds() {
  console.log('Starting backfill of board short_id, id_short, and slug...\n');

  // Get all boards without short_id
  const { data: boards, error } = await supabase
    .from('boards')
    .select('*')
    .is('short_id', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching boards:', error);
    return;
  }

  if (!boards || boards.length === 0) {
    console.log('No boards need backfilling. All done! ✅');
    return;
  }

  console.log(`Found ${boards.length} boards to backfill\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const board of boards) {
    try {
      // Generate short_id, id_short, and slug
      const shortId = await createUniqueBoardShortId();
      const idShort = await getNextBoardIdShort();
      const slug = slugifyBoardName(board.name);

      // Update the board
      const { error: updateError } = await supabase
        .from('boards')
        .update({
          short_id: shortId,
          id_short: idShort,
          slug,
          updated_at: new Date().toISOString(),
        })
        .eq('id', board.id);

      if (updateError) {
        console.error(`  ❌ Error updating board ${board.id}:`, updateError);
        errorCount++;
      } else {
        console.log(`  ✅ Updated board "${board.name}": short_id=${shortId}, id_short=${idShort}, slug=${slug}`);
        successCount++;
      }
    } catch (err) {
      console.error(`  ❌ Error processing board ${board.id}:`, err);
      errorCount++;
    }
  }

  console.log(`\nBackfill complete!`);
  console.log(`  Success: ${successCount} boards`);
  console.log(`  Errors: ${errorCount} boards`);
}

backfillBoardShortIds();
