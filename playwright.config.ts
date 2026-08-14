import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199/trip_planner/',
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199/trip_planner/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
