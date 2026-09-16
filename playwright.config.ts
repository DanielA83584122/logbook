import { defineConfig } from '@playwright/test';
const port = Number(process.env.STILL_TEST_PORT ?? 8001);

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    viewport: { width: 1280, height: 1000 },
    timezoneId: 'America/Los_Angeles',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port ${port}`,
    env: { STILL_DB_PATH: `/tmp/still-e2e-${Date.now()}.sqlite3`, ...(process.env.STILL_DIST_PATH ? { STILL_DIST_PATH: process.env.STILL_DIST_PATH } : {}) },
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
  },
});
