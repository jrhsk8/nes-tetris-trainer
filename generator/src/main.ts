/**
 * Offline generation CLI (#9) — drives the local StackRabbit engine to produce
 * a bank of stored puzzles (docs/PRD-v1.md, "Generation"). Run with:
 *
 *   npm run start --workspace @trainer/generator -- --count 20 --max 2000
 *
 * Reads engine + Supabase config from the environment (never committed):
 *   STACKRABBIT_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 */

import { createDataAccess, createSupabaseClient } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import { SelfPlayBoardSource } from './selfplay/index.js';
import { generateBank } from './pipeline/index.js';

interface CliArgs {
  count: number;
  max: number;
  floor?: number;
  replace: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { count: 20, max: 2000, replace: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case '--count':
        args.count = Number.parseInt(value, 10);
        i++;
        break;
      case '--max':
        args.max = Number.parseInt(value, 10);
        i++;
        break;
      case '--floor':
        // Board-health floor (#33): tune candidate cleanliness vs. yield.
        args.floor = Number.parseFloat(value);
        i++;
        break;
      case '--replace':
        // Replace the whole bank (delete existing puzzles + their attempts)
        // before inserting the freshly generated set.
        args.replace = true;
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const engineUrl = process.env.STACKRABBIT_URL ?? 'http://127.0.0.1:3000';
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  const engine = new StackRabbitClient({ baseUrl: engineUrl });
  if (!(await engine.ping())) {
    throw new Error(`StackRabbit engine not reachable at ${engineUrl}`);
  }

  const db = createDataAccess(createSupabaseClient(supabaseUrl, serviceKey));
  const source = new SelfPlayBoardSource(engine);

  console.log(
    `Generating up to ${args.count} puzzles (max ${args.max} candidates)` +
      `${args.replace ? ', replacing the existing bank' : ''}...`,
  );
  const result = await generateBank(
    { source, engine, db },
    {
      targetCount: args.count,
      maxCandidates: args.max,
      replace: args.replace,
      config: args.floor !== undefined ? { healthFloor: args.floor } : undefined,
      onProgress: (message) => console.log(`  ${message}`),
    },
  );

  console.log(
    `\nStored ${result.stored.length} puzzles from ${result.candidatesTried} candidates.`,
  );
  console.log('Rejections by reason:');
  for (const [reason, count] of Object.entries(result.rejections).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
