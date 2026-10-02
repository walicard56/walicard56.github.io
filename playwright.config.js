// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:8765',
    ...devices['Pixel 7'],
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  webServer: {
    command: 'python3 -m http.server 8765',
    url: 'http://localhost:8765/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
