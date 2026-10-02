// Exclui a conta do cliente e, em cascata, perfil, dados e registros de assinatura.
// (O hash em trial_claims é mantido para impedir um novo teste grátis.)
import { adminClient, cors, json, userFromRequest } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { error } = await adminClient().auth.admin.deleteUser(user.id);
  if (error) { console.error(error); return json({ error: 'internal' }, 500); }
  return json({ ok: true });
});
