/**
 * Script to backfill short_id, id_short, and slug for existing cards
 * Run with: npx tsx scripts/backfill-short-ids.ts
 */

import { supabase } from '../lib/supabase';
import { createUniqueShortId, getNextIdShort, slugify } from '../lib/card-utils';

async function backfillShortIds() {
  console.log('Starting backfill of short_id, id_short, and slug...\n');

  // Get all cards without short_id
  const { data: cards, error } = await supabase
    .from('cards')
    .select('*')
    .is('short_id', null);

  if (error) {
    console.error('Error fetching cards:', error);
    return;
  }

  if (!cards || cards.length === 0) {
    console.log('No cards need backfilling. All done! ✅');
    return;
  }

  console.log(`Found ${cards.length} cards to backfill\n`);

  // Group cards by board_id to assign id_short correctly
  const cardsByBoard = new Map<string, typeof cards>();
  for (const card of cards) {
    if (!cardsByBoard.has(card.board_id)) {
      cardsByBoard.set(card.board_id, []);
    }
    cardsByBoard.get(card.board_id)!.push(card);
  }

  let successCount = 0;
  let errorCount = 0;

  // Process each board
  for (const [boardId, boardCards] of cardsByBoard.entries()) {
    console.log(`Processing board ${boardId}...`);

    for (const card of boardCards) {
      try {
        // Generate short_id, id_short, and slug
        const shortId = await createUniqueShortId();
        const idShort = await getNextIdShort(boardId);
        const slug = slugify(card.title);

        // Update the card
        const { error: updateError } = await supabase
          .from('cards')
          .update({
            short_id: shortId,
            id_short: idShort,
            slug,
            updated_at: new Date().toISOString(),
          })
          .eq('id', card.id);

        if (updateError) {
          console.error(`  ❌ Error updating card ${card.id}:`, updateError);
          errorCount++;
        } else {
          console.log(`  ✅ Updated card "${card.title}": short_id=${shortId}, id_short=${idShort}, slug=${slug}`);
          successCount++;
        }
      } catch (err) {
        console.error(`  ❌ Error processing card ${card.id}:`, err);
        errorCount++;
      }
    }
  }

  console.log(`\nBackfill complete!`);
  console.log(`  Success: ${successCount} cards`);
  console.log(`  Errors: ${errorCount} cards`);
}

backfillShortIds();
