import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    // Each test gets a fresh tmp dir under backend/tmp. We clean it after
    // the run to keep the repo tidy.
    hookTimeout: 10_000,
    testTimeout: 10_000,
  },
});
