// Meta do mês: quanto falta, convertido em corridas, vendas ou serviços.
const { test, expect } = require('@playwright/test');
const { setupPage } = require('./helpers');

test.beforeEach(async ({ page }) => {
  page.errors = await setupPage(page, { configured: false });
  await page.goto('/');
  await page.fill('#sSalario', '1000');
  await page.click('#sGo');
  await page.locator('#fixosList .row').first().locator('.val').fill('1600'); // aluguel
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

test('motorista: faltam R$ 600 = 30 corridas; registrar ganho atualiza', async ({ page }) => {
  await expect(page.locator('#metaCard')).toContainText('Como você ganha a parte variável?');
  await page.click('#metaCard [data-tipo=corrida]');
  await page.fill('#metaNum', '20');
  await page.click('#metaSave');
  await expect(page.locator('#metaCard')).toContainText('Faltam R$ 600');
  await expect(page.locator('#metaCard')).toContainText('30 corridas');
  await expect(page.locator('#metaCard')).toContainText('por dia');
  await page.click('#metaAdd');
  await expect(page.locator('#qName')).toHaveValue('Corridas');
  await page.fill('#qVal', '200');
  await page.click('#qSave');
  await expect(page.locator('#metaCard')).toContainText('Faltam R$ 400');
  await expect(page.locator('#metaCard')).toContainText('20 corridas');
});

test('comissionado: 5% de comissão → vendas necessárias; vendas lançadas abatem', async ({ page }) => {
  await page.click('#metaCard [data-tipo=comissao]');
  await page.fill('#metaNum', '5');
  await page.fill('#metaGuardar', '200');
  await page.click('#metaSave');
  await expect(page.locator('#metaCard')).toContainText('Faltam R$ 800');
  await expect(page.locator('#metaCard')).toContainText('R$ 16.000 em vendas');
  await page.fill('#metaVendas', '16000');
  await page.locator('#metaVendas').dispatchEvent('change');
  await expect(page.locator('#metaCard')).toContainText('Meta batida');
});

test('quem não tem renda variável pode esconder e reativar depois', async ({ page }) => {
  await page.click('#metaCard [data-tipo=nenhum]');
  await expect(page.locator('#metaCard')).toBeHidden();
  await page.click('#userBtn');
  await page.click('#metaConfig');
  await expect(page.locator('#metaCard')).toBeVisible();
  await expect(page.locator('#metaCard')).toContainText('Como você ganha');
});
