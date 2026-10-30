import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Unit + component test runner. jsdom is the default environment because almost
 * every surface we test is a React component; pure-logic suites are cheap enough
 * to run in jsdom too, so one environment keeps the config simple.
 *
 * (`@` alias এখানে আলাদা করে দেওয়া — vitest tsconfig paths নিজে পড়ে না।)
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', 'coverage/**', 'e2e/**'],
    clearMocks: true,
    restoreMocks: true,
    css: false,
  },
});
