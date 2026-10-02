// Simuladores do Google Sign-In, Supabase e Google Play usados nos testes.
const CID = 'test.apps.googleusercontent.com';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = 'h.' + b64({ aud: CID, sub: '123', email: 'ana@example.com', name: 'Ana Souza' }) + '.s';

const gsiStub = `window.google={accounts:{id:{initialize(o){this.cb=o.callback},prompt(){},disableAutoSelect(){},
 renderButton(el){const b=document.createElement('button');b.id='fakeG';b.textContent='Entrar (teste)';
 b.onclick=()=>google.accounts.id.cb({credential:'${jwt}'});el.append(b);}}}};`;

const supabaseStub = `window.supabase={createClient(){
  const db=(op,a)=>window.mockDb(op,a);
  const sess=()=>JSON.parse(localStorage.getItem('folego-auth')||'null');
  function q(table){const st={table,filters:{}};const b={
    select(){return b},eq(k,v){st.filters[k]=v;return b},order(){return b},limit(){st.list=true;return b},
    upsert(row){st.upsert=row;return b},insert(row){st.insert=row;return b},delete(){st.del=true;return b},
    maybeSingle(){return b},single(){return b},
    then(res,rej){return db('q',st).then(res,rej)}};return b;}
  return {auth:{getSession:async()=>({data:{session:sess()}}),
     signInWithIdToken:async()=>{const u={id:'u1',email:'ana@example.com',user_metadata:{full_name:'Ana Souza',avatar_url:''}};
       await db('newuser',u.id);localStorage.setItem('folego-auth',JSON.stringify({user:u}));return{data:{user:u},error:null}},
     signOut:async()=>{localStorage.removeItem('folego-auth')}},
   from:q, functions:{invoke:async(n,o)=>({data:await db('fn',{n,body:o.body}),error:null})}};}};`;

/** Banco "do servidor" compartilhado entre os celulares de um teste. */
function createServer() {
  const DB = { profiles: {}, user_data: {}, subscriptions: {}, feedback: [], push_subscriptions: {} };
  const server = {
    DB, trialAgoDays: 0, premiumUntil: null, functionCalls: [], fnHandlers: {},
    async handle(op, a) {
      if (op === 'newuser') {
        if (!DB.profiles[a]) DB.profiles[a] = { trial_started_at: new Date(Date.now() - server.trialAgoDays * 864e5).toISOString() };
        return;
      }
      if (op === 'fn') {
        server.functionCalls.push(a);
        if (server.fnHandlers[a.n]) return server.fnHandlers[a.n](a.body);
        if (a.n === 'delete-account') { DB.user_data = {}; DB.profiles = {}; return { ok: true }; }
        if (a.n === 'verify-purchase') return { expires_at: server.premiumUntil };
        return {};
      }
      const t = DB[a.table];
      if (a.insert) { if (Array.isArray(t)) t.push(a.insert); return { data: null, error: null }; }
      if (a.upsert) {
        const row = { ...a.upsert, updated_at: new Date().toISOString() };
        t[row.user_id || row.endpoint] = row;
        return { data: { updated_at: row.updated_at }, error: null };
      }
      if (a.del) { const id = a.filters.endpoint || a.filters.user_id; delete t[id]; return { data: null, error: null }; }
      const id = a.filters.id || a.filters.user_id;
      if (a.list) return { data: [], error: null };
      return { data: t[id] || null, error: null };
    },
  };
  return server;
}

/**
 * Prepara uma página. configured=false => "modo livre" (sem login).
 * billing=true simula o app instalado pela Play Store (Digital Goods API).
 */
async function setupPage(page, { server, configured = true, billing = false, config = {} } = {}) {
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.route(/posthog\.com/, (r) => r.fulfill({ status: 200, body: '{}' }));
  const cfg = configured
    ? { GOOGLE_CLIENT_ID: CID, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', TRIAL_DAYS: 7,
        PLAY_SKU: 'folego_premium_mensal', PLAY_SKU_ANUAL: 'folego_premium_anual', PLAY_PACKAGE: 'io.github.walicard56.twa', ...config }
    : { GOOGLE_CLIENT_ID: '', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', ...config };
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.FOLEGO_CONFIG=' + JSON.stringify(cfg) + ';' }));
  await page.route('https://accounts.google.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: gsiStub }));
  await page.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: supabaseStub }));
  if (server) await page.exposeFunction('mockDb', (op, a) => server.handle(op, a));
  if (billing) {
    await page.addInitScript(() => {
      window.__purchases = [];
      window.getDigitalGoodsService = async () => ({
        getDetails: async (skus) => skus.map((sku) => ({ itemId: sku, price: { currency: 'BRL', value: sku.includes('anual') ? '79.90' : '9.99' } })),
        listPurchases: async () => window.__purchases,
      });
      window.PaymentRequest = class {
        constructor(methods) { this.sku = methods[0].data.sku; }
        async show() { window.__purchases.push({ itemId: this.sku, purchaseToken: 'tok-' + this.sku }); return { details: { purchaseToken: 'tok-' + this.sku }, complete: async () => {} }; }
      };
    });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  return errors;
}

module.exports = { createServer, setupPage };
