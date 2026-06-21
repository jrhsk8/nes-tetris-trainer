/**
 * Offline puzzle-rating tally CLI (#41, v2 overhaul issue E). Recomputes every
 * attempted puzzle's Glicko-2 rating from the recorded `attempts` in proper
 * rating periods and writes the new ratings back. Engine-free. Run with:
 *
 *   npm run tally --workspace @trainer/generator
 *
 * Reads Supabase config from the environment (never committed):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 */

import { createDataAccess, createSupabaseClient } from '@trainer/data';
import { tallyBankRatings } from './pipeline/index.js';

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  const db = createDataAccess(createSupabaseClient(supabaseUrl, serviceKey));
  console.log('Recomputing puzzle ratings from the attempt log...');
  const result = await tallyBankRatings(db, (message) => console.log(`  ${message}`));

  console.log(
    `\nTallied ${result.attempts} attempts over ${result.puzzles} puzzles; ` +
      `updated ${result.updated} puzzle ratings.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
