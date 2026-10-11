import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/ios/**', '**/android/**'],
    environment: 'node',
    testTimeout: 15_000,
    hookTimeout: 30_000,
    restoreMocks: true,
    clearMocks: true,
    // Database integration suites each own the disposable recollect schema.
    // Per-test concurrency remains explicit where it verifies transaction races.
    fileParallelism: false,
  },
});
