import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanup() {
    console.log('Searching for "New Card" or cards with missing short_id...');

    const { data: cards, error } = await supabase
        .from('cards')
        .select('id, title, short_id, created_at')
        .or('title.eq.New Card,short_id.is.null');

    if (error) {
        console.error('Error fetching cards:', error);
        return;
    }

    if (!cards || cards.length === 0) {
        console.log('No "New Card" found.');
        return;
    }

    console.log(`Found ${cards.length} cards with title "New Card".`);

    // Delete them
    const { error: deleteError } = await supabase
        .from('cards')
        .delete()
        .or('title.eq.New Card,short_id.is.null');

    if (deleteError) {
        console.error('Error deleting cards:', deleteError);
    } else {
        console.log('Successfully deleted cards.');
    }
}

cleanup();
