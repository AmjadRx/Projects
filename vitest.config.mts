import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next sets jsx to "preserve"; tests that import a component need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // Modules that import "server-only" run under Vitest as they do on the server.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Full builds live in tests/build and run with `npm run test:build`.
    exclude: ['tests/build/**', 'node_modules/**'],
    environment: 'node',
  },
});
