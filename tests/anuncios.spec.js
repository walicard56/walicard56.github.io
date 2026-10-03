// Anúncios: só no plano grátis, espaço discreto, somem se não houver anúncio.
const { test, expect } = require('@playwright/test');
const { createServer, setupPage, entrar } = require('./helpers');

const ADS = { ADSENSE_CLIENT: 'ca-pub-0000000000000000', ADSENSE_SLOT: '1234567890' };

/** Simula o script do AdSense: marca o anúncio como preenchido (ou vazio). */
async function fakeAdsense(page, status = 'filled') {
  const pedidos = [];
  await page.route('https://pagead2.googlesyndication.com/**', (r) => {
    pedidos.push(r.request().url());
    r.fulfill({ contentType: 'text/javascript', body: `
      document.querySelectorAll('ins.adsbygoogle').forEach(i => { i.setAttribute('data-ad-status', '${status}'); i.style.height = '100px'; });` });
  });
  return pedidos;
}

test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

test('plano grátis vê um anúncio discreto, não personalizado', async ({ page }) => {
  const server = createServer(); server.trialAgoDays = 10;
  page.errors = await setupPage(page, { server, config: ADS });
  const pedidos = await fakeAdsense(page);
  await page.goto('/');
  await entrar(page);
  const slot = page.locator('#adSlot');
  await expect(slot).toBeVisible();
  await expect(slot).toContainText('Publicidade');
  await expect.poll(() => pedidos.length).toBe(1);
  expect(pedidos[0]).toContain('client=ca-pub-0000000000000000');
  expect(await page.evaluate(() => window.adsbygoogle.requestNonPersonalizedAds)).toBe(1);
  await expect(page.locator('#adSlot ins.adsbygoogle')).toHaveAttribute('data-ad-slot', '1234567890');
  await page.click('#adRemove');
  await expect(page.locator('#paywall')).toContainText('Use o Fôlego sem anúncios');
});

test('no teste grátis (Premium) não há anúncio nem script do Google', async ({ page }) => {
  page.errors = await setupPage(page, { server: createServer(), config: ADS });
  const pedidos = await fakeAdsense(page);
  await page.goto('/');
  await entrar(page);
  await page.waitForTimeout(2000);
  await expect(page.locator('#adSlot')).toBeHidden();
  expect(pedidos).toEqual([]);
});

test('se o Google não tiver anúncio, o espaço some', async ({ page }) => {
  const server = createServer(); server.trialAgoDays = 10;
  page.errors = await setupPage(page, { server, config: ADS });
  await fakeAdsense(page, 'unfilled');
  await page.goto('/');
  await entrar(page);
  await expect(page.locator('#adSlot')).toBeHidden();
});

test('sem AdSense configurado, nada é carregado', async ({ page }) => {
  const server = createServer(); server.trialAgoDays = 10;
  page.errors = await setupPage(page, { server });
  const pedidos = await fakeAdsense(page);
  await page.goto('/');
  await entrar(page);
  await page.waitForTimeout(2000);
  await expect(page.locator('#adSlot')).toBeHidden();
  expect(pedidos).toEqual([]);
});
