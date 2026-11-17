import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Slow tests that run a full `next build` (npm run test:build). Kept out of `npm test`. */
export default defineConfig({
  // Next sets jsx to "preserve"; tests that import a component need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { '@': root } },
  test: {
    include: ['tests/build/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 15 * 60 * 1000,
    fileParallelism: false,
  },
});
