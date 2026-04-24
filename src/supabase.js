import { createClient } from '@supabase/supabase-js';

// ─── CREDENCIAIS ─────────────────────────────────────────────────────────────
// Opção 1 (recomendada): variáveis de ambiente do Vercel
//   No Vercel → Settings → Environment Variables, adicione:
//   REACT_APP_SUPABASE_URL  = https://SEU_PROJETO.supabase.co
//   REACT_APP_SUPABASE_ANON_KEY = eyJ...sua chave anon...
//
// Opção 2 (simples): cole diretamente abaixo
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://SEU_PROJETO.supabase.co';
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJSUA_CHAVE_AQUI';
// ─────────────────────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'wf-scout-auth',
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
  const { error } = await supabase.from('games').delete().eq('id', gameId);
  if (error) console.error('deleteGame error:', error.message);
}

// ── Teams CRUD ────────────────────────────────────────────────────────────────
export async function fetchTeams(userId) {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, players')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) {
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

export async function deleteTeam(teamId) {
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) console.error('deleteTeam error:', error.message);
}

// ── Admin API (via Vercel Serverless Functions) ───────────────────────────────
async function adminFetch(endpoint, method = 'GET', body = null) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sem sessão ativa');

  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(`/api/${endpoint}`, opts);
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || 'Erro desconhecido');
  return json;
}

export const adminListUsers     = ()             => adminFetch('list-users');
export const adminInviteUser    = (email)        => adminFetch('invite-user',    'POST', { email });
export const adminResetPassword = (email)        => adminFetch('reset-password', 'POST', { email });
export const adminToggleBan     = (userId, ban)  => adminFetch('toggle-ban',     'POST', { userId, ban });
