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
  -- Each `entries` element also carries a canonical `boardKey` (the resulting
  -- locked cells after both placements; see @trainer/core `boardKey`) once the
  -- v2 regen (#40/#41) populates it — used for outcome-by-board matching (#42).
  -- `combos` is jsonb, so that is a data change, not a column change.
  combos jsonb,
  -- v2 difficulty (#40): raw inputs to the seed rating. `accept_count` is the
  -- number of combos scoring ≥ 95; `margin` is the score gap between the best
  -- combo and the best one below the accept threshold. Null for legacy rows.
  accept_count int,
  margin double precision,
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
-- v2 overhaul (#38): per-puzzle difficulty inputs (issue D populates them).
alter table public.puzzles add column if not exists accept_count int;
alter table public.puzzles add column if not exists margin double precision;

-- #49: stable, human-friendly puzzle number (1, 2, 3 …) — the title + share key.
-- Additive + idempotent: re-running this block is safe.
alter table public.puzzles add column if not exists number int;

-- Backfill any unnumbered rows deterministically by CREATION order (not physical
-- row order), continuing past the current max so a re-run never collides.
update public.puzzles p
set number = base.m + ranked.rn
from
  (
    select id, row_number() over (order by created_at asc, id asc) as rn
    from public.puzzles
    where number is null
  ) ranked,
  (select coalesce(max(number), 0) as m from public.puzzles) base
where p.id = ranked.id;

-- A sequence assigns numbers to NEW inserts (the generator insert path), starting
-- just past the current max so generator inserts never collide with the backfill.
create sequence if not exists public.puzzles_number_seq;
select setval(
  'public.puzzles_number_seq',
  coalesce((select max(number) from public.puzzles), 0) + 1,
  false
);
alter table public.puzzles alter column number set default nextval('public.puzzles_number_seq');
alter sequence public.puzzles_number_seq owned by public.puzzles.number;

-- Enforce uniqueness + not-null now that every row is numbered.
create unique index if not exists puzzles_number_key on public.puzzles (number);
alter table public.puzzles alter column number set not null;

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
  -- The attempt's 0–100 combo quality score (#51); null for unranked/legacy rows.
  score double precision,
  -- The player's rating immediately after this attempt (the trend substrate, #13).
  rating_after double precision,
  created_at timestamptz not null default now()
);

-- Backfill the column for databases created before #13.
alter table public.attempts add column if not exists rating_after double precision;
-- Backfill the graded-quality score column for databases created before #51.
alter table public.attempts add column if not exists score double precision;

create index if not exists attempts_user_id_idx on public.attempts (user_id);
create index if not exists attempts_puzzle_id_idx on public.attempts (puzzle_id);

-- Per-user preferences (one row per user): rebindable key bindings, synced
-- across devices like the rating (#24). `bindings` is an action→key JSON map.
-- `muted` toggles the NES result chiptune (#61); sound is on by default.
create table if not exists public.user_prefs (
  user_id uuid primary key,
  bindings jsonb not null default '{}'::jsonb,
  muted boolean not null default false,
  updated_at timestamptz not null default now()
);

-- #61: existing deployments add the sound-mute column (idempotent).
alter table public.user_prefs add column if not exists muted boolean not null default false;

-- Screenshot submission queue (#45, v2 overhaul issue I). The play app uploads a
-- board screenshot to Storage and enqueues a row here (status 'pending'); the
-- OFFLINE pipeline pulls pending rows, OCRs the grid, solves, and banks or
-- rejects (engine never deployed). `image_path` is the Storage object path,
-- `parsed` the OCR result, `reason` the rejection reason when status='rejected'.
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  image_path text not null,
  submitter uuid,
  -- 'pending' | 'banked' | 'rejected'.
  status text not null default 'pending',
  reason text,
  parsed jsonb,
  created_at timestamptz not null default now()
);

create index if not exists submissions_status_idx on public.submissions (status);

-- Dev in-play curation (#72) ------------------------------------------------
--
-- Curator allowlist. This table IS the allowlist: a row grants its `user_id`
-- the curator controls (flag + soft-delete) — enforced in RLS below, NOT trusted
-- from the client (a cull mutates the shared bank). It is the ONLY thing a future
-- owner edits to grant access, with ZERO code change.
--
--   ADD A CURATOR LATER (one data step, no deploy):
--     insert into public.curators (user_id, note)
--     values ('<the auth.uid() of the account>', 'me');
--   (find the uid in Supabase Auth, or via select auth.uid() while signed in.)
--   Remove access with a matching delete. No UID is hardcoded anywhere.
--
-- EMPTY-SAFE: with no rows, every curator-gated policy below evaluates to false,
-- so the curation UI/actions are simply inert/hidden and normal play is wholly
-- unaffected (no errors, no broken RLS).
create table if not exists public.curators (
  user_id uuid primary key,
  email text,
  note text,
  created_at timestamptz not null default now()
);

-- Soft-delete flag (#72): culled puzzles set this false; matchmaking filters
-- `active = true`. Additive + idempotent; existing rows backfill to true.
alter table public.puzzles add column if not exists active boolean not null default true;

-- Append-only curation log (#72): a flag (free-text comment, for later pattern
-- mining of "what makes puzzles boring") or a cull (soft-delete). No update/
-- delete policy ⇒ append-only.
create table if not exists public.puzzle_flags (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.puzzles (id) on delete cascade,
  user_id uuid not null,
  -- 'flag' (keep live, note it) | 'cull' (soft-delete, set active=false).
  action text not null check (action in ('flag', 'cull')),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists puzzle_flags_puzzle_idx on public.puzzle_flags (puzzle_id);

-- Storage bucket for submission images (#45/#67): PRIVATE (offline pipeline
-- reads via the service role), restricted to PNG/JPEG up to 5 MB. The mime/size
-- caps are enforced by Storage itself, before any byte reaches the bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 5242880, array['image/png', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Row-level security. Puzzles are public, read-only content; writes go through
-- the service role (the offline generator), which bypasses RLS. The per-user
-- tables let an authenticated user read and write only their OWN rows (#13);
-- the service role still bypasses RLS for the generator and the round-trip test.
alter table public.puzzles enable row level security;
alter table public.user_ratings enable row level security;
alter table public.attempts enable row level security;
alter table public.user_prefs enable row level security;
alter table public.submissions enable row level security;
alter table public.curators enable row level security;
alter table public.puzzle_flags enable row level security;

drop policy if exists puzzles_public_read on public.puzzles;
create policy puzzles_public_read on public.puzzles
  for select using (true);

-- Curation (#72): an allowlisted curator (a row in `curators`) may soft-delete a
-- puzzle (update `active`) and append to the flag log; everyone else is denied by
-- RLS regardless of client. The allowlist subquery is empty-safe — with no
-- curators it is false for all, so curation is inert and play is unaffected.
-- Mirrors the submissions allowlist/own-row pattern above.

-- A user can read their OWN curator row, so the client can self-detect whether to
-- reveal the dev controls (no row ⇒ not a curator ⇒ controls hidden).
drop policy if exists curators_select_own on public.curators;
create policy curators_select_own on public.curators
  for select using (auth.uid() = user_id);

-- A curator may update puzzles (used to set active=false on a cull). The service
-- role (generator) bypasses RLS as before.
drop policy if exists puzzles_curator_update on public.puzzles;
create policy puzzles_curator_update on public.puzzles
  for update
  using (auth.uid() in (select user_id from public.curators))
  with check (auth.uid() in (select user_id from public.curators));

-- A curator may append to the flag log (own user_id) and read it back.
drop policy if exists puzzle_flags_curator_insert on public.puzzle_flags;
create policy puzzle_flags_curator_insert on public.puzzle_flags
  for insert
  with check (
    auth.uid() = user_id
    and auth.uid() in (select user_id from public.curators)
  );

drop policy if exists puzzle_flags_curator_select on public.puzzle_flags;
create policy puzzle_flags_curator_select on public.puzzle_flags
  for select using (auth.uid() in (select user_id from public.curators));

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

-- A submitter owns their submissions (insert + read; the offline pipeline uses
-- the service role to read all pending rows and update status, bypassing RLS).
-- Submitting requires a NON-anonymous account (#67): anonymous play can read its
-- own rows but cannot enqueue a submission.
drop policy if exists submissions_insert_own on public.submissions;
create policy submissions_insert_own on public.submissions
  for insert with check (
    auth.uid() = submitter
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists submissions_select_own on public.submissions;
create policy submissions_select_own on public.submissions
  for select using (auth.uid() = submitter);

-- Per-user PENDING-submission quota (#67): cap how many un-processed submissions
-- one account can queue, so a single user cannot flood the offline pipeline. The
-- count runs SECURITY DEFINER so it sees all of the submitter's rows past RLS.
create or replace function public.enforce_submission_quota()
returns trigger as $$
declare
  pending_count int;
begin
  select count(*) into pending_count
    from public.submissions
    where submitter = new.submitter and status = 'pending';
  if pending_count >= 5 then
    raise exception 'submission quota exceeded: at most 5 pending submissions per user';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists submissions_quota on public.submissions;
create trigger submissions_quota
  before insert on public.submissions
  for each row execute function public.enforce_submission_quota();

-- Storage policies for the submissions bucket (#67): a NON-anonymous session may
-- upload ONLY under its own `auth.uid()/` path prefix and read back only its own
-- objects. The offline pipeline reads via the service role (bypasses these).
drop policy if exists submissions_storage_insert on storage.objects;
create policy submissions_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and name like (auth.uid()::text || '/%')
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists submissions_storage_select on storage.objects;
create policy submissions_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'submissions' and owner = auth.uid());
