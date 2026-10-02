// Conta Google + Supabase: sincronização entre aparelhos, sair e excluir.
const { test, expect } = require('@playwright/test');
const { createServer, setupPage, entrar } = require('./helpers');

async function phone(browser, server, opts = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.errors = await setupPage(page, { server, ...opts });
  await page.goto('/');
  return page;
}

test('depois do login e da configuração, os dados sobem para a nuvem', async ({ browser }) => {
  const server = createServer();
  const a = await phone(browser, server);
  await entrar(a, { salario: '3200' });
  await expect(a.locator('#sobraTotal')).toHaveText('R$ 3.200');
  await expect.poll(() => server.DB.user_data.u1 && server.DB.user_data.u1.state.months).toBeTruthy();
  expect(a.errors).toEqual([]);
});

test('celular novo: entrar baixa os dados da conta, sem perguntar o plano de novo', async ({ browser }) => {
  const server = createServer();
  const a = await phone(browser, server);
  await entrar(a, { salario: '4100' });
  await expect.poll(() => !!server.DB.user_data.u1).toBe(true);

  const b = await phone(browser, server);
  await b.click('#gsiGate #fakeG');
  await expect(b.locator('#sobraTotal')).toHaveText('R$ 4.100');
  await expect(b.locator('#gate')).toBeHidden();
  await expect(b.locator('#setupSheet')).not.toHaveClass(/open/);
  expect(b.errors).toEqual([]);
});

test('excluir conta apaga os dados e volta para a tela de login', async ({ browser }) => {
  const server = createServer();
  const a = await phone(browser, server);
  await entrar(a, { salario: '1000' });
  await expect.poll(() => !!server.DB.user_data.u1).toBe(true);
  await a.click('#userBtn');
  await a.click('#aDel');
  await expect.poll(() => !!server.DB.user_data.u1).toBe(false);
  await expect(a.locator('#gate #gsiGate')).toBeVisible();
  expect(a.errors).toEqual([]);
});
