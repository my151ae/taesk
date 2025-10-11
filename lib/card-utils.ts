import { supabase } from './supabase';
import { toSlugBase } from './slug';

// Base62 character set (0-9a-zA-Z)
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generate a random Base62 short ID (8 characters)
 */
export function generateShortId(): string {
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += BASE62[Math.floor(Math.random() * 62)];
  }
  return result;
}

/**
 * Check if a short_id already exists in the database
 */
async function cardExistsByShortId(shortId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('cards')
    .select('id')
    .eq('short_id', shortId)
    .limit(1);

  if (error) {
    console.error('Error checking short_id:', error);
    return false;
  }

  return data && data.length > 0;
}

/**
 * Generate a unique short_id with collision checking
 */
export async function createUniqueShortId(): Promise<string> {
  let shortId = generateShortId();
  let attempts = 0;
  const maxAttempts = 10;

  while (await cardExistsByShortId(shortId) && attempts < maxAttempts) {
    shortId = generateShortId();
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique short_id after maximum attempts');
  }

  return shortId;
}

/**
 * Get the next id_short (board-scoped sequential number)
 */
export async function getNextIdShort(boardId: string): Promise<number> {
  const { data, error } = await supabase
    .from('cards')
    .select('id_short')
    .eq('board_id', boardId)
    .order('id_short', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error getting next id_short:', error);
    return 1;
  }

  if (data && data.length > 0 && data[0].id_short !== null) {
    return data[0].id_short + 1;
  }

  return 1;
}

/**
 * Convert a string to URL-friendly slug (supports Japanese)
 */
export function slugify(title: string): string {
  return toSlugBase(title);
}
