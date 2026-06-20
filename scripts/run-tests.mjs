#!/usr/bin/env node
// Test runner that retries ONLY on a flaky V8 engine abort.
//
// Vitest occasionally dies with an internal V8 crash (e.g.
// "RepresentationChangerError ... cannot be changed to kRepTagged", a TurboFan
// miscompilation) that aborts the node process *after* the suites pass but
// before vitest prints its summary. It is intermittent and unrelated to the
// code under test. This wrapper re-runs vitest when it sees that crash
// signature, but propagates genuine test failures unchanged (no masking).
//
// Used as `npm test`. Any extra args are forwarded to vitest, e.g.
// `npm test -- packages/core`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgJsonPath = require.resolve('vitest/package.json');
const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
const binRel = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin.vitest;
const vitestBin = join(dirname(pkgJsonPath), binRel);

const forwarded = process.argv.slice(2);
const MAX_ATTEMPTS = 3;
const CRASH = /RepresentationChangerError|Fatal error in|Native stack trace|V8_Fatal|FailureMessage Object|SIGSEGV|SIGABRT/;

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitestBin, 'run', ...forwarded], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let out = '';
    const tee = (stream, dest) => {
      stream.on('data', (d) => {
        out += d.toString();
        dest.write(d);
      });
    };
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('close', (code, signal) => resolve({ code, signal, out }));
  });
}

const isV8Crash = ({ code, signal, out }) =>
  code !== 0 && (signal != null || CRASH.test(out));

let result;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  result = await runOnce();
  if (result.code === 0) process.exit(0);
  if (!isV8Crash(result)) process.exit(result.code ?? 1); // real test failure
  console.error(
    `\n[run-tests] vitest aborted with a flaky V8 crash (attempt ${attempt}/${MAX_ATTEMPTS}); retrying...\n`,
  );
}
console.error('[run-tests] V8 crash persisted across retries; reporting failure.');
process.exit(result.code ?? 1);
