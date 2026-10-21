import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The agent evaluation: real conversations run against the REAL model and database (npm run agent:eval). It costs a few cents and
 * reads a real account, so it is kept apart from the normal tests. It answers one question: when people say things the way they
 * really do, does the agent choose the right tool with the right settings?
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: { environment: 'node', include: ['src/lib/agent/evals/**/*.eval.ts'], testTimeout: 300_000, hookTimeout: 120_000, fileParallelism: false },
});
