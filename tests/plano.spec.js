// Entrada no app: login obrigatório, escolha do plano, teste de 7 dias, fim do teste e assinatura.
const { test, expect } = require('@playwright/test');
const { createServer, setupPage, entrar } = require('./helpers');

async function abrir(page, opts = {}) {
  const server = opts.server || createServer();
  page.errors = await setupPage(page, { server, ...opts });
  await page.goto('/');
  return server;
}
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

test('abre com login obrigatório; depois pergunta o plano; depois configura', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#gate')).toBeVisible();
  await expect(page.locator('#gate')).toContainText('7 dias de Premium grátis');
  await expect(page.locator('#setupSheet')).not.toHaveClass(/open/);
  await page.click('#gsiGate #fakeG');
  await expect(page.locator('#gate')).toContainText('Como você quer usar o Fôlego?');
  await expect(page.locator('#chooseSub')).toContainText('Premium');
  await expect(page.locator('#chooseFree')).toContainText('7 dias de Premium de presente');
  await page.click('#chooseFree');
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#setupSheet')).toHaveClass(/open/);
  await expect(page.locator('#sLogin')).toBeHidden();
});

test('básico grátis começa com o Premium de teste', async ({ page }) => {
  await abrir(page);
  await entrar(page);
  await expect(page.locator('#trialBanner')).toContainText('7 dias');
  await page.click('nav [data-tab=hist]');
  await expect(page.locator('#view-hist')).toHaveClass(/active/);
});

test('a escolha do plano aparece só uma vez', async ({ page }) => {
  await abrir(page);
  await entrar(page);
  await page.reload();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#setupSheet')).not.toHaveClass(/open/);
});

test('teste acabou: básico grátis sem bloqueio e Premium pede assinatura', async ({ page }) => {
  const server = createServer();
  server.trialAgoDays = 10;
  await abrir(page, { server });
  await page.click('#gsiGate #fakeG');
  await expect(page.locator('#chooseFree')).toContainText('Grátis para sempre');
  await page.click('#chooseFree');
  await page.fill('#sSalario', '3000');
  await page.click('#sGo');
  await expect(page.locator('#trialBanner')).toContainText('teste Premium acabou');
  await page.click('#fab');
  await page.fill('#qVal', '10');
  await page.click('#qSave');
  await expect(page.locator('#sobraTotal')).toHaveText('R$ 2.990');
  await page.click('nav [data-tab=hist]');
  await expect(page.locator('#paywall .plan-opt')).toHaveCount(2);
});

test('grátis permite 1 dívida; a 2ª pede Premium', async ({ page }) => {
  const server = createServer();
  server.trialAgoDays = 10;
  await abrir(page, { server });
  await entrar(page);
  await page.click('nav [data-tab=dividas]');
  await page.click('[data-add=divida]');
  await expect(page.locator('.debt')).toHaveCount(1);
  await page.click('[data-add=divida]');
  await expect(page.locator('#paywall')).toHaveClass(/open/);
  await expect(page.locator('.debt')).toHaveCount(1);
});

test('escolher Premium e assinar o anual pela Play Store; depois configura', async ({ page }) => {
  const server = createServer();
  server.fnHandlers['verify-purchase'] = (body) => body.purchaseTokens.length
    ? { expires_at: new Date(Date.now() + 365 * 864e5).toISOString(), product_id: 'folego_premium_anual' }
    : { expires_at: null, product_id: null };
  await abrir(page, { server, billing: true });
  await entrar(page, { plano: 'assinar' });
  await expect(page.locator('#paywall')).toHaveClass(/open/);
  await expect(page.locator('#paywall')).toContainText('R$ 79,90');
  await expect(page.locator('#paywall .save')).toContainText('-33%');
  await page.click('#pwSub');
  await expect(page.locator('#setupSheet')).toHaveClass(/open/);
  await page.fill('#sSalario', '3000');
  await page.click('#sGo');
  await page.click('#userBtn');
  await expect(page.locator('#acctBox')).toContainText('Fôlego Premium');
  await expect(page.locator('#acctBox')).toContainText('plano anual');
});

test('pedido de avaliação aparece em momento feliz e envia feedback', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('folego-prefs', JSON.stringify({ days: 5, lastDay: '2000-01-01', theme: 'auto', haptic: true })));
  await abrir(page);
  await entrar(page);
  await page.click('nav [data-tab=dividas]');
  await page.click('[data-add=divida]');
  await page.locator('.debt .field input').nth(1).fill('1');
  await page.click('.paybtn');
  await expect(page.locator('#reviewSheet')).toHaveClass(/open/, { timeout: 5000 });
  await page.click('#rvMeh');
  await page.fill('#rvText', 'Quero categorias');
  await page.click('#rvSend');
  await expect(page.locator('#toast')).toContainText('Obrigado');
});

test('fora da Play Store e antes da publicação, assinar não abre página inexistente', async ({ page }) => {
  await abrir(page);
  await entrar(page);
  await page.click('#userBtn');
  await page.click('#aSub');
  await expect(page.locator('#pwSub')).toHaveText('Assinatura em breve na Google Play');
  await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
  await page.click('#pwSub');
  expect(await page.evaluate(() => window.__opened)).toEqual([]);
  await expect(page.locator('#toast')).toContainText('chega junto com o app na Google Play');
});

test('com a loja publicada, assinar pelo navegador abre a página do app', async ({ page }) => {
  await abrir(page, { config: { PLAY_STORE_LIVE: true } });
  await entrar(page);
  await page.click('#userBtn');
  await page.click('#aSub');
  await expect(page.locator('#pwSub')).toHaveText('Assinar pelo app na Google Play');
  await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
  await page.click('#pwSub');
  expect(await page.evaluate(() => window.__opened)).toEqual(['https://play.google.com/store/apps/details?id=app.folego.financas']);
});
