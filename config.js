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
  GOOGLE_CLIENT_ID: '',

  // Supabase (banco de dados dos clientes): Project Settings > API.
  // URL do projeto, ex.: 'https://abcdefgh.supabase.co'
  SUPABASE_URL: '',
  // Chave pública "anon" / "publishable" (pode ficar no site; NUNCA use a service_role aqui).
  SUPABASE_ANON_KEY: '',

  // Dias de uso grátis contados a partir do primeiro login.
  TRIAL_DAYS: 7,

  // Texto do preço exibido antes de a Play Store informar o preço oficial.
  PRICE_LABEL: 'R$ 9,99/mês',

  // ID do produto de assinatura criado no Play Console (Monetizar > Assinaturas).
  PLAY_SKU: 'folego_premium_mensal',

  // Nome do pacote Android gerado no PWABuilder (ex.: io.github.walicard56.twa).
  PLAY_PACKAGE: 'io.github.walicard56.twa',

  // Estatísticas de uso anônimas e erros (opcional): crie um projeto grátis em
  // https://posthog.com e cole a "Project API key" (começa com phc_).
  POSTHOG_KEY: '',
  POSTHOG_HOST: 'https://us.i.posthog.com'
};
