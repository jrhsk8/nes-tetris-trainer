/**
 * Tuck / spin / spintuck puzzle generator — produces engine-validated puzzles
 * where the optimal move requires a tuck or spin, using realistic self-play
 * boards and the full quality-gate pipeline.
 *
 * Strategy:
 * 1. Tuck-aware self-play: applies the engine's actual moves (including tucks)
 *    so boards develop natural overhangs — unlike normal self-play which falls
 *    back to random hard-drops when the engine recommends a tuck.
 * 2. Multi-pair sweep: for each board, tries ALL 49 piece pairs with a fast
 *    input timeline (X.) to maximize chances of finding tuck/spin optimal moves.
 * 3. Full pipeline: assemblePuzzle with all quality gates, real engine scores.
 * 4. Filter: only keeps puzzles where the rank-1 combo involves a tuck or spin.
 *
 * Run:
 *   npx tsx generator/src/tuck-gen.ts [--count N] [--max N] [--dry-run] [--consensus]
 *
 * Requires: StackRabbit at STACKRABBIT_URL (default 127.0.0.1:3000)
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  PIECES,
  COLS,
  ORIENTATIONS,
  applyPlacement,
  cloneBoard,
  emptyBoard,
  emptyColorGrid,
  decodeBoard,
  maneuver,
  lockAndClear,
  type ColorGrid,
  type Grid,
  type Piece,
  type Placement,
} from '@trainer/core';
import { createDataAccess, createSupabaseClient } from '@trainer/data';
import type { NewPuzzle } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import { toHardDropPlacement } from './selfplay/self-play.js';
import type { Candidate } from './selfplay/board-source.js';
import {
  assemblePuzzle,
  type GenerationConfig,
  DEFAULT_GENERATION_CONFIG,
} from './pipeline/generate.js';
import { restingLineForEntry } from '@trainer/core';
import { betaTetrisJudge, filterByConsensus } from './pipeline/consensus.js';
import { isNearDuplicate, type BankKey } from './pipeline/dedup.js';

const TIMELINE = 'X.';
const LEVEL = 18;
const LINES = 0;

// ── Tuck-aware self-play ────────────────────────────────────────────────────

function randomPiece(): Piece {
  return PIECES[Math.floor(Math.random() * PIECES.length)];
}

function enumerateLegalMoves(board: Grid, piece: Piece): Placement[] {
  const moves: Placement[] = [];
  for (let rotation = 0; rotation < ORIENTATIONS[piece].length; rotation++) {
    for (let col = 0; col < COLS; col++) {
      try {
        applyPlacement(board, piece, { rotation, col });
        moves.push({ rotation, col });
      } catch { continue; }
    }
  }
  return moves;
}

/**
 * Build a mid-game board via self-play. Unlike normal self-play, when the
 * engine recommends a tuck (toHardDropPlacement returns null), we apply the
 * engine's resulting board directly and reconstruct colors approximately.
 * This builds boards with natural overhangs.
 */
async function buildBoard(engine: StackRabbitClient): Promise<Grid> {
  const depth = 6 + Math.floor(Math.random() * 19); // 6–24
  const noiseRate = 0.08;

  let board = emptyBoard();

  for (let i = 0; i < depth; i++) {
    const current = randomPiece();
    const next = randomPiece();
    const useEngine = Math.random() >= noiseRate;

    if (useEngine) {
      try {
        const move = await engine.getBestMove({
          board,
          currentPiece: current,
          nextPiece: next,
          level: LEVEL,
          lines: LINES,
          inputFrameTimeline: TIMELINE,
        });
        if (move) {
          const placement = toHardDropPlacement(board, current, move.board);
          if (placement) {
            try {
              board = applyPlacement(board, current, placement);
            } catch {
              board = move.board;
            }
          } else {
            board = move.board;
          }
          continue;
        }
      } catch {
        // Engine crash during self-play — fall through to random move
      }
    }

    // Random fallback
    const moves = enumerateLegalMoves(board, current);
    if (moves.length === 0) break;
    const move = moves[Math.floor(Math.random() * moves.length)];
    try {
      board = applyPlacement(board, current, move);
    } catch {
      break;
    }
  }

  return board;
}

/**
 * Build a simple color grid from a binary board — assigns colors in a
 * deterministic pattern per cell. Not perfect but visually reasonable.
 */
function syntheticColors(board: Grid): ColorGrid {
  const colors = emptyColorGrid();
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      if (board[r][c]) {
        colors[r][c] = (((r * 7 + c * 3) % 3) + 1) as 1 | 2 | 3;
      }
    }
  }
  return colors;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

