// Funções básicas do app, sem conta (modo livre).
const { test, expect } = require('@playwright/test');
const { setupPage } = require('./helpers');

test.beforeEach(async ({ page }) => {
  const errors = await setupPage(page, { configured: false });
  page.errors = errors;
  await page.goto('/');
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

async function setup(page, salario = '3000') {
  await expect(page.locator('#setupSheet')).toHaveClass(/open/);
  await page.fill('#sSalario', salario);
  await page.click('#sGo');
  await expect(page.locator('#setupSheet')).not.toHaveClass(/open/);
}

test('configuração inicial define o salário e a sobra', async ({ page }) => {
  await setup(page, '3000');
  await expect(page.locator('#sobraTotal')).toHaveText('R$ 3.000');
});

test('lançamento rápido de gasto, com desfazer', async ({ page }) => {
  await setup(page);
  await page.click('#fab');
  await page.fill('#qVal', '120');
  await page.click('#qSave');
  await expect(page.locator('#sobraTotal')).toHaveText('R$ 2.880');
  await page.click('#toastAct');
  await expect(page.locator('#sobraTotal')).toHaveText('R$ 3.000');
});

test('renda extra entra na sobra', async ({ page }) => {
  await setup(page);
  await page.click('#fab');
  await page.click('#qType [data-q=extra]');
  await page.fill('#qVal', '500');
  await page.click('#qSave');
  await expect(page.locator('#sobraTotal')).toHaveText('R$ 3.500');
});

test('dados continuam depois de recarregar', async ({ page }) => {
  await setup(page, '2200');
  await page.reload();
  await expect(page.locator('#setupSheet')).not.toHaveClass(/open/);
  await expect(page.locator('#sobraTotal')).toHaveText('R$ 2.200');
});

test('reserva: guardar e usar', async ({ page }) => {
  await setup(page);
  await page.click('nav [data-tab=reserva]');
  await page.click('[data-res="100"]');
  await expect(page.locator('#resSaldo')).toHaveText('R$ 100');
  await page.fill('#resAddVal', '40');
  await page.click('#resUsar');
  await expect(page.locator('#resSaldo')).toHaveText('R$ 60');
});

test('dívida: pagar parcela reduz o total', async ({ page }) => {
  await setup(page);
  await page.click('nav [data-tab=dividas]');
  await page.click('[data-add=divida]');
  const inputs = page.locator('.debt .field input');
  await inputs.nth(0).fill('100');
  await inputs.nth(1).fill('3');
  await expect(page.locator('#divTotal')).toHaveText('R$ 300');
  await page.click('.paybtn');
  await expect(page.locator('#divTotal')).toHaveText('R$ 200');
});

test('tema escuro manual', async ({ page }) => {
  await setup(page);
  await page.click('#userBtn');
  await page.click('[data-theme-opt=dark]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
