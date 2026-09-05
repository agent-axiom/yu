import { defineConfig, devices } from '@playwright/test';

const previewUrl = 'http://127.0.0.1:4321/yu/';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: previewUrl,
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4321',
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
    {
      name: 'touch-chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
  ],
});
