import { defineConfig } from '@playwright/test';

// BASE_URL=http://127.0.0.1:8080/ npx playwright test — перевірити вже запущений сайт (наприклад, контейнер)
const external = process.env.BASE_URL;

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  workers: 1, // python http.server не витримує паралельних браузерів
  reporter: [['list']],
  use: {
    baseURL: external || 'http://127.0.0.1:8123/',
    locale: 'uk-UA',
    viewport: { width: 1100, height: 900 },
  },
  webServer: external ? undefined : {
    command: 'python3 -m http.server 8123 --bind 127.0.0.1 --directory site',
    url: 'http://127.0.0.1:8123/index.html',
    reuseExistingServer: true,
  },
});
