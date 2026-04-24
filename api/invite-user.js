// api/invite-user.js — Convida usuário por e-mail (só ADM)
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Não autorizado' });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) return res.status(403).json({ error: 'Acesso negado' });

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });

    // Convida o usuário — Supabase envia e-mail com link para definir senha
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.REACT_APP_SITE_URL || 'https://basketball-scout.vercel.app'}/`,
    });

    if (error) throw error;

    // Cria perfil vazio para o novo usuário
    await supabaseAdmin
      .from('profiles')
      .upsert({ id: data.user.id, is_admin: false })
      .catch(() => {});

    return res.status(200).json({ success: true, userId: data.user.id });
  } catch (e) {
    console.error('invite-user error:', e);
    // Erro comum: usuário já existe
    if (e.message?.includes('already been registered')) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    }
    return res.status(500).json({ error: e.message });
  }
}
