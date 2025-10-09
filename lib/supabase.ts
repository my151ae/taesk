import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database types
export interface Card {
  id: string;
  title: string;
  description: string;
  list_id: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface List {
  id: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface BoardData {
  lists: List[];
  cards: Card[];
}
