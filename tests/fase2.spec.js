// Categorias, datas, contas a pagar, orçamento, relatório e virada do mês.
const { test, expect } = require('@playwright/test');
const { setupPage } = require('./helpers');

test.beforeEach(async ({ page }) => {
  page.errors = await setupPage(page, { configured: false }); // modo livre: tudo liberado
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

async function start(page) {
  await page.goto('/');
  await page.fill('#sSalario', '3000');
  await page.click('#sGo');
}
async function quick(page, valor, cat) {
  await page.click('#fab');
  if (cat) await page.click(`#qChips [data-cat=${cat}]`);
  await page.fill('#qVal', String(valor));
  await page.click('#qSave');
}

test('gasto rápido com categoria e data de hoje', async ({ page }) => {
  await start(page);
  await quick(page, 45, 'alimentacao');
  const row = page.locator('#varList .row').first();
  await expect(row.locator('.catbtn')).toHaveText('🍔');
  await expect(row.locator('.name')).toHaveValue('Comer fora');
  const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await expect(row.locator('.dt')).toHaveValue(today);
});

test('categoria é adivinhada pelo nome e pode ser trocada', async ({ page }) => {
  await start(page);
  await page.click('#fab');
  await page.fill('#qVal', '30');
  await page.fill('#qName', 'Uber pro trabalho');
  await page.click('#qSave');
  const btn = page.locator('#varList .row .catbtn').first();
  await expect(btn).toHaveText('🚗');
  await btn.click();
  await page.click('#catGrid .catopt:has-text("Lazer")');
  await expect(btn).toHaveText('🎉');
});

test('conta fixa com vencimento hoje aparece em "Contas a pagar" e some ao pagar', async ({ page }) => {
  await start(page);
  const day = await page.evaluate(() => new Date().getDate());
  const aluguel = page.locator('#fixosList .row').first();
  await aluguel.locator('.val').fill('1200');
  await aluguel.locator('select').selectOption(String(day));
  await expect(page.locator('#billsCard')).toBeVisible();
  await expect(page.locator('#billsCard')).toContainText('vence hoje');
  await page.click('#billsCard .bp');
  await expect(page.locator('#billsCard')).toBeHidden();
  await expect(aluguel.locator('.paid')).toHaveText('✓ pago');
});

test('orçamento avisa aos 80% e quando estoura', async ({ page }) => {
  await start(page);
  await page.click('#orcEdit');
  await page.fill('.budget-in[data-cat=alimentacao]', '100');
  await page.click('#budgetSave');
  await quick(page, 85, 'alimentacao');
  await expect(page.locator('#toast')).toContainText('85% do orçamento', { timeout: 6000 });
  await quick(page, 30, 'alimentacao');
  await expect(page.locator('#toast')).toContainText('estourou', { timeout: 6000 });
  await expect(page.locator('#orcSection .meter')).toHaveClass(/over/);
  await expect(page.locator('#orcSection')).toContainText('passou R$ 15');
});

test('relatório mostra gastos por categoria, do maior para o menor', async ({ page }) => {
  await start(page);
  await page.locator('#fixosList .row').first().locator('.val').fill('1000'); // Aluguel → Moradia
  await quick(page, 200, 'mercado');
  await quick(page, 50, 'lazer');
  await page.click('nav [data-tab=hist]');
  const labels = page.locator('#relSection .cbar .cl');
  await expect(labels).toHaveText(['🏠 Moradia', '🛒 Mercado', '🎉 Lazer']);
  await expect(page.locator('#relSection')).toContainText('R$ 1.250');
  await page.click('#relSection .cbar[data-cat=mercado]');
  await expect(page.locator('#relSection .cdetail[data-for=mercado]')).toContainText('R$ 200');
});

test('virada do mês: cria o mês atual com as contas fixas como não pagas', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('app-financas-v1')) return;
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const prev = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    localStorage.setItem('app-financas-v1', JSON.stringify({ current: prev, config: { comissao: false }, reserva: { meta: 0, atual: 0 }, dividas: [],
      months: { [prev]: { ganhos: [{ nome: 'Salário', valor: 2000 }], comPrev: 0, comReal: 0, touched: true, variaveis: [{ nome: 'x', valor: 10 }], extras: [],
        fixos: [{ nome: 'Aluguel', valor: 900, dia: 5, pago: true }] } } }));
  });
  await page.goto('/');
  const monthLabel = await page.evaluate(() => { const m = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']; const d = new Date(); return m[d.getMonth()] + ' ' + d.getFullYear(); });
  await expect(page.locator('#monthLabel')).toHaveText(monthLabel);
  await expect(page.locator('#fixosList .row .paid').first()).toHaveText('marcar pago');
  await expect(page.locator('#varList .row')).toHaveCount(0);
  await expect(page.locator('#sobraTotal')).toHaveText('R$ 1.100');
});

test('lembretes ficam ocultos sem chave VAPID configurada', async ({ page }) => {
  await start(page);
  await page.click('#userBtn');
  await expect(page.locator('#pushRow')).toBeHidden();
});
