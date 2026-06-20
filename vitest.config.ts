import { defineConfig } from 'vitest/config';

// Single root runner across all workspaces (packages/core, apps/play,
// generator). The scaffold's tests are pure logic, so the default node
// environment is sufficient; DOM-dependent UI tests can opt into jsdom later.
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.{ts,tsx}', 'generator/**/*.test.ts'],
    // Mitigate the flaky V8/TurboFan abort (#16). The crash
    // ("RepresentationChangerError ... kRepTagged") fires in V8's *concurrent*
    // optimizing-compile worker thread on node 22.23.0. Disabling concurrent
    // recompilation moves optimization onto the main thread — JIT optimization
    // is retained (negligible cost for our suite), but the crashing worker
    // thread is gone. Set on the worker command line, not NODE_OPTIONS (node
    // rejects --no-* opt flags there with exit 9). The retry wrapper in
    // scripts/run-tests.mjs stays as a backstop until stability is confirmed
    // over time / a node upgrade resolves the root cause.
    pool: 'forks',
    poolOptions: {
      forks: { execArgv: ['--no-concurrent-recompilation'] },
    },
  },
});
