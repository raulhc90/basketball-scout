// api/list-users.js — Lista todos os usuários (só ADM)
// Roda no servidor Vercel — usa Service Role Key com segurança
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  // Só aceita GET
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verificar token do usuário que fez a requisição
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Não autorizado' });

    // Validar o token e verificar se é admin
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

    // Verificar se é admin
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) return res.status(403).json({ error: 'Acesso negado' });

    // Buscar todos os usuários
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw error;

    // Buscar perfis
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, name, is_admin');

    const profileMap = (profiles || []).reduce((acc, p) => ({ ...acc, [p.id]: p }), {});

    // Montar resposta
    const result = users.map(u => ({
      id: u.id,
      email: u.email,
      name: profileMap[u.id]?.name || '',
      is_admin: profileMap[u.id]?.is_admin || false,
      last_sign_in: u.last_sign_in_at,
      created_at: u.created_at,
      confirmed: !!u.email_confirmed_at,
      banned: u.banned_until ? new Date(u.banned_until) > new Date() : false,
    }));

    return res.status(200).json({ users: result });
  } catch (e) {
    console.error('list-users error:', e);
    return res.status(500).json({ error: e.message });
  }
}
