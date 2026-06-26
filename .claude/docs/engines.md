# Engines — operating StackRabbit & BetaTetris

Both engines are **offline / generator-only** — never deployed, never imported by the play app. StackRabbit is MIT; BetaTetris is GPLv3 (distribution triggers obligations; this build never distributes).

---

## StackRabbit

C++ AI engine behind an Express HTTP server. Evaluates NES Tetris moves with lookahead.

### Location

`engines/stackrabbit/` — a local build of [GregoryCannon/StackRabbit](https://github.com/GregoryCannon/StackRabbit). Not checked in; clone and build once (see [Setup](#stackrabbit-setup) below).

### Starting the engine

```bash
cd engines/stackrabbit
npm start          # node-gyp build + tsc + node built/src/server/app.js
# or, if already built:
node built/src/server/app.js
```

Listens on **port 3000** by default (override with `PORT` env var). Generator scripts auto-start it if not running — you don't need to start it manually unless debugging.

### HTTP endpoints

All endpoints accept query-string parameters (`board`, `currentPiece`, `nextPiece`, `level`, `lines`, `inputFrameTimeline`, `playoutCount`, `playoutLength`).

| Endpoint | Returns | Used for |
|---|---|---|
| `/ping` | `"pong"` | Health check |
| `/get-move-cpp` | `rotation,x,y\|inputs\|boardKey\|level\|lines` | Best move for a position |
| `/rate-move-cpp` | JSON `{playerMoveNoAdjustment, bestMoveNoAdjustment, …}` | Score a specific placement |
| `/engine-movelist-cpp` | JSON array of `{firstPlacement, playoutScore}` | Top-K ranked moves |

### Engine client wrapper

`generator/src/engine/client.ts` — typed `StackRabbitClient` class. Key methods:

- `ping()` — returns `true` if the engine is alive
- `getBestMove(query)` — best placement for a board+pieces position
- `getTopMoves(query)` — ranked list (requires `playoutCount > 0`)
- `rateMove(query, playerBoard)` — score a specific placement against the engine's best

Default URL: `http://127.0.0.1:3000` (override via `STACKRABBIT_URL` env var).

### Behavior gotchas (load-bearing)

Things that silently produce wrong puzzles if you don't know them — see
[maneuver-generation.md](maneuver-generation.md) for how they bite:

- **Eval-only beats playouts for ranking.** The playout path (`playoutCount > 0`,
  `getTopMoves` / `engine-movelist-cpp`) is **unstable on awkward boards** — observed
  returning a hole-creating move valued *above* a clean one. Rank with eval-only
  (`rateMove`, `playoutCount: 0`, the client default). `getTopMoves` *requires* playouts
  (eval-only returns an empty list), so it's only for the deeper-confirm gate.
- **`inputFrameTimeline` / `valuationTimeline` changes which placements are reachable.**
  `'X.....'` (slow tap) makes tucks/spins unreachable, so a tuck stops being "optimal";
  `'X.'` (fast DAS) restores it. Use `'X.'` whenever the intended answer is a tuck.
- **`rateMove` throws `"player move not found"` for tuck placements** — it only knows
  hard-drops under the timeline. To score a tuck, apply it and rate the *resulting board*.
- **`get-move-cpp` reports no value** (client back-fills via `rateMove`); a move's `x` is
  an offset **relative to `SPAWN_COLUMN` (3)**, not an absolute column. Sentinels:
  `""`/`"No legal moves"` → null (not an error); body starting `"Error"` → throw.

### Deeper-confirm gate (`pipeline/deeper.ts`, #53/#59)

After the eval-only sweep, top contenders are re-valued with a playout search to catch
eval-only quirks. Outcomes: `confirmed`, `reranked` (promote the deeper-best), or
**reject** — surfaced as `deeper-quirk` / `eval-inversion` rejection counts. This gate
**wrongly rejects** puzzles whose optimum is shallow-unstable by design (value comes from
the 2nd-piece lookahead, e.g. VITS) — pass `deeperConfirm: null` in those generators.

### Crash management (Windows)

StackRabbit's C++ core segfaults on certain board states (tall/messy extremes). On Windows, orphaned engine processes open console windows. The generator scripts handle this:

```
DO:    spawn(process.execPath, [srApp], { cwd, stdio: 'ignore' })
DON'T: spawn with detached: true or .unref() — causes orphaned windows

Kill:  sr.proc.kill('SIGKILL')
       + taskkill /PID <pid> /T /F   (Windows process-tree cleanup)

Limit: consecutiveCrashes counter (max 5) — abort if engine is unstable
Clean: process.on('exit'/'SIGINT'/'SIGTERM', killEngine)
```

### StackRabbit setup

```bash
cd engines
git clone https://github.com/GregoryCannon/StackRabbit.git stackrabbit
cd stackrabbit
npm install
npm start          # builds C++ (node-gyp) + compiles TS + starts server
```

Requires: Node.js, Python 3 (for node-gyp), a C++ compiler (MSVC on Windows, gcc on Linux).

---

## BetaTetris

Python neural-net engine used as a **consensus filter** — a final generation gate that checks whether BetaTetris's normal net agrees with StackRabbit's optimal. Not a server; spawned on demand.

### Location

`engines/betatetris/` — contains the Python scripts and a `bt-run.cmd` wrapper. The actual BetaTetris repo is cloned into `engines/betatetris/betatetris-tablebase/` with model weights in `engines/betatetris/models/`.

### Environment variables

Set automatically by `bt-run.cmd` (Windows) or `bt-run` (Linux/sandcastle):

| Variable | Value | Purpose |
|---|---|---|
| `BT_HOME` | `engines/betatetris/` | Root of the BT installation |
| `BT_REPO_PY` | `betatetris-tablebase/python` | Python source |
| `BT_MODELS` | `models/` | Model weights (normal + perfect nets) |
| `BT_OUT` | `engines/betatetris/` | Output dir for verdicts/reports |

### Scripts

| Script | Purpose | Invocation |
|---|---|---|
| `consensus.py` | **The standard gate.** Normal-net top-1 verdict per puzzle. | `bt-run python engines/betatetris/consensus.py [keys.json] [out.json]` |
| `keeprate.py` | Diagnostic: measure what fraction of the bank BT agrees with. | `bt-run python engines/betatetris/keeprate.py [limit]` |
| `pull.py` | Fetch puzzle sample from Supabase → `sample.json`. | `bt-run python engines/betatetris/pull.py` |
| `smoke.py` | Feasibility proof: board conversion round-trip + model forward pass. | `python engines/betatetris/smoke.py` |
| `compare.py` | Original spike harness (deprecated; use consensus.py). | `bt-run python engines/betatetris/compare.py` |

### consensus.py — the standard gate

Two-stage strict check: (1) **piece-1** — is our optimal's piece-1 outcome the net's #1
policy move (`rank == 1`)? (2) **piece-2** — given BT's own top-1 piece-1, does BT's top-1
piece-2 match our outcome across **all 7 next-pieces** (`P2_THRESHOLD = 7`, strict 7/7)?
Keep iff both pass. **Fail-closed** — anything unjudgeable is dropped with a distinct reason:

- `disagree` — p1 reachable but not top-1 (the real cull)
- `disagree-p2` — p1 ok but p2 < 7/7
- `unreachable` — our optimal isn't even in BT's move set
- `odd-parity` — board parity BT's Reset can't accept
- `inject-mismatch` — injected board round-trips wrong
- `bt-error` — exception while judging (counted separately; flakiness can only shrink the bank)

Output: `consensus_verdict.json` — array of `{number, id, keep, reason, rank, inject_ok}`.

**Gotchas:**
- It's a **filter, not a re-rank** — disagreers are dropped, never relabelled with BT's move
  (StackRabbit's combo table stays authoritative).
- **Piece-2 maneuvers are enumerated far better than piece-1** (~54% vs much lower). BT will
  *not* 7/7-agree a spintuck as piece 2 (p2=0/7). Design the maneuver as piece 2 when possible.
- **Non-clearing positional maneuvers (VITS) can't pass strict 7/7** — they use a **relaxed**
  bar (optimal within BT top-K, K=3 default), calibrated from BT's policy-rank distribution.
- **Outcome keys carry `{rotation,col}` but no row** — hard-dropping mis-places a tuck/spin.
  `consensusKeys` reconstructs the true resting line from `combos.entries[0].boardKey` via
  `restingLineForEntry` (the tuck/spin consensus-key bug). Normal net only — the `perfect`
  net is off-objective (tetris-only) for a general stacking trainer.

**From the generator pipeline** (`generator/src/pipeline/consensus.ts`): `filterByConsensus(candidates, betaTetrisJudge())` shells out to consensus.py via bt-run and returns `{kept, dropped, keepRate, btErrors, verdicts}`.

### BetaTetris setup

```bash
cd engines/betatetris
git clone https://github.com/GregoryCannon/betatetris-tablebase.git
cd betatetris-tablebase
# Build the C++ extension (requires Python 3.12, a C++ compiler)
cd cpp && python setup.py build_ext --inplace && cd ..
cd ..
# Download model weights into models/
mkdir models
# (get model-v1.0.0-normal.pth and model-v1.0.0-perfect.pth from the BT releases)
# Smoke test
python smoke.py
```

Requires: Python 3.12, PyTorch (CPU), a C++ compiler. The sandcastle Docker image bakes all of this in via micromamba.

---

## Generator scripts that use the engines

Run from the repo root with `npx tsx`. Shared plumbing (ws polyfill + `.env`, the
BetaTetris judge, a managed/auto-restarting StackRabbit, paged bank-key pulls) lives in
**`generator/src/gen-harness.ts`** — generators import it rather than re-implementing it.

### Environment

A root `.env` file (gitignored), loaded by `loadRepoEnv()`:

```bash
SUPABASE_URL=https://…supabase.co
SUPABASE_SERVICE_ROLE_KEY=…    # write access (insert puzzles)
# or SUPABASE_ANON_KEY=…      # read-only scripts
```

### generate-set.ts — orchestrator (run a mix of generators)

```bash
npx tsx generator/src/generate-set.ts --spintuck 6 --vits 8 --szdig 6 [--dry-run]
```

Runs each requested maneuver generator in turn on **one shared StackRabbit** (no port
contention), echoes output live, prints an inserted-per-type roll-up. No args → the type
list. See **[maneuver-generation.md](maneuver-generation.md)** for what each type is, the
quality bar, and the engine gotchas that make these work.

### The maneuver generators

`tuck-gen` · `varied-maneuver-gen` · `spin-bank-gen` (T-spins) · `forced-spin-bank-gen`
(forced T/J/L) · `forced-sz-dig-bank-gen` (S/Z digs) · `spintuck-bank-gen` ·
`vits-bank-gen`. Each constructs boards, runs the combo pipeline, and gates on StackRabbit
rank-1 + interactive reachability + BetaTetris consensus before inserting. Run standalone
(`--count N --dry-run`) or via the orchestrator.

### Main self-play pipeline

```bash
npm run start --workspace @trainer/generator -- --count 300 --max 1500
```

Full pipeline: self-play → combo sweep → quality gates → difficulty → insert. Requires
StackRabbit running and `SUPABASE_SERVICE_ROLE_KEY`.

### Bank-health / migration tools (read-mostly)

`audit` · `malformed-scan` · `soft-delete-malformed` · `reband` · `retag`(+`retag-apply`) ·
`bank-inspect` · `bank-dedup-audit`. Reusable; not part of a generation run.
