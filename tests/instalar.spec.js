// Convite para instalar o app (tela cheia, sem barra do navegador).
const { test, expect } = require('@playwright/test');
const { setupPage } = require('./helpers');

test('no Chrome, mostra "Instalar" e chama o instalador do navegador', async ({ page }) => {
  page.errors = await setupPage(page, { configured: false });
  await page.goto('/');
  await page.click('#sGo');
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await expect(page.locator('#installBanner')).toContainText('Instale o Fôlego');
  await page.click('#installGo');
  expect(await page.evaluate(() => window.__prompted)).toBe(true);
  await expect(page.locator('#installBanner')).toBeHidden();
  expect(page.errors).toEqual([]);
});

test('dentro do WhatsApp/Instagram, orienta abrir no Chrome', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 Instagram 300.0' });
  const page = await ctx.newPage();
  page.errors = await setupPage(page, { configured: false });
  await page.goto('/');
  await page.click('#sGo');
  await expect(page.locator('#installBanner')).toContainText('Abra no Chrome para instalar');
  await page.click('#installX');
  await page.reload();
  await expect(page.locator('#installBanner')).toBeHidden();
  expect(page.errors).toEqual([]);
});
