// Renda segura, meta de reserva sugerida, área MEI e Lumi com IA.
const { test, expect } = require('@playwright/test');
const { createServer, setupPage } = require('./helpers');

test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

/** Estado com 3 meses fechados (rendas 3000, 2000, 2500) e o mês atual com 3500. */
async function seedHistory(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('app-financas-v1')) return;
    const id = (k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
    const mes = (renda) => ({ ganhos: [{ nome: 'Salário', valor: renda }], comPrev: 0, comReal: 0, touched: true, variaveis: [], extras: [],
      fixos: [{ nome: 'Aluguel', valor: 1000, cat: 'moradia' }] });
    localStorage.setItem('app-financas-v1', JSON.stringify({ current: id(0), config: { comissao: false }, reserva: { meta: 3000, atual: 0 }, dividas: [],
      months: { [id(3)]: mes(3000), [id(2)]: mes(2000), [id(1)]: mes(2500), [id(0)]: mes(3500) } }));
  });
}

test('renda segura é o pior mês recente e mostra o extra deste mês', async ({ page }) => {
  page.errors = await setupPage(page, { configured: false });
  await seedHistory(page);
  await page.goto('/');
  await expect(page.locator('#rendaCard')).toContainText('R$ 2.000');
  await expect(page.locator('#rendaCard')).toContainText('R$ 1.500 acima');
});

test('meta de reserva sugerida = 6 meses de contas fixas', async ({ page }) => {
  page.errors = await setupPage(page, { configured: false });
  await seedHistory(page);
  await page.goto('/');
  await page.click('nav [data-tab=reserva]');
  await expect(page.locator('#resSugerida')).toContainText('R$ 6.000');
  await page.click('#resUsarSugerida');
  await expect(page.locator('#resMeta')).toHaveValue('6000');
  await expect(page.locator('#resSugerida')).toContainText('já segue');
});

test('área MEI: limite anual e DAS nas contas fixas', async ({ page }) => {
  page.errors = await setupPage(page, { configured: false });
  await page.goto('/');
  await page.fill('#sSalario', '0');
  await page.click('#sGo');
  await page.click('#userBtn');
  await page.locator('#toggleMei').evaluate((el) => el.click());
  await page.click('nav [data-tab=mes]');
  await expect(page.locator('#meiCard')).toBeVisible();
  await page.fill('#meiFat', '70000');
  await page.locator('#meiFat').dispatchEvent('change');
  await expect(page.locator('#meiCard .meter')).toHaveClass(/warn/);
  await page.fill('#meiDas', '82');
  await page.locator('#meiDas').dispatchEvent('change');
  await page.click('#meiAddDas');
  const das = page.locator('#fixosList .row').last();
  await expect(das.locator('.name')).toHaveValue('DAS MEI');
  await expect(das.locator('.val')).toHaveValue('82');
  await expect(das.locator('select')).toHaveValue('20');
});

test('Lumi responde usando o resumo financeiro (Premium em teste)', async ({ page }) => {
  const server = createServer();
  let pedido = null;
  server.fnHandlers.lumi = (body) => { pedido = body; return { reply: 'Sim! Sua sobra é de R$ ' + body.summary.sobra_do_mes + '.', remaining: 14 }; };
  page.errors = await setupPage(page, { server });
  await page.goto('/');
  await page.fill('#sSalario', '3000');
  await page.click('#sGo');
  await page.click('#userBtn');
  await page.click('#acctLogin #fakeG');
  await page.click('nav [data-tab=mes]');
  await page.click('#lumiOpen');
  await page.click('#lumiChips button >> nth=0');
  await expect(page.locator('#lumiMsgs .lmsg.bot').last()).toHaveText('Sim! Sua sobra é de R$ 3000.');
  expect(pedido.question).toContain('celular');
  expect(pedido.summary.renda.total).toBe(3000);
  expect(JSON.stringify(pedido.summary)).not.toContain('ana@example.com');
});

test('Lumi sem conta abre a oferta do Premium', async ({ page }) => {
  page.errors = await setupPage(page, { server: createServer() });
  await page.goto('/');
  await page.fill('#sSalario', '3000');
  await page.click('#sGo');
  await page.click('#lumiOpen');
  await expect(page.locator('#paywall')).toHaveClass(/open/);
  await expect(page.locator('#paywall')).toContainText('Conversar com a Lumi é Premium');
});
