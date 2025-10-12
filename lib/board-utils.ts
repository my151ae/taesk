import { supabase } from './supabase';
import { generateShortId } from './card-utils';
import { toSlugBase } from './slug';

/**
 * Check if a board short_id already exists in the database
 */
async function boardExistsByShortId(shortId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('boards')
    .select('id')
    .eq('short_id', shortId)
    .limit(1);

  if (error) {
    console.error('Error checking board short_id:', error);
    return false;
  }

  return data && data.length > 0;
}

/**
 * Generate a unique short_id for boards with collision checking
 */
export async function createUniqueBoardShortId(): Promise<string> {
  let shortId = generateShortId();
  let attempts = 0;
  const maxAttempts = 10;

  while (await boardExistsByShortId(shortId) && attempts < maxAttempts) {
    shortId = generateShortId();
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique board short_id after maximum attempts');
  }

  return shortId;
}

/**
 * Get the next id_short for boards (global sequential number)
 */
export async function getNextBoardIdShort(): Promise<number> {
  const { data, error } = await supabase
    .from('boards')
    .select('id_short')
    .order('id_short', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error getting next board id_short:', error);
    return 1;
  }

  if (data && data.length > 0 && data[0].id_short !== null) {
    return data[0].id_short + 1;
  }

  return 1;
}

/**
 * Get a board by short_id
 */
export async function getBoardByShortId(short_id: string) {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('short_id', short_id)
    .single();

  if (error) {
    console.error('Error getting board by short_id:', error);
    return null;
  }

  return data;
}

/**
 * Convert board name to URL-friendly slug (supports Japanese)
 */
export function slugifyBoardName(name: string): string {
  return toSlugBase(name);
}
