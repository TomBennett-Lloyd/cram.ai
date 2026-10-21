import { defineConfig, devices } from '@playwright/test';
import { DEV_SERVER_PORT, PREVIEW_PORT } from './lane-ports';

const HOST = '127.0.0.1';

/** The one spec run against `vite` itself, for what only StrictMode's double effects break. */
const DEV_SPEC = 'dev-server.spec.ts';

/**
 * The browser lane: the production build under `vite preview`, plus one dev-server spec, with the
 * server's API stubbed at the network boundary (`hermetic-api.ts`), so the lane needs no models.
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: DEV_SPEC },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testIgnore: DEV_SPEC },
    {
      name: 'dev-server',
      use: { ...devices['Desktop Chrome'], baseURL: `http://${HOST}:${String(DEV_SERVER_PORT)}` },
      testMatch: DEV_SPEC,
    },
  ],
  webServer: [
    {
      command: `vite build && vite preview --host ${HOST} --port ${String(PREVIEW_PORT)} --strictPort`,
      cwd: '..',
      port: PREVIEW_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'vite',
      cwd: '..',
      port: DEV_SERVER_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
