// Lumi — assistente financeira com IA (Claude). Só para quem tem Premium (teste ou assinatura).
// Secrets: ANTHROPIC_API_KEY. Opcionais: LUMI_DAILY_LIMIT (padrão 15), TRIAL_DAYS (padrão 7).
import Anthropic from 'npm:@anthropic-ai/sdk@^0.131.0';
import { adminClient, cors, json, userFromRequest } from '../_shared/common.ts';
import { SYSTEM_PROMPT, buildUserTurn, cleanHistory } from './prompt.ts';

const client = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente
const DAILY_LIMIT = +(Deno.env.get('LUMI_DAILY_LIMIT') ?? 15);
const TRIAL_DAYS = +(Deno.env.get('TRIAL_DAYS') ?? 7);
const DAY = 864e5;

async function hasPremium(admin: ReturnType<typeof adminClient>, userId: string): Promise<boolean> {
  const { data: sub } = await admin.from('subscriptions').select('expires_at')
    .eq('user_id', userId).gt('expires_at', new Date().toISOString()).limit(1);
  if (sub && sub.length) return true;
  const { data: prof } = await admin.from('profiles').select('trial_started_at').eq('id', userId).maybeSingle();
  return !!prof && Date.parse(prof.trial_started_at) + TRIAL_DAYS * DAY > Date.now();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = await userFromRequest(req);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const admin = adminClient();
    if (!(await hasPremium(admin, user.id))) return json({ error: 'premium_required' }, 402);

    const body = await req.json().catch(() => ({}));
    const question = String(body.question ?? '').trim().slice(0, 600);
    if (!question) return json({ error: 'empty' }, 400);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const { data: used, error: bumpErr } = await admin.rpc('ai_usage_bump', { p_user: user.id, p_day: today });
    if (bumpErr) throw bumpErr;
    if ((used as number) > DAILY_LIMIT) return json({ error: 'limit', limit: DAILY_LIMIT }, 429);

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...cleanHistory(body.history),
      { role: 'user', content: buildUserTurn(question, body.summary) },
    ];
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return json({ reply: 'Não consigo ajudar com isso. Posso falar sobre seus gastos, reserva, dívidas ou planejamento do mês. 💜', remaining: Math.max(0, DAILY_LIMIT - (used as number)) });
    }
    const reply = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text).join('\n').trim();
    return json({ reply: reply || 'Hmm, não consegui pensar numa resposta agora. Tenta perguntar de outro jeito?', remaining: Math.max(0, DAILY_LIMIT - (used as number)) });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'busy' }, 503);
    if (e instanceof Anthropic.APIError) { console.error('anthropic', e.status, e.message); return json({ error: 'ai_unavailable' }, 502); }
    console.error(e);
    return json({ error: 'internal' }, 500);
  }
});
