// Indique e ganhe, cartões de conquista e compartilhamento.
const { test, expect } = require('@playwright/test');
const { createServer, setupPage, entrar } = require('./helpers');

test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

test('link de convite: mostra o presente, aplica +7 dias e limpa a URL', async ({ page }) => {
  const server = createServer();
  page.errors = await setupPage(page, { server });
  await page.goto('/?ref=amigo7');
  await expect(page.locator('#gate .gift')).toContainText('14 dias de Premium');
  expect(new URL(page.url()).search).toBe('');
  await page.click('#gsiGate #fakeG');
  await expect(page.locator('#chooseFree')).toContainText('14 dias de Premium de presente');
  expect(server.rpcCalls.find((c) => c.name === 'claim_referral').args.p_code).toBe('AMIGO7');
  await page.click('#chooseFree');
  await page.click('#sGo');
  await expect(page.locator('#trialBanner')).toContainText('14 dias');
});

test('Indique e ganhe: código e convite pronto para o WhatsApp', async ({ page }) => {
  const server = createServer();
  server.DB.referrals.push({ referred_id: 'x' }, { referred_id: 'y' });
  page.errors = await setupPage(page, { server });
  await page.goto('/');
  await entrar(page);
  await page.click('#userBtn');
  await expect(page.locator('#invCode')).toHaveText('ANA123');
  await expect(page.locator('#invCount')).toContainText('2 amigos entraram');
  const href = await page.locator('#invWa').getAttribute('href');
  expect(decodeURIComponent(href)).toContain('https://walicard56.github.io/?ref=ANA123');
  expect(decodeURIComponent(href)).toContain('7 dias de Premium');
});

test('mês no azul vira um cartão para stories, sem valores por padrão', async ({ page }) => {
  page.errors = await setupPage(page, { server: createServer() });
  await page.goto('/');
  await entrar(page, { salario: '3000' });
  await page.click('#shareMonth');
  await expect(page.locator('#shareSheet')).toHaveClass(/open/);
  await expect(page.locator('#sharePrev')).toHaveAttribute('src', /^blob:/);
  const size = await page.locator('#sharePrev').evaluate((img) => new Promise((r) => img.complete && img.naturalWidth ? r([img.naturalWidth, img.naturalHeight]) : img.onload = () => r([img.naturalWidth, img.naturalHeight])));
  expect(size).toEqual([1080, 1920]);
  await expect(page.locator('#shareVals')).not.toBeChecked();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#shareDl')]);
  expect(download.suggestedFilename()).toBe('folego-conquista.png');
});

test('quitar uma dívida oferece compartilhar a conquista', async ({ page }) => {
  page.errors = await setupPage(page, { configured: false });
  await page.goto('/');
  await page.click('#sGo');
  await page.click('nav [data-tab=dividas]');
  await page.click('[data-add=divida]');
  await page.locator('.debt .field input').nth(0).fill('100');
  await page.locator('.debt .field input').nth(1).fill('1');
  await page.click('.paybtn');
  await expect(page.locator('#toast')).toContainText('Quitei uma dívida!', { timeout: 5000 });
  await page.click('#toastAct');
  await expect(page.locator('#shareSheet')).toHaveClass(/open/);
  await expect(page.locator('#sharePrev')).toHaveAttribute('src', /^blob:/);
});

test('prévia do link no WhatsApp (Open Graph) aponta para uma imagem 1200x630', async ({ page, request }) => {
  page.errors = await setupPage(page, { configured: false });
  await page.goto('/');
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(og).toBe('https://walicard56.github.io/og-image.png');
  const img = await request.get('/og-image.png');
  expect(img.status()).toBe(200);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /fechar o mês/);
});

test('sequência: anotar dias seguidos aparece nas dicas da Lumi', async ({ page }) => {
  await page.addInitScript(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const ontem = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!localStorage.getItem('folego-prefs')) localStorage.setItem('folego-prefs', JSON.stringify({ theme: 'auto', haptic: true, streak: 2, lastLaunchDay: ontem }));
  });
  page.errors = await setupPage(page, { configured: false });
  await page.goto('/');
  await page.click('#sGo');
  await page.click('#fab');
  await page.fill('#qVal', '12');
  await page.click('#qSave');
  await expect(page.locator('#toast')).toContainText('3 dias seguidos', { timeout: 6000 });
  const msgs = await page.evaluate(() => document.getElementById('coach')._messages.join(' | '));
  expect(msgs).toContain('3 dias seguidos anotando');
});
