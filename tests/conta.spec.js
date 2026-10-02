// Conta Google + Supabase: login opcional, sincronização entre aparelhos e exclusão.
const { test, expect } = require('@playwright/test');
const { createServer, setupPage } = require('./helpers');

async function phone(browser, server, opts = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.errors = await setupPage(page, { server, ...opts });
  await page.goto('/');
  return page;
}
async function login(page) {
  if (!(await page.locator('#view-conta').evaluate((el) => el.classList.contains('active')))) await page.click('#userBtn');
  await page.click('#acctLogin #fakeG');
}

test('usa sem conta; ao entrar, os dados sobem para a nuvem', async ({ browser }) => {
  const server = createServer();
  const a = await phone(browser, server);
  await a.fill('#sSalario', '3200');
  await a.click('#sGo');
  await expect(a.locator('#sobraTotal')).toHaveText('R$ 3.200');
  await login(a);
  await expect.poll(() => server.DB.user_data.u1 && server.DB.user_data.u1.state.months).toBeTruthy();
  expect(a.errors).toEqual([]);
});

test('celular novo: "já uso o Fôlego" baixa os dados da conta', async ({ browser }) => {
  const server = createServer();
  const a = await phone(browser, server);
  await a.fill('#sSalario', '4100');
  await a.click('#sGo');
  await login(a);
  await expect.poll(() => !!server.DB.user_data.u1).toBe(true);

  const b = await phone(browser, server);
  await b.click('#sLogin');
  await login(b);
  await expect(b.locator('#sobraTotal')).toHaveText('R$ 4.100');
  expect(b.errors).toEqual([]);
});

test('excluir conta apaga os dados da nuvem', async ({ browser }) => {
  const server = createServer();
  const a = await phone(browser, server);
  await a.fill('#sSalario', '1000');
  await a.click('#sGo');
  await login(a);
  await expect.poll(() => !!server.DB.user_data.u1).toBe(true);
  await a.click('#aDel');
  await expect.poll(() => !!server.DB.user_data.u1).toBe(false);
  await expect(a.locator('#acctLogin')).toBeVisible();
  expect(a.errors).toEqual([]);
});
