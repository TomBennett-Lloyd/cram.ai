import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { DEV_SERVER_PORT, PREVIEW_PORT } from './e2e/lane-ports.ts';

/** Both ports are derived per worktree and refuse to hop (`e2e/lane-ports.ts`). */
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: DEV_SERVER_PORT, strictPort: true },
  preview: { host: '127.0.0.1', port: PREVIEW_PORT, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'e2e/**/*.test.ts'],
    setupFiles: ['src/jsdom-setup.ts'],
  },
});
