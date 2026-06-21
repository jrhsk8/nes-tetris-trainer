-- Schema shared by the play app and the offline generator (#2).
-- See docs/PRD-v1.md, "Data model" and "Rating".
--
-- Apply with: psql "$DATABASE_URL" -f packages/data/schema.sql
-- Idempotent: safe to re-run.

-- Puzzles: the finished bank the play app reads and the generator writes.
create table if not exists public.puzzles (
  id uuid primary key default gen_random_uuid(),
  -- 200-char board encoding (row-major from the top); see @trainer/core board model.
  board text not null,
  piece1 text not null,
  piece2 text not null,
  -- The optimal two-ply line: [{rotation,col},{rotation,col}].
  optimal_line jsonb not null,
  -- Precomputed metrics of the optimal result board (holes, bumpiness, height...).
  optimal_metrics jsonb not null,
  -- Glicko-2 co-rating for the puzzle (flat seed at generation; drifts later).
  rating double precision not null default 1500,
  deviation double precision not null default 350,
  volatility double precision not null default 0.06,
  created_at timestamptz not null default now(),
  -- 200-char colour grid parallel to `board` (#28): '0' empty, '1'/'2'/'3' NES
  -- colour group.
  colors text,
  -- The ranked two-piece combo table (#33): { entries: [{rot1,col1,rot2,col2,
  -- score}], total }. `entries` is the top-K combos best-first (rank-1 scores
  -- 100); `total` is the count of all ranked combos found at generation, so the
  -- play app can report an exact rank or "too low to rank". Combo-threshold
  -- grading (#34) reads this; no engine runs at play time.
  combos jsonb,
  -- Deprecated value tables from the first overhaul (#29), superseded by
  -- `combos` (#33). Left nullable for legacy rows; no longer populated.
  first_values jsonb,
  second_values jsonb
);

-- Additive backfill for banks created before the 2026-06-20 colour/value regen.
alter table public.puzzles add column if not exists colors text;
alter table public.puzzles add column if not exists combos jsonb;
alter table public.puzzles add column if not exists first_values jsonb;
alter table public.puzzles add column if not exists second_values jsonb;

-- Per-user Glicko-2 rating (one row per user).
create table if not exists public.user_ratings (
  user_id uuid primary key,
  rating double precision not null default 1500,
  deviation double precision not null default 350,
  volatility double precision not null default 0.06,
  updated_at timestamptz not null default now()
);

-- Every attempt: the substrate from which puzzle ratings later drift.
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  puzzle_id uuid not null references public.puzzles (id) on delete cascade,
  -- The line the player actually played: [{rotation,col},{rotation,col}].
  user_line jsonb not null,
  solved boolean not null,
  -- The player's rating immediately after this attempt (the trend substrate, #13).
  rating_after double precision,
  created_at timestamptz not null default now()
);

-- Backfill the column for databases created before #13.
alter table public.attempts add column if not exists rating_after double precision;

create index if not exists attempts_user_id_idx on public.attempts (user_id);
create index if not exists attempts_puzzle_id_idx on public.attempts (puzzle_id);

-- Per-user preferences (one row per user): rebindable key bindings, synced
-- across devices like the rating (#24). `bindings` is an action→key JSON map.
create table if not exists public.user_prefs (
  user_id uuid primary key,
  bindings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row-level security. Puzzles are public, read-only content; writes go through
-- the service role (the offline generator), which bypasses RLS. The per-user
-- tables let an authenticated user read and write only their OWN rows (#13);
-- the service role still bypasses RLS for the generator and the round-trip test.
alter table public.puzzles enable row level security;
alter table public.user_ratings enable row level security;
alter table public.attempts enable row level security;
alter table public.user_prefs enable row level security;

drop policy if exists puzzles_public_read on public.puzzles;
create policy puzzles_public_read on public.puzzles
  for select using (true);

-- A user owns their rating row.
drop policy if exists user_ratings_select_own on public.user_ratings;
create policy user_ratings_select_own on public.user_ratings
  for select using (auth.uid() = user_id);

drop policy if exists user_ratings_insert_own on public.user_ratings;
create policy user_ratings_insert_own on public.user_ratings
  for insert with check (auth.uid() = user_id);

drop policy if exists user_ratings_update_own on public.user_ratings;
create policy user_ratings_update_own on public.user_ratings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A user owns their attempts (insert + read; no update/delete).
drop policy if exists attempts_select_own on public.attempts;
create policy attempts_select_own on public.attempts
  for select using (auth.uid() = user_id);

drop policy if exists attempts_insert_own on public.attempts;
create policy attempts_insert_own on public.attempts
  for insert with check (auth.uid() = user_id);

-- A user owns their preferences (read + insert + update; no delete).
drop policy if exists user_prefs_select_own on public.user_prefs;
create policy user_prefs_select_own on public.user_prefs
  for select using (auth.uid() = user_id);

drop policy if exists user_prefs_insert_own on public.user_prefs;
create policy user_prefs_insert_own on public.user_prefs
  for insert with check (auth.uid() = user_id);

drop policy if exists user_prefs_update_own on public.user_prefs;
create policy user_prefs_update_own on public.user_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
