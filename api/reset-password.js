// api/reset-password.js — Envia e-mail de reset de senha (só ADM)
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

    // Envia e-mail de redefinição de senha
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.REACT_APP_SITE_URL || 'https://basketball-scout.vercel.app'}/`,
    });

    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('reset-password error:', e);
    return res.status(500).json({ error: e.message });
  }
}
