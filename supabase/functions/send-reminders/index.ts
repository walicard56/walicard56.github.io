// Envia notificações de contas a vencer (hoje e amanhã) para quem ativou os lembretes.
// Chamada uma vez por dia pelo pg_cron (veja supabase/cron-lembretes.sql).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:seu@email), CRON_SECRET
// Para testar só uma conta: POST com {"user_id": "..."} e o mesmo cabeçalho x-cron-secret.
import webpush from 'npm:web-push@3.6.7';
import { adminClient, cors, json } from '../_shared/common.ts';
import { buildMessage } from './message.ts';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:suporte@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!Deno.env.get('CRON_SECRET') || req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'forbidden' }, 403);
  const admin = adminClient();
  const body = await req.json().catch(() => ({}));

  let q = admin.from('push_subscriptions').select('endpoint,user_id,p256dh,auth,tz');
  if (body.user_id) q = q.eq('user_id', body.user_id);
  const { data: subs, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const states = new Map<string, unknown>();
  let sent = 0, removed = 0;
  for (const s of subs ?? []) {
    if (!states.has(s.user_id)) {
      const { data } = await admin.from('user_data').select('state').eq('user_id', s.user_id).maybeSingle();
      states.set(s.user_id, data?.state ?? null);
    }
    const state = states.get(s.user_id) as Parameters<typeof buildMessage>[0] | null;
    if (!state) continue;
    const msg = buildMessage(state, s.tz || 'America/Sao_Paulo');
    if (!msg) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 12 * 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint); removed++; }
      else console.error('push', code, e);
    }
  }
  return json({ ok: true, sent, removed });
});
