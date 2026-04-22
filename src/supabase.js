import { createClient } from '@supabase/supabase-js';

// ─── SUBSTITUA AQUI ──────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://tpgkhtayyfnntxilwcvu.supabase.co';   // ← cole sua Project URL
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZ2todGF5eWZubnR4aWx3Y3Z1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTk5MjcsImV4cCI6MjA5MjM3NTkyN30.dTgmf2rUTzS1tThFQszgrLmguDAfo-WofkPYq5fbFrw';                 // ← cole sua anon public key
// ─────────────────────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Auth helpers ──────────────────────────────────────────────────────────────
export const signUp   = (email, pass) => supabase.auth.signUp({ email, password: pass });
export const signIn   = (email, pass) => supabase.auth.signInWithPassword({ email, password: pass });
export const signOut  = ()            => supabase.auth.signOut();
export const getUser  = ()            => supabase.auth.getUser();
export const onAuthChange = (cb)      => supabase.auth.onAuthStateChange(cb);

// ── Games CRUD ────────────────────────────────────────────────────────────────
export async function fetchGames(userId) {
  const { data, error } = await supabase
    .from('games')
    .select('id, name, date, data')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  // Cada row tem { id, name, date, data } — data é o objeto game completo
  return data.map(row => ({ ...row.data, id: row.id }));
}

export async function upsertGame(game, userId) {
  const { error } = await supabase
    .from('games')
    .upsert({
      id: game.id,
      user_id: userId,
      name: `${game.teams[0].name} vs ${game.teams[1].name}`,
      date: game.date,
      data: game,
    }, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteGame(gameId) {
  const { error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId);
  if (error) throw error;
}
