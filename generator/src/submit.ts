/**
 * Offline submission-processing CLI (#45) — OCR pending screenshot submissions,
 * solve them through the generation pipeline, and bank or reject each. Run with:
 *
 *   npm run submit --workspace @trainer/generator
 *
 * Reads engine + Supabase config from the environment (never committed):
 *   STACKRABBIT_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 * The service role bypasses RLS to read all pending rows and update status.
 */

import { createDataAccess, createSupabaseClient } from '@trainer/data';
import { StackRabbitClient } from './engine/index.js';
import { processSubmissions } from './submissions.js';

async function main(): Promise<void> {
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

  console.log('Processing pending submissions...');
  const result = await processSubmissions({
    db,
    engine,
    onProgress: (message) => console.log(`  ${message}`),
  });

  console.log(
    `\nProcessed ${result.processed}: banked ${result.banked}, rejected ${result.rejected}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
