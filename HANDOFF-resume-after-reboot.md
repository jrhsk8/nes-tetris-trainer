# HANDOFF — Resume the consensus-bank run after reboot

> The 2026-06-21 consensus-bank AFK run (#51–#54) OOM-crashed mid-#53; the loop was
> hardened and the machine rebooted to free host RAM. This is the single-doc resume guide.
> It supersedes the retired `HANDOFF-consensus-bank.md` + `FINDINGS-betatetris-spike.md`
> (their durable content now lives in `docs/decisions.md` and `betatetris-spike/README.md`).

## State at handoff

- **WSL canonical repo** `/home/dev/nes-tetris-trainer`, `main` tip **`6e4c10d`**, **UNPUSHED**.
  Nothing pushed or deployed. (The Windows clone is behind at `5128b6e` and reconciles on the
  next push — see `/push-deploy-sandcastle`.)
- **#51** ✅ done + **closed** — graded reward curve (`scoreToOutcome`), commit `59eec9e`, on main.
- **#52** ⚠️ committed (`10f28b5`, on main) but issue still **OPEN**. It's a regen issue, so the
  live-DB bank reshape may not have run. RALPH will re-pick it: confirm the difficulty-band code
  is present, run/verify the bank regen, then close. **Watch that it doesn't redo from scratch.**
- **#53** ❌ not done — OOM hit mid-edit (it had added an optional `rateMoveDeep?` to
  `GeneratorEngine` in `generator/src/pipeline/generate.ts`); no commit, worker branch discarded.
- **#54** ❌ not started.
- Live bank currently **309** puzzles.

## Why it crashed (don't repeat it)

