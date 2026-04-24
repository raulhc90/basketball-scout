// api/toggle-ban.js — bloqueia ou desbloqueia um usuário (só ADM)
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) return res.status(403).json({ error: 'Not admin' });

  const { userId, ban } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  // Não deixa o ADM banir a si mesmo
  if (userId === user.id) return res.status(400).json({ error: 'Você não pode bloquear sua própria conta' });

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    ban_duration: ban ? '876000h' : 'none', // ~100 anos = bloqueado permanentemente
  });

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ success: true });
}
