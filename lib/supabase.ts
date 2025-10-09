import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

export const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

// Client factory function for use in components
export function createClient() {
  return createSupabaseClient(supabaseUrl!, supabaseAnonKey!);
}

// Database types
export interface Card {
  id: string;
  title: string;
  description: string;
  list_id: string;
  position: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface List {
  id: string;
  title: string;
  position: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardData {
  lists: List[];
  cards: Card[];
}
