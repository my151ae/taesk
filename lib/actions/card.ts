'use server';

import { supabase } from '@/lib/supabase';
import { cache } from 'react';
import type { Card } from '@/lib/supabase';

/**
 * Server Action: Get card by short_id
 * Uses React cache for deduplication
 */
export const getCardByShortId = cache(async (shortId: string): Promise<Card | null> => {
  try {
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('short_id', shortId)
      .single();

    if (error) {
      console.error('Failed to fetch card:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Unexpected error fetching card:', error);
    return null;
  }
});

