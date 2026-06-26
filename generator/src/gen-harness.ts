/**
 * Shared generator harness — the boilerplate every bank generator repeats:
 * loading repo creds (+ the Node WebSocket polyfill), spawning the BetaTetris
 * consensus judge, managing a local StackRabbit process, and pulling the active
 * bank's dedup keys. Extracted so the generators and the `generate-set`
 * orchestrator share one implementation instead of copy-pasting it seven times.
 */

// @ts-expect-error - ws has no type declarations here
import ws from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBoard, type Piece } from '@trainer/core';
import { createSupabaseClient } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import type { ConsensusJudge } from './pipeline/consensus.js';
import type { BankKey } from './pipeline/dedup.js';

/** Repo root (…/nes-tetris-trainer), derived from this file's location. */
export const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * Install the Node WebSocket polyfill (supabase-js realtime needs it on Node 20)
 * and load the repo-root `.env` into `process.env` (without overwriting vars that
 * are already set). Call once before touching Supabase. Returns the repo root.
 */
export function loadRepoEnv(): string {
  Object.assign(globalThis, { WebSocket: (globalThis as { WebSocket?: unknown }).WebSocket ?? ws });
  for (const line of readFileSync(join(REPO_ROOT, '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const key = t.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return REPO_ROOT;
}

/**
 * A BetaTetris consensus judge that shells out to `engines/betatetris/consensus.py`
 * with the `BT_*` env it needs — writing the keys to a temp dir and reading back
 * the verdicts. `label` only flavours the temp-dir name.
 */
export function createBetaTetrisJudge(label = 'bt'): ConsensusJudge {
  const BT = join(REPO_ROOT, 'engines', 'betatetris');
  const btEnv = {
    ...process.env,
    BT_HOME: BT + '\\',
    BT_REPO_PY: join(BT, 'betatetris-tablebase', 'python'),
    BT_MODELS: join(BT, 'models'),
    BT_OUT: BT + '\\',
  };
  return async (rows) => {
    const dir = mkdtempSync(join(tmpdir(), `bt-${label}-`));
    const inPath = join(dir, 'keys.json');
    const outPath = join(dir, 'verdict.json');
    writeFileSync(inPath, JSON.stringify(rows));
    await new Promise<void>((resolve, reject) => {
      const ch = spawn('python', [join(BT, 'consensus.py'), inPath, outPath], { env: btEnv, stdio: ['ignore', 'inherit', 'inherit'] });
      ch.on('error', reject);
      ch.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`consensus.py exited ${c}`))));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- consensus.py's JSON is dynamic; a verdict may be missing for a row (treated as a BT error downstream).
    const raw = JSON.parse(readFileSync(outPath, 'utf8')) as any[];
    const byId = new Map(raw.map((v) => [v.id, v]));
    return rows.map((r) => byId.get((r as { id: unknown }).id));
  };
}

/** A StackRabbit client backed by a managed local engine process. */
export interface ManagedEngine {
  engine: StackRabbitClient;
  /** Ping :3000; (re)start engines/stackrabbit if down. False after too many crashes. */
  ensureEngine(): Promise<boolean>;
  /** Kill the engine THIS harness spawned (no-op if it was already running). */
  killEngine(): void;
}

/**
 * Manage a local StackRabbit on :3000. `ensureEngine()` pings and (re)starts the
 * engine if it's down (StackRabbit segfaults on messy boards), giving up after a
 * few consecutive crashes. Exit handlers clean up the spawned process. If a
 * StackRabbit is already running (e.g. started once by the orchestrator),
 * `ensureEngine` reuses it and `killEngine` leaves it alone — it only kills a
 * process this harness actually spawned.
 */
export function createManagedStackRabbit(): ManagedEngine {
  const engineUrl = process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000';
  const engine = new StackRabbitClient({ baseUrl: engineUrl });
  const srDir = join(REPO_ROOT, 'engines', 'stackrabbit');
  const srApp = join(srDir, 'built', 'src', 'server', 'app.js');
  const sr: { proc: ChildProcess | null } = { proc: null };
  let consecutiveCrashes = 0;
  const MAX_CONSECUTIVE_CRASHES = 5;

  function killEngine(): void {
    if (!sr.proc) return;
    const pid = sr.proc.pid;
    sr.proc.kill('SIGKILL');
    sr.proc = null;
    if (pid && process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
  }
  async function ensureEngine(): Promise<boolean> {
    if (await engine.ping()) { consecutiveCrashes = 0; return true; }
    consecutiveCrashes++;
    if (consecutiveCrashes > MAX_CONSECUTIVE_CRASHES) return false;
    killEngine();
    console.log(`(re)starting StackRabbit… (crash #${consecutiveCrashes})`);
    try {
      sr.proc = spawn(process.execPath, [srApp], { cwd: srDir, env: { ...process.env, PORT: '3000' }, stdio: 'ignore' });
      sr.proc.on('error', () => { sr.proc = null; });
      sr.proc.on('exit', () => { sr.proc = null; });
    } catch { return false; }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await engine.ping()) { consecutiveCrashes = 0; return true; }
    }
    return false;
  }
  process.on('exit', killEngine);
  process.on('SIGINT', () => { killEngine(); process.exit(1); });
  process.on('SIGTERM', () => { killEngine(); process.exit(1); });
  return { engine, ensureEngine, killEngine };
}

/**
 * Pull every ACTIVE puzzle's dedup key (`board` + pieces) from Supabase, paging
 * past PostgREST's 1000-row cap. The dedup pass feeds these to filterByConsensus.
 */
export async function loadActiveBankKeys(
  client: ReturnType<typeof createSupabaseClient>,
): Promise<BankKey[]> {
  const keys: BankKey[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('puzzles')
      .select('board, piece1, piece2')
      .eq('active', true)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) keys.push({ board: decodeBoard(r.board), piece1: r.piece1 as Piece, piece2: r.piece2 as Piece });
    if (!data || data.length < 1000) break;
  }
  return keys;
}
