import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: './web',
      port: 5173,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: './server',
      port: 4000,
      reuseExistingServer: true,
      timeout: 60_000,
    }
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
