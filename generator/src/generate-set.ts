/**
 * generate-set — one orchestrator that runs the individual bank generators to
 * produce a MIX of puzzle types in a single pass. Give it how many of each type to
 * aim for; it starts one shared StackRabbit, runs each generator in turn (so they
 * don't fight over the engine port), and prints a roll-up of what got inserted.
 *
 *   npx tsx generator/src/generate-set.ts --spintuck 6 --vits 8 --szdig 6
 *   npx tsx generator/src/generate-set.ts --tuck 10 --tspin 5 --dry-run
 *   npx tsx generator/src/generate-set.ts            # prints the type list + help
 *
 * The number after each type is that generator's `--count` (how many candidates it
 * ASSEMBLES before BetaTetris judging). BetaTetris keeps a fraction, so the number
 * INSERTED is ≤ the count — the roll-up reports the actual inserts. `--dry-run`
 * passes through to every generator (assemble + judge, no writes).
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadRepoEnv, createManagedStackRabbit, REPO_ROOT } from './gen-harness.js';

/** type → which generator script runs it, with any type-specific flags. */
const REGISTRY: Record<string, { script: string; extra: string[]; desc: string }> = {
  spintuck: { script: 'spintuck-bank-gen.ts', extra: ['--framing', 'p1'], desc: 'last-second spin-tucks (piece-1, strict)' },
  vits: { script: 'vits-bank-gen.ts', extra: [], desc: 'vertical-I tuck setups (tetris-ready)' },
  tuck: { script: 'tuck-gen.ts', extra: [], desc: 'tucks / spins (engine-validated)' },
  varied: { script: 'varied-maneuver-gen.ts', extra: [], desc: 'varied-board tuck / spin digs' },
  tspin: { script: 'spin-bank-gen.ts', extra: [], desc: 'forced T-spins' },
  szdig: { script: 'forced-sz-dig-bank-gen.ts', extra: [], desc: 'S-spin / Z-spin digs' },
  forcedspin: { script: 'forced-spin-bank-gen.ts', extra: [], desc: 'forced T / J / L spins' },
};

function printHelp(): void {
  console.log('generate-set — run a mix of puzzle generators in one pass.\n');
  console.log('Usage: npx tsx generator/src/generate-set.ts --<type> <count> [...] [--dry-run]\n');
  console.log('Types:');
  for (const [type, { desc }] of Object.entries(REGISTRY)) console.log(`  --${type.padEnd(11)} ${desc}`);
  console.log('\n<count> is the generator\'s assemble target; inserts are ≤ count after BetaTetris.');
}

/** Run one generator as a child process, echoing its output live and capturing the inserted count. */
function runGenerator(script: string, args: string[]): Promise<{ code: number; inserted: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', join('generator', 'src', script), ...args], {
      cwd: REPO_ROOT,
      shell: process.platform === 'win32', // resolve npx.cmd on Windows
    });
    let buf = '';
    child.stdout.on('data', (d: Buffer) => { const s = d.toString(); process.stdout.write(s); buf += s; });
    child.stderr.on('data', (d: Buffer) => process.stderr.write(d));
    child.on('error', (e) => { console.error(`failed to launch ${script}: ${e.message}`); resolve({ code: 1, inserted: null }); });
    child.on('close', (code) => {
      const m = buf.match(/inserted (\d+)/i); // every generator prints "inserted N …"
      resolve({ code: code ?? 1, inserted: m ? Number(m[1]) : null });
    });
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const jobs: Array<{ type: string; count: number }> = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const type = a.slice(2);
    if (!(type in REGISTRY)) continue; // skips --dry-run and unknown flags
    const count = Number(argv[i + 1]);
    if (!Number.isInteger(count) || count <= 0) { console.error(`--${type} needs a positive integer count`); process.exit(2); }
    jobs.push({ type, count });
    i++;
  }
  if (jobs.length === 0) { printHelp(); return; }

  loadRepoEnv();
  console.log(`generate-set: ${jobs.map((j) => `${j.type}×${j.count}`).join(', ')}${dryRun ? ' (dry-run)' : ''}\n`);

  // One shared StackRabbit for the whole run — each generator reuses it (their own
  // ensureEngine pings :3000, finds it, and won't spawn a competing instance).
  const { ensureEngine, killEngine } = createManagedStackRabbit();
  if (!(await ensureEngine())) { console.error('could not start StackRabbit on :3000'); process.exit(1); }

  const summary: Array<{ type: string; count: number; inserted: number | null; code: number }> = [];
  try {
    for (const job of jobs) {
      const { script, extra } = REGISTRY[job.type];
      const args = ['--count', String(job.count), ...extra, ...(dryRun ? ['--dry-run'] : [])];
      console.log(`\n━━━ ${job.type} (${script} ${args.join(' ')}) ━━━`);
      const res = await runGenerator(script, args);
      summary.push({ type: job.type, count: job.count, ...res });
    }
  } finally {
    killEngine();
  }

  console.log('\n══════ generate-set summary ══════');
  for (const s of summary) {
    const status = s.code === 0 ? 'ok' : `FAILED (exit ${s.code})`;
    const ins = dryRun ? '(dry-run)' : s.inserted === null ? '?' : String(s.inserted);
    console.log(`  ${s.type.padEnd(11)} count=${s.count}  inserted=${ins}  ${status}`);
  }
  if (summary.some((s) => s.code !== 0)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
