// Valida assinaturas na Google Play Developer API e grava em public.subscriptions.
// Secrets necessários (Supabase > Edge Functions > Secrets):
//   GOOGLE_SERVICE_ACCOUNT  JSON completo da conta de serviço com acesso ao Play Console
//   PLAY_PACKAGE            ex.: io.github.walicard56.twa
//   PLAY_SKU                ex.: folego_premium_mensal
import { adminClient, cors, json, userFromRequest } from '../_shared/common.ts';

const PKG = Deno.env.get('PLAY_PACKAGE') ?? '';
const SKU = Deno.env.get('PLAY_SKU') ?? '';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' + encodeURIComponent(PKG);
const ACTIVE_STATES = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED'];
const DAY = 864e5;

const b64url = (data: ArrayBuffer | string) =>
  btoa(typeof data === 'string' ? data : String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cachedToken: { value: string; exp: number } | null = null;

/** Token OAuth da conta de serviço (JWT assinado com RS256). */
async function googleAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.exp - 60e3) return cachedToken.value;
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT') ?? '{}');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(header + '.' + claims));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: header + '.' + claims + '.' + b64url(sig),
    }),
  });
  if (!res.ok) throw new Error('google auth ' + res.status);
  const body = await res.json();
  cachedToken = { value: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = await userFromRequest(req);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const admin = adminClient();

    const body = await req.json().catch(() => ({}));
    const given: string[] = (Array.isArray(body.purchaseTokens) ? body.purchaseTokens : [])
      .filter((t: unknown) => typeof t === 'string' && t.length > 0 && t.length < 1000).slice(0, 5);
    const { data: stored } = await admin.from('subscriptions').select('purchase_token')
      .eq('user_id', user.id).gt('expires_at', new Date(Date.now() - 60 * DAY).toISOString());
    const tokens = [...new Set([...given, ...(stored ?? []).map((r) => r.purchase_token as string)])];
    if (!tokens.length) return json({ expires_at: null });

    const gtoken = await googleAccessToken();
    const auth = { Authorization: 'Bearer ' + gtoken };
    let best = 0;
    for (const token of tokens) {
      const r = await fetch(API + '/purchases/subscriptionsv2/tokens/' + encodeURIComponent(token), { headers: auth });
      if (!r.ok) continue;
      const sub = await r.json();
      const item = (sub.lineItems ?? []).find((li: { productId: string }) => li.productId === SKU);
      if (!item) continue;

      // Uma compra pertence a uma única conta do Fôlego.
      const { data: owner } = await admin.from('subscriptions').select('user_id').eq('purchase_token', token).maybeSingle();
      if (owner && owner.user_id !== user.id) continue;

      const expiry = Date.parse(item.expiryTime ?? '') || 0;
      const expiresAt = ACTIVE_STATES.includes(sub.subscriptionState) ? expiry : Math.min(expiry, Date.now());
      await admin.from('subscriptions').upsert({
        purchase_token: token, user_id: user.id, product_id: item.productId,
        status: sub.subscriptionState, expires_at: new Date(expiresAt).toISOString(), updated_at: new Date().toISOString(),
      });

      // Sem confirmação em 3 dias, a Google Play reembolsa a compra.
      if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
        await fetch(API + '/purchases/subscriptions/' + encodeURIComponent(item.productId) + '/tokens/' + encodeURIComponent(token) + ':acknowledge', {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}',
        });
      }
      best = Math.max(best, expiresAt);
    }
    return json({ expires_at: best ? new Date(best).toISOString() : null });
  } catch (e) {
    console.error(e);
    return json({ error: 'internal' }, 500);
  }
});
