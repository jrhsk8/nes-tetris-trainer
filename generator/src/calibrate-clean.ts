/**
 * #66 calibration: measure the strict-clean default + variety lane against the
 * live StackRabbit engine WITHOUT writing the bank. Confirms yield and the
 * ~20% variety split before the single re-bank. Run:
 *   npx tsx generator/src/calibrate-clean.ts [targetCount] [maxCandidates]
 */

import type { NewPuzzle, Puzzle } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import { SelfPlayBoardSource } from './selfplay/index.js';
import { generateBank } from './pipeline/index.js';

async function main(): Promise<void> {
  const target = Number.parseInt(process.argv[2] ?? '40', 10);
  const maxCandidates = Number.parseInt(process.argv[3] ?? '1200', 10);
  const engineUrl = process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000';
  const engine = new StackRabbitClient({ baseUrl: engineUrl });
  if (!(await engine.ping())) throw new Error(`engine not reachable at ${engineUrl}`);

  // Discard-only db: never persists; the calibration only inspects the summary.
  const db = {
    async insertPuzzles(puzzles: NewPuzzle[]): Promise<Puzzle[]> {
      return puzzles as unknown as Puzzle[];
    },
  };

  const source = new SelfPlayBoardSource(engine);
  console.log(`Calibrating: target ${target}, max ${maxCandidates} candidates...`);
  const result = await generateBank(
    { source, engine, db },
    { targetCount: target, maxCandidates, onProgress: () => {} },
  );

  const tried = result.candidatesTried;
  console.log(`\nStored ${result.stored.length} from ${tried} candidates (yield ${(result.stored.length / tried * 100).toFixed(1)}%).`);
  console.log(`Lane split: strict ${result.byLane.strict} / variety ${result.byLane.variety} ` +
    `(variety ${(result.byLane.variety / Math.max(1, result.stored.length) * 100).toFixed(1)}%).`);
  console.log(`Bands: easy ${result.byBand.easy} / medium ${result.byBand.medium} / hard ${result.byBand.hard}.`);
  console.log('Rejections by reason:');
  for (const [reason, count] of Object.entries(result.rejections).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
