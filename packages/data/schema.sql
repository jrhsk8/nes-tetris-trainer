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
  created_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
);

create index if not exists attempts_user_id_idx on public.attempts (user_id);
create index if not exists attempts_puzzle_id_idx on public.attempts (puzzle_id);

-- Row-level security. Puzzles are public, read-only content; writes go through
-- the service role (the offline generator), which bypasses RLS. Per-user tables
-- get their authenticated-user policies in #13 (auth); until then the service
-- role is the only writer/reader, which is enough for the generator and the
-- #2 round-trip test.
alter table public.puzzles enable row level security;
alter table public.user_ratings enable row level security;
alter table public.attempts enable row level security;

drop policy if exists puzzles_public_read on public.puzzles;
create policy puzzles_public_read on public.puzzles
  for select using (true);
