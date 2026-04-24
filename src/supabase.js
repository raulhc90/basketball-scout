import { createClient } from '@supabase/supabase-js';

// ─── SUBSTITUA AQUI ──────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://tpgkhtayyfnntxilwcvu.supabase.co';   // ← cole sua Project URL
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZ2todGF5eWZubnR4aWx3Y3Z1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTk5MjcsImV4cCI6MjA5MjM3NTkyN30.dTgmf2rUTzS1tThFQszgrLmguDAfo-WofkPYq5fbFrw';                 // ← cole sua anon public key
// ─────────────────────────────────────────────────────────────────────────────

// Cria o cliente com persistência de sessão explícita
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,        // salva sessão no localStorage
    autoRefreshToken: true,      // renova o token automaticamente
    detectSessionInUrl: false,   // não tenta ler token da URL
    storageKey: 'wf-scout-auth', // chave única no localStorage
  }
});

// ── Auth helpers ──────────────────────────────────────────────────────────────
export const signUp       = (email, pass) => supabase.auth.signUp({ email, password: pass });
export const signIn       = (email, pass) => supabase.auth.signInWithPassword({ email, password: pass });
export const signOut      = ()            => supabase.auth.signOut();
export const getUser      = ()            => supabase.auth.getUser();
export const onAuthChange = (cb)          => supabase.auth.onAuthStateChange(cb);

// ── Games CRUD ────────────────────────────────────────────────────────────────
export async function fetchGames(userId) {
  const { data, error } = await supabase
    .from('games')
    .select('id, name, date, data')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('fetchGames error:', error.message, error.code);
    throw error;
  }
  return data.map(row => ({ ...row.data, id: row.id }));
}

export async function upsertGame(game, userId) {
  // Verifica sessão antes de tentar salvar
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    console.warn('upsertGame: sem sessão ativa, pulando sync');
    return;
  }

  const { error } = await supabase
    .from('games')
    .upsert({
      id: game.id,
      user_id: userId,
      name: `${game.teams[0].name} vs ${game.teams[1].name}`,
      date: game.gameDate || game.date,
      data: game,
    }, { onConflict: 'id' });

  if (error) {
    console.error('upsertGame error:', error.message, error.code);
    throw error;
  }
}

export async function deleteGame(gameId) {
  const { error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId);
  if (error) {
    console.error('deleteGame error:', error.message);
    throw error;
  }
}

// ── Teams CRUD ────────────────────────────────────────────────────────────────
export async function fetchTeams(userId) {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, players')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) {
    // Tabela pode não existir ainda — retorna vazio sem quebrar
    console.warn('fetchTeams:', error.message);
    return [];
  }
  return data;
}

export async function upsertTeam(team, userId) {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;
  const { error } = await supabase
    .from('teams')
    .upsert({
      id: team.id,
      user_id: userId,
      name: team.name,
      players: team.players,
    }, { onConflict: 'id' });
  if (error) console.error('upsertTeam error:', error.message);
}

// ── Admin API calls (via Vercel Serverless) ──────────────────────────────────
async function adminFetch(endpoint, method='GET', body=null) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sem sessão ativa');

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(`/api/${endpoint}`, opts);
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || 'Erro na API');
  return json;
}

export const adminListUsers    = ()               => adminFetch('list-users');
export const adminInviteUser   = (email)          => adminFetch('invite-user', 'POST', { email });
export const adminResetPass    = (email)          => adminFetch('reset-password', 'POST', { email });
export const adminToggleBan    = (targetUserId, ban) => adminFetch('toggle-ban', 'POST', { targetUserId, ban });

// Verificar se o usuário atual é admin
export async function checkIsAdmin(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single();
  return data?.is_admin === true;
}

export async function deleteTeam(teamId) {
  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', teamId);
  if (error) console.error('deleteTeam error:', error.message);
}
