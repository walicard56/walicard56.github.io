// Importação de extrato OFX/CSV: prévia, categorias, desmarcados, duplicatas.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { createServer, setupPage } = require('./helpers');
const fx = (f) => path.join(__dirname, 'fixtures', f);

test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

async function start(page, opts) {
  page.errors = await setupPage(page, opts || { configured: false });
  await page.goto('/');
  await page.fill('#sSalario', '3000');
  await page.click('#sGo');
  await page.click('#userBtn');
}

test('OFX: gastos marcados com categoria; renda e fatura desmarcadas', async ({ page }) => {
  await start(page);
  await page.click('#bankImportBtn');
  await page.setInputFiles('#bankFile', fx('extrato.ofx'));
  await expect(page.locator('#importSheet')).toHaveClass(/open/);
  const linhas = page.locator('#importBody .imp');
  await expect(linhas).toHaveCount(4);
  await expect(page.locator('#importBody .imp:has-text("ASSAI") input')).toBeChecked();
  await expect(page.locator('#importBody .imp:has-text("ASSAI") .catbtn')).toHaveText('🛒');
  await expect(page.locator('#importBody .imp:has-text("UBER") .catbtn')).toHaveText('🚗');
  await expect(page.locator('#importBody .imp:has-text("PIX RECEBIDO") input')).not.toBeChecked();
  await expect(page.locator('#importBody .imp:has-text("FATURA") input')).not.toBeChecked();
  await page.click('#impGo');
  await expect(page.locator('#toast')).toContainText('2 lançamentos importados em 1 mês');

  // O mês de setembro/2026 passa a existir com os gastos
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('app-financas-v1')));
  const set = st.months['2026-09'];
  expect(set.variaveis.map((v) => [v.nome, v.valor, v.cat, v.data])).toEqual([
    ['UBER *TRIP', 38.9, 'transporte', '2026-09-07'],
    ['SUPERMERCADO ASSAI', 152.3, 'mercado', '2026-09-05'],
  ]);

  // Importar o mesmo arquivo de novo não duplica
  await page.click('#bankImportBtn');
  await page.setInputFiles('#bankFile', fx('extrato.ofx'));
  await expect(page.locator('#importBody')).toContainText('2 já importados');
  await expect(page.locator('#importBody .imp.dup')).toHaveCount(2);
});

test('CSV da fatura do Nubank: valores positivos viram gastos', async ({ page }) => {
  await start(page);
  await page.click('#bankImportBtn');
  await page.setInputFiles('#bankFile', fx('nubank-cartao.csv'));
  await expect(page.locator('#importBody .imp:has-text("iFood") .catbtn')).toHaveText('🍔');
  await expect(page.locator('#importBody .imp:has-text("Netflix") .catbtn')).toHaveText('📺');
  await expect(page.locator('#importBody .imp:has-text("Pagamento recebido") input')).not.toBeChecked();
  await expect(page.locator('#impGo')).toContainText('Importar 2 lançamentos (R$ 102 em gastos)');
});

test('CSV do Inter: trocar categoria e incluir uma renda extra', async ({ page }) => {
  await start(page);
  await page.click('#bankImportBtn');
  await page.setInputFiles('#bankFile', fx('inter.csv'));
  await page.click('#importBody .imp:has-text("Drogaria") .catbtn');
  await page.click('#catGrid .catopt:has-text("Compras")');
  await expect(page.locator('#importSheet')).toHaveClass(/open/);
  await expect(page.locator('#importBody .imp:has-text("Drogaria") .catbtn')).toHaveText('🛍️');
  await page.locator('#importBody .imp:has-text("Freela") input').check();
  await page.click('#impGo');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('app-financas-v1')));
  expect(st.months['2026-09'].variaveis[0]).toMatchObject({ nome: 'Drogaria Raia', valor: 1234.56, cat: 'compras' });
  expect(st.months['2026-09'].extras[0]).toMatchObject({ nome: 'Freela site', valor: 800 });
});

test('importar extrato é Premium', async ({ page }) => {
  const server = createServer();
  await start(page, { server });
  await page.click('#bankImportBtn');
  await expect(page.locator('#paywall')).toHaveClass(/open/);
  await expect(page.locator('#paywall')).toContainText('Importar extrato é Premium');
});
