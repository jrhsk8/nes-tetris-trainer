# HANDOFF — BetaTetris cross-check feasibility spike

> A **supervised research spike**, not a feature. Goal: find out whether **BetaTetris** can give a
> useful *independent second opinion* on the trainer's puzzles — and decide go/no-go before building
> anything. Deliverable = a short findings report + a throwaway adapter script. This is **not** an
> autonomous-RALPH task (needs a GPU + external repo + infra judgment); run it supervised.

## Why this exists

We cross-checked the bank's "optimal" lines with a board-quality audit (holes/height/Pareto) and fixed
two real bugs (#50 bad rank-1, #47 score scale). The open question: would a **second strong engine**
agree with our optimals, or surface puzzles our single engine (StackRabbit) gets wrong? BetaTetris is
the obvious candidate. This spike answers "is that actually viable, and worth it?"

## Crucial framing (read first — saves a wasted day)

- **Use the BetaTetris *neural net*, NOT the tablebase.** The [betatetris-tablebase](https://github.com/BetaTetris/betatetris-tablebase)
  is a lookup over **~3.5 B boards seen in BetaTetris self-play**; an **unseen** board is treated as an
  *instant top-out and avoided at all costs*. Our puzzle boards come from a different policy (StackRabbit
  + 12% noise, mid-game snapshots) and almost certainly are **not** in its set → the tablebase returns
  garbage for exactly the boards we care about. The **NN generalizes to arbitrary boards** — that's the
  only BetaTetris component that can score our puzzles. Candidates: the hybrid `board-server` in
  betatetris-tablebase (tablebase-when-confident, **NN fallback otherwise** — perfect, our boards hit the
  fallback) and the older pure-NN [beta-tetris](https://github.com/BetaTetris/beta-tetris). Evaluate both;
  pick whichever exposes the cleanest *arbitrary-board* eval.
- **Different objective — disagreement ≠ bug.** BetaTetris maximizes **expected final game score** over a
  whole game (Tetris-building, well management). Our generator asks "cleanest stack after these two
  pieces." They will *legitimately* disagree on many boards. So the spike is NOT "does BetaTetris match
  our optimal" — it is: **does BetaTetris ever pick a TOWER or a HOLE-BURYING line as best?** If it
  basically never does (while our *pre-#50* bank did), that corroborates the #50 fix and tells us a
  sampled BetaTetris "review flag" could be a useful net. If it disagrees wildly and often, it's not a
  usable oracle for our notion of "good stacking" and we stop.
- **Compute: CPU is enough for the spike — GPU is a *scale* concern, not a blocker.** The tablebase is
  pure C++ (AVX2/BMI2, **no GPU ever**). The NN for a ~33-puzzle sample is **~66 forward passes** — trivial
  on **CPU** (PyTorch/libtorch CPU build). Run the spike CPU-only. The one real risk is if the repo's NN
  inference is **hard-wired to CUDA** with no CPU path (grep for `.cuda()`, `device='cuda'`, a CUDA-only
  libtorch) — a 10-min check; if so, that's the blocker, report it. GPU only matters if you later score
  the whole bank routinely or generate data — and on an **AMD GPU** that path is **ROCm** (Linux-native,
  only on supported Radeon/Instinct cards, immature on WSL2) or **DirectML** (`torch-directml`, any DX12
  AMD GPU, slower, partial op coverage) — **not CUDA**. Treat AMD acceleration as a separate later project.
- **"Use both NN + tablebase" = the hybrid `board-server` — but the tablebase rarely fires on our boards.**
  The hybrid mode already IS both: tablebase when the board is covered *and* confident, NN otherwise. Our
  puzzle boards are almost all **unseen**, so it **defers to the NN for ~all of them** — "both" effectively
  collapses to "the NN" for this task. Running the hybrid is the right default; just don't expect the
  tablebase to contribute. It would only matter if you constrained generation to tablebase-covered boards
  (defeats the trainer's variety) or built your *own* tablebase over our domain (**infeasible** — NES board
  space ≈ 2^200; BetaTetris's 3.5 B is the *reachable-under-strong-play* slice, our noisy boards sprawl far
  wider).

## State / inputs

- **Bank:** 309 puzzles, Supabase project `vgpkdunidqjgmhsbocrq` (creds in `.sandcastle/.env`:
  `DATABASE_URL`, `SUPABASE_*`). Each row: `board` (200-char, **row-major from the top, '0'=empty**),
  `piece1`, `piece2`, `combos` (`{entries:[{rot1,col1,rot2,col2,score,boardKey}], total}` top-30,
  best-first), `optimal_line` (rank-1). `boardKey` = our 200-char resulting-board encoding.
- **BetaTetris board encoding (differs!):** 200 bits as **25 bytes, LSB-to-MSB**. An explicit converter
  (our 200-char row-major '0/1' ↔ their 25-byte bitpacked) is required — verify with a round-trip on a
  known board before trusting any result.
- **Reuse:** the audit metric (holes + max column height of a resulting board, board0-independent) lives
  in `C:\Users\Jack\AppData\Local\Temp\nesdiag\{diag,bad,scores}.py` — reuse it to characterize
  BetaTetris's picks vs ours. Trainer generation details: `generator/src/pipeline/{generate,combo}.ts`,
  `docs/decisions.md` (2026-06-21 #47/#50). Background on the engine-offline guardrail: `CLAUDE.md`.
- Build env: Linux, GCC 12+, **AVX2/BMI2** CPU (the WSL host qualifies). Repos above; playground for
  sanity-checking behaviour: betatetris.github.io/btpg.

## Spike steps

1. **Confirm CPU inference (no GPU needed for the spike).** Check the repo's NN path isn't CUDA-locked
   (grep `.cuda()` / `device='cuda'` / CUDA-only libtorch). The sample is tiny → run on **CPU**. Only if
   inference is genuinely CUDA-only with no CPU fallback is this blocked — report it then. (AMD GPU
   acceleration via ROCm/DirectML is out of scope here — a later scale concern, not the spike.)
2. **Pin the engine surface.** Read both repos. Determine: does `board-server` (`./main board-server -p
   3457 …`) accept an arbitrary board + current piece over its socket and return a placement + value?
   What's the wire protocol (reverse-engineer from the repo's Lua/FCEUX client)? Where are the NN
   weights, how big, what license? (Check the repo LICENSE before vendoring anything.)
3. **Build** the chosen server/inference (Linux, GCC12+, AVX2/BMI2; CUDA for the NN). Get weights.
   Smoke-test it scores *one* arbitrary board.
4. **Adapter (throwaway).** Pull a sample from Supabase — the **13 previously-quarantined IDs**
   (`select * from puzzles_quarantine_20260621`) **+ ~20 random current puzzles**. For each: convert our
   board → BetaTetris's 25-byte form, query **piece1** at **level 18, lines 0** → get BetaTetris's piece-1
   placement; apply it; query **piece2** → its placement. That two-ply is BetaTetris's preferred line.
5. **Compare + characterize.** Per sampled puzzle: does BetaTetris's two-ply land the **same resulting
   board** (`boardKey`) as our stored optimal? When different, compute **holes / max-height** of both
   resulting boards (reuse the audit metric). Tally: agreement rate; and crucially **how often BetaTetris
   itself would pick a tower (max-height ≥ 12) or a hole-burier** — it shouldn't.
6. **Verdict (the deliverable).** A short findings doc: GPU/infra cost, agreement rate, nature of
   disagreements, and a **go/no-go**: is a sampled-BetaTetris "review-flag" gate worth building, or do we
   stick with the lighter cross-check?

## If no-go (or as the cheaper alternative regardless)

The fallback that catches the **same bug class** with **zero new infra**: run **StackRabbit in a second,
deeper config** (`playoutCount > 0` instead of today's eval-only) and flag puzzles where the deeper search
disagrees with the eval-only optimal, plus keep the **holes/Pareto audit** as a generator/CI gate. That's
a clean GitHub-issue-sized, RALPH-friendly task — file it if the spike says BetaTetris isn't worth it.

## Out of scope

- Production integration, a regen/CI gate, or any generator change (this is go/no-go only).
- The tablebase route (domain-limited — see framing).
- Deploy/push. Engine stays offline/generator-only per `CLAUDE.md` either way.
