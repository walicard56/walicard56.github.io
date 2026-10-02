// Freemium: o que é grátis, teste de 7 dias, fim do teste e assinatura.
const { test, expect } = require('@playwright/test');
const { createServer, setupPage } = require('./helpers');

async function start(page, opts = {}) {
  const server = opts.server || createServer();
  page.errors = await setupPage(page, { server, ...opts });
  await page.goto('/');
  await page.fill('#sSalario', '3000');
  await page.click('#sGo');
  return server;
}
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

test('sem conta: app funciona e histórico abre a oferta de teste grátis', async ({ page }) => {
  await start(page);
  await page.click('nav [data-tab=hist]');
  await expect(page.locator('#paywall')).toHaveClass(/open/);
  await expect(page.locator('#paywall')).toContainText('7 dias de Premium grátis');
  await expect(page.locator('#view-hist')).not.toHaveClass(/active/);
});

test('entrar pela oferta libera o Premium (teste grátis)', async ({ page }) => {
  await start(page);
  await page.click('nav [data-tab=hist]');
  await page.click('#gsiPaywall #fakeG');
  await expect(page.locator('#paywall')).not.toHaveClass(/open/);
  await expect(page.locator('#trialBanner')).toContainText('7 dias');
  await page.click('nav [data-tab=hist]');
  await expect(page.locator('#view-hist')).toHaveClass(/active/);
});

test('teste acabou: volta ao grátis sem bloquear e mostra os planos', async ({ page }) => {
  const server = createServer();
  server.trialAgoDays = 10;
  await start(page, { server });
  await page.click('#userBtn');
  await page.click('#acctLogin #fakeG');
  await expect(page.locator('#acctBox')).toContainText('Plano grátis');
  await page.click('nav [data-tab=mes]');
  await expect(page.locator('#trialBanner')).toContainText('teste Premium acabou');
  await page.click('#fab');                       // lançar continua livre
  await page.fill('#qVal', '10');
  await page.click('#qSave');
  await expect(page.locator('#sobraTotal')).toHaveText('R$ 2.990');
  await page.click('nav [data-tab=hist]');
  await expect(page.locator('#paywall .plan-opt')).toHaveCount(2);
});

test('grátis permite 1 dívida; a 2ª pede Premium', async ({ page }) => {
  const server = createServer();
  server.trialAgoDays = 10;
  await start(page, { server });
  await page.click('#userBtn');
  await page.click('#acctLogin #fakeG');
  await expect(page.locator('#acctBox')).toContainText('Plano grátis');
  await page.click('nav [data-tab=dividas]');
  await page.click('[data-add=divida]');
  await expect(page.locator('.debt')).toHaveCount(1);
  await page.click('[data-add=divida]');
  await expect(page.locator('#paywall')).toHaveClass(/open/);
  await expect(page.locator('.debt')).toHaveCount(1);
});

test('assinatura anual pela Play Store ativa o Premium', async ({ page }) => {
  const server = createServer();
  server.trialAgoDays = 10;
  server.fnHandlers['verify-purchase'] = (body) => body.purchaseTokens.length
    ? { expires_at: new Date(Date.now() + 365 * 864e5).toISOString(), product_id: 'folego_premium_anual' }
    : { expires_at: null, product_id: null };
  await start(page, { server, billing: true });
  await page.click('#userBtn');
  await page.click('#acctLogin #fakeG');
  await page.click('#aSub');
  await expect(page.locator('#paywall')).toContainText('R$ 79,90');
  await expect(page.locator('#paywall .save')).toContainText('-33%');
  await page.click('#pwSub');
  await expect(page.locator('#acctBox')).toContainText('Fôlego Premium');
  await expect(page.locator('#acctBox')).toContainText('plano anual');
  await page.click('nav [data-tab=hist]');
  await expect(page.locator('#view-hist')).toHaveClass(/active/);
});

test('pedido de avaliação aparece em momento feliz e envia feedback', async ({ page }) => {
  const server = createServer();
  await page.addInitScript(() => localStorage.setItem('folego-prefs', JSON.stringify({ days: 5, lastDay: '2000-01-01', theme: 'auto', haptic: true })));
  await start(page, { server });
  await page.click('nav [data-tab=dividas]');
  await page.click('[data-add=divida]');
  const inputs = page.locator('.debt .field input');
  await inputs.nth(1).fill('1');
  await page.click('.paybtn');
  await expect(page.locator('#reviewSheet')).toHaveClass(/open/, { timeout: 5000 });
  await page.click('#rvMeh');
  await page.fill('#rvText', 'Quero categorias');
  await page.click('#rvSend');
  await expect(page.locator('#toast')).toContainText('Obrigado');
});

test('fora da Play Store e antes da publicação, assinar não abre página inexistente', async ({ page }) => {
  const server = createServer();
  await start(page, { server });
  await page.click('#userBtn');
  await page.click('#acctLogin #fakeG');
  await page.click('#aSub');
  await expect(page.locator('#pwSub')).toHaveText('Assinatura em breve na Google Play');
  const popup = page.waitForEvent('popup', { timeout: 1500 }).then(() => true).catch(() => false);
  await page.click('#pwSub');
  expect(await popup).toBe(false);
  await expect(page.locator('#toast')).toContainText('chega junto com o app na Google Play');
});

test('com a loja publicada, assinar pelo navegador abre a página do app', async ({ page }) => {
  const server = createServer();
  await start(page, { server, config: { PLAY_STORE_LIVE: true } });
  await page.click('#userBtn');
  await page.click('#acctLogin #fakeG');
  await page.click('#aSub');
  await expect(page.locator('#pwSub')).toHaveText('Assinar pelo app na Google Play');
  await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
  await page.click('#pwSub');
  expect(await page.evaluate(() => window.__opened)).toEqual(['https://play.google.com/store/apps/details?id=io.github.walicard56.twa']);
});
