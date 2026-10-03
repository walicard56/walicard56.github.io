/*
 * CONFIGURAÇÃO DO FÔLEGO — edite só este arquivo.
 * Veja o passo a passo completo no LEIA-ME.txt.
 *
 * Enquanto GOOGLE_CLIENT_ID, SUPABASE_URL e SUPABASE_ANON_KEY não estiverem
 * todos preenchidos, o app funciona em "modo livre": sem login, sem teste
 * grátis e sem cobrança (útil para testar o visual).
 */
window.FOLEGO_CONFIG = {
  // ID do cliente OAuth (tipo "Aplicativo da Web") criado no Google Cloud Console.
  // Ex.: '1234567890-abc123.apps.googleusercontent.com'
  GOOGLE_CLIENT_ID: '1070702517503-tg7q8ntbbom2sbq8j5b64n4tou1lkii0.apps.googleusercontent.com',

  // Supabase (banco de dados dos clientes): Project Settings > API.
  // URL do projeto, ex.: 'https://abcdefgh.supabase.co'
  SUPABASE_URL: 'https://xydjjgkttnteusedtynj.supabase.co',
  // Chave pública "anon" / "publishable" (pode ficar no site; NUNCA use a service_role aqui).
  SUPABASE_ANON_KEY: 'sb_publishable_a9RiaatHaT36YPNCifDftw_QpR5WVfK',

  // Dias de uso grátis contados a partir do primeiro login.
  TRIAL_DAYS: 7,

  // Preços exibidos antes de a Play Store informar os preços oficiais.
  PRICE_LABEL: 'R$ 9,99',
  PRICE_LABEL_ANUAL: 'R$ 79,90',

  // IDs das assinaturas criadas no Play Console (Monetizar > Assinaturas).
  PLAY_SKU: 'folego_premium_mensal',
  PLAY_SKU_ANUAL: 'folego_premium_anual',

  // Nome do pacote Android gerado no PWABuilder (ex.: io.github.walicard56.twa).
  PLAY_PACKAGE: 'io.github.walicard56.twa',

  // Mude para true quando o app estiver publicado na Google Play. Antes disso,
  // os botões de assinar/avaliar não abrem a loja (a página ainda não existe).
  PLAY_STORE_LIVE: false,

  // Lembretes por notificação: chave pública VAPID (veja o LEIA-ME, Passo 5C).
  VAPID_PUBLIC_KEY: '',

  // Anúncios para o plano grátis (Google AdSense). Deixe vazio para não mostrar.
  // ADSENSE_CLIENT: 'ca-pub-0000000000000000'  |  ADSENSE_SLOT: '1234567890'
  ADSENSE_CLIENT: 'ca-pub-2779913625636856',
  ADSENSE_SLOT: '',

  // Estatísticas de uso anônimas e erros (opcional): crie um projeto grátis em
  // https://posthog.com e cole a "Project API key" (começa com phc_).
  POSTHOG_KEY: '',
  POSTHOG_HOST: 'https://us.i.posthog.com'
};
