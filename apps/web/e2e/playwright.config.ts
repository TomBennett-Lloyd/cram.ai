import { defineConfig, devices } from '@playwright/test';
import { PREVIEW_PORT } from './lane-ports';

const HOST = '127.0.0.1';

/**
 * The browser lane: the production build under `vite preview`, with the server's API stubbed at
 * the network boundary (`hermetic-api.ts`), since no server entrypoint exists yet (#145).
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  retries: 0,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://${HOST}:${String(PREVIEW_PORT)}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `vite build && vite preview --host ${HOST} --port ${String(PREVIEW_PORT)} --strictPort`,
    cwd: '..',
    port: PREVIEW_PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
