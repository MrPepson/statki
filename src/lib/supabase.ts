import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Brak zmiennych środowiskowych VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY');
}

// Singleton klienta Supabase – jeden egzemplarz na całą aplikację
export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
  },
  realtime: {
    timeout: 20_000,
  },
});

// ── Typy pomocnicze ──────────────────────────────────────────

export type GameStatus = 'waiting' | 'placing' | 'playing' | 'finished';
export type ShotResult = 'miss' | 'hit' | 'sunk';

// Pojedynczy statek zapisany w boards.ships (JSONB)
export interface ShipPlacement {
  ship_def_id:  'carrier' | 'battleship' | 'cruiser' | 'destroyer';
  orientation:  'h' | 'v';
  cells:        [number, number][];   // [[row, col], ...]
  sunk:         boolean;
}