interface CliArgs {
  count: number;
  maxBoards: number;
  dryRun: boolean;
  consensus: boolean;
  spinOnly: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { count: 20, maxBoards: 5000, dryRun: false, consensus: false, spinOnly: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--count': args.count = Number.parseInt(argv[++i], 10); break;
      case '--max': args.maxBoards = Number.parseInt(argv[++i], 10); break;
      case '--dry-run': args.dryRun = true; break;
      case '--consensus': args.consensus = true; break;
      case '--spin-only': args.spinOnly = true; break;
    }
  }
  return args;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !key) throw new Error('SUPABASE_URL + service key required');

  const client = createSupabaseClient(supabaseUrl, key);
  const db = createDataAccess(client);
  const engineUrl = process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000';
  const engine = new StackRabbitClient({ baseUrl: engineUrl });

  // Auto-start StackRabbit if not already running
  // import.meta.url is generator/src/tuck-gen.ts → up 3 levels to repo root
  const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const srDir = join(repoRoot, 'engines', 'stackrabbit');
  const srApp = join(srDir, 'built', 'src', 'server', 'app.js');
  const sr: { proc: ChildProcess | null } = { proc: null };
  let consecutiveCrashes = 0;
  const MAX_CONSECUTIVE_CRASHES = 5;

  function killEngine(): void {
    if (!sr.proc) return;
    const pid = sr.proc.pid;
    sr.proc.kill('SIGKILL');
    sr.proc = null;
    // On Windows, kill the process tree (worker threads)
    if (pid && process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
  }

  async function ensureEngine(): Promise<boolean> {
    if (await engine.ping()) { consecutiveCrashes = 0; return true; }
    consecutiveCrashes++;
    if (consecutiveCrashes > MAX_CONSECUTIVE_CRASHES) {
      console.log(`engine crashed ${consecutiveCrashes} times in a row, giving up`);
      return false;
    }
    killEngine();
    console.log(`(re)starting StackRabbit… (crash #${consecutiveCrashes})`);
    try {
      sr.proc = spawn(process.execPath, [srApp], {
        cwd: srDir,
        env: { ...process.env, PORT: '3000' },
        stdio: 'ignore',
      });
      sr.proc.on('error', () => { sr.proc = null; });
      sr.proc.on('exit', () => { sr.proc = null; });
    } catch {
      return false;
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await engine.ping()) { consecutiveCrashes = 0; return true; }
    }
    return false;
  }

  // Clean up engine on exit so orphans don't linger
  process.on('exit', killEngine);
  process.on('SIGINT', () => { killEngine(); process.exit(1); });
  process.on('SIGTERM', () => { killEngine(); process.exit(1); });

  if (!(await ensureEngine())) throw new Error(`StackRabbit not reachable at ${engineUrl}`);
  console.log(`engine alive at ${engineUrl}`);

  // Load existing bank keys for dedup
  const { data: existing } = await client
    .from('puzzles')
    .select('board, piece1, piece2')
    .eq('active', true);
  const existingKeys: BankKey[] = (existing ?? []).map((r: any) => ({
    board: decodeBoard(r.board),
    piece1: r.piece1,
    piece2: r.piece2,
  }));
  console.log(`loaded ${existingKeys.length} existing puzzle keys for dedup`);

  // Pipeline config: fast timeline, relaxed holes (overhangs create covered holes)
  const config: GenerationConfig = {
    ...DEFAULT_GENERATION_CONFIG,
    valuationTimeline: TIMELINE,
    maxHoles: 2,
    varietyLane: { maxHoles: 3, maxBumpiness: 20, fraction: 0.5 },
  };

  const survivors: NewPuzzle[] = [];
  const acceptedKeys: BankKey[] = [...existingKeys];
  const rejections: Record<string, number> = {};
  let boardsTried = 0;
  let candidatesTried = 0;
  let tuckSpinFound = 0;

  console.log(`target: ${args.count} tuck/spin puzzles, max ${args.maxBoards} boards\n`);

  while (survivors.length < args.count && boardsTried < args.maxBoards) {
    if (!(await ensureEngine())) {
      if (consecutiveCrashes > MAX_CONSECUTIVE_CRASHES) {
        console.log('too many consecutive engine crashes — aborting');
        break;
      }
      console.log('engine dead, waiting 5s…');
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const board = await buildBoard(engine);
    boardsTried++;

    // Try all 49 piece pairs on this board
    for (const p1 of PIECES) {
      for (const p2 of PIECES) {
        if (survivors.length >= args.count) break;

        const candidate: Candidate = {
          board: cloneBoard(board),
          colors: syntheticColors(board),
          currentPiece: p1,
          nextPiece: p2,
          level: LEVEL,
          lines: LINES,
        };
        candidatesTried++;

        let result;
        try {
          result = await assemblePuzzle(engine, candidate, config);
        } catch (err) {
          // Engine crash during sweep — skip this candidate, restart engine
          rejections['engine-crash'] = (rejections['engine-crash'] ?? 0) + 1;
          await ensureEngine();
          break; // skip remaining pairs for this board
        }
        if (!result.ok) {
          rejections[result.reason] = (rejections[result.reason] ?? 0) + 1;
          continue;
        }

        // Check if rank-1 involves a tuck/spin
        const rank1 = result.puzzle.combos!.entries[0];
        const line = restingLineForEntry(board, p1, p2, rank1);
        if (!line) {
          rejections['no-line-reconstruction'] = (rejections['no-line-reconstruction'] ?? 0) + 1;
          continue;
        }

        const m1 = maneuver(board, p1, line.p1);
        const a = lockAndClear(board, p1, line.p1);
        const m2 = maneuver(a.board, p2, line.p2);

        const hasTuck = m1 === 'tuck' || m2 === 'tuck';
        const hasSpin = m1 === 'spin' || m2 === 'spin';
        if (!hasTuck && !hasSpin) {
          rejections['not-tuck-spin'] = (rejections['not-tuck-spin'] ?? 0) + 1;
          continue;
        }
        if (args.spinOnly && !hasSpin) {
          rejections['tuck-only-skipped'] = (rejections['tuck-only-skipped'] ?? 0) + 1;
          continue;
        }

        // Dedup check
        const dupKey: BankKey = { board, piece1: p1, piece2: p2 };
        if (isNearDuplicate(dupKey, acceptedKeys, config.dedupMaxHamming)) {
          rejections['duplicate'] = (rejections['duplicate'] ?? 0) + 1;
          continue;
        }
        acceptedKeys.push(dupKey);

        tuckSpinFound++;
        const kind = hasSpin ? (hasTuck ? 'spintuck' : 'spin') : 'tuck';
        const tags = result.puzzle.tags ?? [];
        console.log(
          `  #${tuckSpinFound} ${p1}+${p2} ${kind} [${tags.join(',')}] ` +
          `(board ${boardsTried}, candidate ${candidatesTried})`
        );

        survivors.push(result.puzzle);
      }
      if (survivors.length >= args.count) break;
    }

    if (boardsTried % 50 === 0) {
      console.log(
        `progress: ${boardsTried} boards, ${candidatesTried} candidates, ` +
        `${survivors.length}/${args.count} tuck/spin found`
      );
    }
  }

  console.log(
    `\ngeneration done: ${boardsTried} boards, ${candidatesTried} candidates, ` +
    `${survivors.length} tuck/spin puzzles found`
  );

  // BetaTetris consensus filter
  let finalSurvivors = survivors;
  if (args.consensus && survivors.length > 0) {
    console.log(`\nrunning BetaTetris consensus on ${survivors.length} survivors…`);
    const btRunner = process.platform === 'win32'
      ? new URL('../../engines/betatetris/bt-run.cmd', import.meta.url).pathname.replace(/^\//, '')
      : 'bt-run';
    const judge = betaTetrisJudge({ runner: btRunner });
    const result = await filterByConsensus(survivors, judge);
    finalSurvivors = result.kept as NewPuzzle[];
    console.log(
      `consensus: kept ${result.kept.length}/${survivors.length} ` +
      `(rate=${(result.keepRate * 100).toFixed(0)}%, bt-errors=${result.btErrors})`
    );
  }

  // Rejection summary
  console.log('\nrejection reasons:');
  for (const [reason, count] of Object.entries(rejections).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  if (args.dryRun) {
    console.log(`\n--dry-run: would insert ${finalSurvivors.length} puzzles`);
    for (const p of finalSurvivors) {
      console.log(`  ${p.piece1}+${p.piece2} tags=[${(p.tags ?? []).join(',')}]`);
    }
  } else if (finalSurvivors.length > 0) {
    const stored = await db.insertPuzzles(finalSurvivors);
    console.log(`\ninserted ${stored.length} tuck/spin puzzles`);
    for (const p of stored) {
      console.log(`  #${p.number} ${p.piece1}+${p.piece2} tags=[${(p.tags ?? []).join(',')}]`);
    }
  } else {
    console.log('\nno tuck/spin puzzles survived — try increasing --max');
  }

  killEngine();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
