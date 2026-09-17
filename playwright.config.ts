import { defineConfig } from '@playwright/test';
const port = Number(process.env.STILL_TEST_PORT ?? 8001);
const e2eDatabaseUrl = process.env.STILL_E2E_DATABASE_URL ?? 'postgresql://127.0.0.1:55432/still_e2e';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  globalSetup: './tests/global-setup.ts',
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
    env: { DATABASE_URL: e2eDatabaseUrl, DATABASE_URL_DIRECT: e2eDatabaseUrl, ...(process.env.STILL_DIST_PATH ? { STILL_DIST_PATH: process.env.STILL_DIST_PATH } : {}) },
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
  },
});