- OOM (`exit 137`): the **host** was oversubscribed (~0.1 GB available / 88.6% commit) by other
  apps — Firefox (~8 GB), VirtualBox VMs (~4 GB), the Cowork Hyper-V VM (~4 GB), VSCode — **not**
  WSL (only ~2.5 GB). The agent grew toward WSL's 12 GB cap with no physical RAM to back it; the
  OOM killer fired and took the launcher tree down too (which stranded #51/#52 on a worker branch
  until they were `merge --ff-only`'d back onto main).
- **Hardening already applied** (commit `6e4c10d`): `maxIterations 25 → 1` (each issue runs in a
  fresh process, so RAM resets between issues *and* each issue merges to HEAD as its process exits
  — a later crash can no longer strand earlier work) + `run-afk.sh MAX_RESTARTS 6 → 40`.
- **NOT applied this round (owner's call):** `.wslconfig` stays `memory=12GB`/`swap=8GB`; no
  `run-afk.ps1` pre-flight RAM gate. So the reboot + `maxIterations=1` are the protection —
  **don't run a heavy desktop (Firefox/VMs) concurrently with the run.**

## Resume steps (after reboot)

1. **Start Docker Desktop** and wait until `docker info` works (WSL `docker` talks to it; the run
   needs the StackRabbit + BetaTetris engines from the image).
2. **Confirm the repo:** `wsl -d Ubuntu -u dev -- bash -lc 'cd ~/nes-tetris-trainer && git log --oneline -3 && git status --porcelain'`
   → expect tip **`6e4c10d`**, clean (one untracked `run-afk.sh.bak-*` is fine).
3. **Check host RAM headroom:** PowerShell `Get-Counter '\Memory\Available MBytes'` → want several GB free before launching.
4. **Back up the bank** (defensive; #52/#53 reshape it) via the image's psql:
   `create table if not exists puzzles_bak_<date> as select * from puzzles;`.
   **Never drop any `*_bak_*` or `*_quarantine_*` table.**
5. **Launch:** from a dedicated PowerShell window, `.\.sandcastle\run-afk.ps1`. It reads open issues
   live (#52, #53, #54) and works them one fresh process at a time.
6. **Watch:** `.sandcastle/logs/afk-<TS>.summary.log` + the per-worker log. Each issue commits and
   merges to `main` as its process exits.

## Per-issue notes (the incomplete, implementation-relevant bits)

### #52 — difficulty bands by answer-set tightness (committed; must verify regen + close)
Code is on main (`10f28b5`). Remaining: the **bank regen** that applies the bands, then close.
Regen is additive in form — `boardKey`s/placements unchanged; only which candidates survive and
their scores/difficulty change. Bucket by measured `acceptCount` (hard = ≤ ~2 acceptable answers);
generation deliberately spans easy→hard.

### #53 — deeper-StackRabbit best-confirm (not started)
Confirm rank-1 with a **deeper** StackRabbit search (`playoutCount > 0`) vs today's eval-only value;
re-rank/reject eval-only quirks. This is the correct tool for "is this the best *by our objective*"
(a same-objective deeper search). Re-implement the lost `rateMoveDeep?` on `GeneratorEngine`.
Reshapes the bank → regen (incorporates #52 if both run in one launch).

### #54 — BetaTetris true-consensus (do **LAST**; autonomous)
Depends on #52 bands + #53 deeper-confirmed optimal. Autonomous now (BetaTetris baked into the image).
- **Run via `bt-run`** in the `bt` env: `bt-run python betatetris-spike/pull.py && bt-run python betatetris-spike/compare.py`.
  Paths in env (`BT_HOME`/`BT_REPO_PY`/`BT_MODELS`/`BT_OUT`); `DATABASE_URL` in the process env.
  If the BetaTetris env smoke-check failed at sandbox start → **blocker comment, move on** (don't thrash).
- **Phase 1 FIRST = measure the keep-rate**, post the number on #54. Build the Phase-2 generation
  gate ONLY if the rate is workable (a smaller, more tactical bank is acceptable).
- **CRITICAL framing (the spike's result):** BetaTetris matches our optimal **0/33** exact and
  **0/33** in top-30 — a *legitimate* objective difference (it maximizes expected whole-game score
  with deep lookahead; we optimize a static 2-ply eval). A naïve exact-agreement keep-rate is ~0 and
  useless. Phase 1 must measure a **softer signal**: is our deeper-confirmed (#53) optimal *high in*
  BetaTetris's policy/value — not exactly its top pick. If even the softened rate is ~0, the
  consensus bank is **not viable** → comment + leave open. A blanket gate is **NO-GO** and would
  preferentially delete the *hardest/tightest* puzzles.
- **Adapter gotchas** (also in `betatetris-spike/README.md`): board convention is **1=empty / 0=filled**
  (inverse of our `'1'=filled`), row-major from top; pieces pass by **letter** (`'T'→0 … 'I'→6`);
  `Reset` needs `(10*lines+filled)%4==0` (use level 18, lines 0/1); `str(Board)` omits empty top rows
  (place rows by printed index); piece-2's true next is unknown → sweep all 7. Board injection was
  validated 33/33.
- **Guardrail:** BetaTetris is **GPLv3** + offline/generator-only — vendored only into the private,
  never-distributed sandcastle image; never linked into or shipped with the play app.

## After the run

- Review, then **push + redeploy** via the **`/push-deploy-sandcastle`** skill (manual; deploy never
  auto). That push carries the hardening (`6e4c10d`), recovered #51/#52, these doc changes (incl. the
  two file deletions), and whatever RALPH adds; the Windows clone reconciles in that flow.
- Drop the `*_bak_*` / `*_quarantine_*` snapshot tables only once confident.

## Pointers

- **Design rationale / verdict:** `docs/decisions.md` → "2026-06-21 — Consensus bank" + "BetaTetris baked into the sandcastle image".
- **BetaTetris harness / reproduce / adapter gotchas:** `betatetris-spike/README.md`.
- **Run config:** `.sandcastle/{prompt.md, main.mts, run-afk.sh, Dockerfile}`.
- **Memory:** `sandcastle-afk-goal`, `sandcastle-afk-setup`, `wsl-memory-cap`, `betatetris-spike-outcome`.
