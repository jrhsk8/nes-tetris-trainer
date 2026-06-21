# HANDOFF — Consensus bank (graded reward + difficulty-by-tightness + deeper-confirmed optimal)

> Output of a `/grill-with-docs` session that followed the **BetaTetris cross-check spike**
> (`FINDINGS-betatetris-spike.md`). Design rationale recorded in `docs/decisions.md`
> (*2026-06-21 — Consensus bank*). Four issues filed — **all four (#51–#54) are now
> RALPH/sandcastle-ready**: BetaTetris was baked into the sandcastle image (2026-06-21),
> so #54 no longer needs a supervised session. *(Original plan kept #54 supervised; updated
> below.)*

## The goal (owner's words, distilled)

Good moves should still be rewarded; puzzles should be correct; the *best* answer should be
**unambiguously** the best — and **hard puzzles should have few passing answers** (so it isn't
"too easy to find anything that works"). Rating should scale with answer quality (100 ≫ 97;
95 neutral; bad misses docked harder, capped).

Why this isn't "make two AIs agree on the best move": the spike proved BetaTetris matches our
optimal **0/33** — a legitimate objective difference, not a bug. So the design uses BetaTetris
only as an optional *consensus* layer (does it bless our answer?), and gets "unambiguously best"
from a **deeper search of our own engine** instead.

## Issues filed

| # | Area | What | Where |
|---|---|---|---|
| **#51** | `[play]` | Graded reward curve — `scoreToOutcome(score)` replaces binary `solved?0:1` (95 neutral, convex to 100, steep-below to 0.10 floor); persist `attempts.score`; graded UI feedback | RALPH |
| **#52** | `[generator]` | Difficulty bands enforced by `acceptCount` (hard = ≤~2 accepts); bank spans easy→hard | RALPH (regen) |
| **#53** | `[generator]` | Deeper-StackRabbit best-confirm (`playoutCount>0`) re-ranks/rejects eval-only quirks | RALPH (regen) |
| **#54** | `[generator]` | BetaTetris true-consensus filter — keep only puzzles whose optimal BetaTetris *also* rates highly; **Phase 1 = measure keep-rate** | RALPH (last; after #53) |

## Sandcastle run — prep status

- ✅ Issues #51–#54 filed on GitHub (#54 reclassified `supervised`→`generator`/autonomous, 2026-06-21). ✅ `.sandcastle/prompt.md` **Run scope** updated for this batch (work #51→#54; back up bank before the #52/#53 regen; #54 last; complete when #51–#54 are closed). ✅ ADR in `docs/decisions.md`. ✅ BetaTetris baked into `.sandcastle/Dockerfile` (offline, CPU) + adapters parameterized.
- **Remaining manual steps to launch** (the prompt forbids auto push/deploy; the WSL canonical repo is the one RALPH runs in):
  1. Push this prep to `origin/main` (issues are already live on GitHub; the WSL repo needs the updated `prompt.md` + `docs/decisions.md` + `Dockerfile` + `betatetris-spike/`).
  2. Sync the WSL canonical repo (`/home/dev/nes-tetris-trainer`) to `origin/main` (the loop reads `prompt.md` from its working tree; the open-issues list is a live `gh` query, so #51–#54 show up automatically).
  3. **Rebuild the sandcastle image** so it contains the BetaTetris stage (as `dev`, in WSL): `npx sandcastle docker build-image --dockerfile .sandcastle/Dockerfile`. *(Adds ~1.2–1.5 GB + several minutes; one-time. Without this rebuild, #54's env smoke-check fails and RALPH will skip #54 with a blocker comment.)*
  4. Launch `.sandcastle/run-afk.ps1` (Windows launcher → WSL loop → `wsl --shutdown`).
- After the run: review, then push + redeploy via the **/push-deploy-sandcastle** flow (manual).

## #54 — now sandcastle-runnable (was supervised)

BetaTetris is baked into the sandcastle image (`.sandcastle/Dockerfile`, offline/CPU), so #54
runs autonomously like StackRabbit-backed issues. Mechanics:

- **In sandcastle:** the env `bt` + the built `tetris` extension + the v1.0.0 weights are in the
  image; run scripts with the `bt-run` wrapper (`bt-run python betatetris-spike/pull.py`, then
  `bt-run python betatetris-spike/compare.py`). Paths via env (`BT_HOME`/`BT_REPO_PY`/`BT_MODELS`);
  `DATABASE_URL` is in the process env. **Order: do #54 last** — it consumes the deeper-confirmed
  optimal (#53) and difficulty bands (#52).
- **Supervised fallback (unchanged):** the same adapters also run in WSL `~/bt-spike/`
  (`~/.local/bin/micromamba run -r ~/micromamba -n bt python …`, models in `~/bt-spike/models/`).
- **Phase 1 (do first):** measure the keep-rate — for each puzzle compute whether our
  deeper-confirmed optimal is high in BetaTetris's policy (reuse `betatetris-spike/compare.py`).
  That fraction decides whether a consensus bank is viable and how many candidates we burn per
  keep. Build the Phase-2 generation gate only if the keep-rate is workable (owner accepted a
  small, more tactical bank).

## Pointers
- Spike verdict + method: `FINDINGS-betatetris-spike.md`; reproduce: `betatetris-spike/README.md`.
- Design rationale: `docs/decisions.md` → *2026-06-21 — Consensus bank*.
- Current bank: 309 puzzles, live at jrhsk8.github.io/nes-tetris-trainer.
