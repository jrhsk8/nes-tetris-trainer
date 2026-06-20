import { defineConfig } from 'vitest/config';

// Single root runner across all workspaces (packages/core, apps/play,
// generator). The scaffold's tests are pure logic, so the default node
// environment is sufficient; DOM-dependent UI tests can opt into jsdom later.
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.{ts,tsx}', 'generator/**/*.test.ts'],
  },
});
