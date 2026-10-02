/*
 * CONFIGURAÇÃO DO FÔLEGO — edite só este arquivo.
 * Veja o passo a passo completo no LEIA-ME.txt.
 *
 * Enquanto GOOGLE_CLIENT_ID estiver vazio, o app funciona em "modo livre":
 * sem login, sem teste grátis e sem cobrança (útil para testar o visual).
 */
window.FOLEGO_CONFIG = {
  // ID do cliente OAuth (tipo "Aplicativo da Web") criado no Google Cloud Console.
  // Ex.: '1234567890-abc123.apps.googleusercontent.com'
  GOOGLE_CLIENT_ID: '',

  // Dias de uso grátis contados a partir do primeiro login.
  TRIAL_DAYS: 7,

  // Texto do preço exibido antes de a Play Store informar o preço oficial.
  PRICE_LABEL: 'R$ 9,99/mês',

  // ID do produto de assinatura criado no Play Console (Monetizar > Assinaturas).
  PLAY_SKU: 'folego_premium_mensal',

  // Nome do pacote Android gerado no PWABuilder (ex.: io.github.walicard56.twa).
  PLAY_PACKAGE: 'io.github.walicard56.twa',

  // Backup dos dados na pasta oculta do Google Drive do próprio usuário.
  DRIVE_BACKUP: true
};
