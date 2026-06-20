# Handoff — run the 2026-06-20 UX overhaul through Sandcastle

**Goal:** get the UX-overhaul batch (GitHub issues **#21–#29**, epic **#30**) built by the
unattended RALPH/Sandcastle loop — *safely*, with the one destructive step held back for
manual review.

**Audience:** the next Claude Code session / the operator. Self-contained; read it, then
drive the prep below. Full design rationale lives in `docs/decisions.md` (2026-06-20 entry)
and the glossary (*Solutions chart*, *Value table*, *Next box*, *Color grid*). The prior
handoff (`HANDOFF-sandcastle-afk.md`) is fully executed and was deleted on purpose; this
supersedes it for this batch.

---

## 1. What's queued

All of #1–#20 are closed, so the loop's open-issue list is exactly this batch. Work splits
into three phases by cost (client-only → one offline regen → client features that consume
the new data):

| Issue | Phase | Title | Depends on |
|------|-------|-------|------------|
| #21 | 1 | Fix scroll jank: remove the CRT overlay | — (do first) |
| #22 | 1 | Rebuild play screen as a flanking dashboard + header nav | — (shell) |
| #23 | 1 | NES-style next-piece box | #22 |
| #24 | 1 | Rebindable keys (z/x + CCW, arrows) + Supabase prefs | #22 |
| #25 | 1 | Replay falling animation | #22 |
| #26 | 1 | History view (sortable/filterable, re-openable) | #22 |
| #27 | 2 | **Regenerate bank** (color-tracking + value tables) + schema migration | — (**destructive — see §3**) |
| #28 | 3 | Render authentic stack colors from the color grid | #27 |
| #29 | 3 | Solutions strip-plot chart (replaces metrics table) | #27 |
| #30 | — | **[EPIC] tracker** — not a work item (see §3) | — |

---

## 2. How the loop picks it up

`.sandcastle/prompt.md` embeds `gh issue list --state open` and treats it as the sole work
source, then works the highest-priority **unblocked** issue one at a time (RGR → `npm run
typecheck && npm test` → `RALPH:` commit → `gh issue close`). No prompt change is needed for
*discovery*. The problems are *ordering* and *the destructive step* — §3.

---

## 3. Critical: ordering and gating (do this prep before launching)

1. **Make dependencies explicit, or the loop builds out of order.** The prompt skips an
   issue only if it is "blocked by another open issue," but it can only know that from the
   issue body. The `Depends on` column above is currently prose. Without hard blockers the
   loop may, e.g., build the next-box (#23) into the *old* layout before the dashboard
   rebuild (#22) lands. **Fix:** add an explicit first line to #23/#24/#25/#26 — e.g.
   `Blocked by #22 — do not start until closed` — and to #28/#29 — `Blocked by #27`.

2. **#27 must NOT run unattended.** It regenerates and **replaces the live production
   bank** (`jrhsk8.github.io/nes-tetris-trainer` is live), mints new puzzle IDs, and
   **orphans every existing user attempt**; it also drives StackRabbit hard and applies a
   DDL migration via `DATABASE_URL`. This is destructive and outward-facing — exactly the
   case #15's deploy was deferred for. **Fix:** add a "Run scope (this batch)" note to
   `.sandcastle/prompt.md` (WSL copy) telling RALPH to do **Phase 1 only (#21–#26)**, and to
   **comment-and-leave #27/#28/#29 open** for manual review. Run the regen yourself with
   oversight, then let a second Sandcastle pass do #28/#29.

3. **Close the epic #30 (or it wastes an iteration).** RALPH has no concept of a tracker
   issue; it will try to RGR a checklist and stall. The ordered plan is preserved in this
   doc, in `docs/decisions.md`, and (once §3.1 is done) in the per-issue blockers. Close #30
   with a note, or leave it and accept one wasted/blocked iteration.

---

## 4. Where and how to run (WSL recap)

- The run is **WSL2 Ubuntu**, user **`dev`**, repo **`/home/dev/nes-tetris-trainer`** — *not*
  native Windows (Docker bind-mount path bug). The WSL `main` is canonical; commits land
  there via `merge-to-head` and stay **UNPUSHED**.
- Launch: `bash .sandcastle/run-afk.sh` (as `dev`, in the WSL repo). Config: Opus 4.8,
  `maxIterations: 25`, single serial worker, result left on WSL `main`. Caps: 3 consecutive /
  6 total launches. Summary at `.sandcastle/logs/afk-*.summary.log`.
- Env is already provisioned in the sandbox: Supabase (`SUPABASE_URL`, anon/service keys,
  `DATABASE_URL`) and StackRabbit (`STACKRABBIT_URL=http://127.0.0.1:3000`, started by
  `onSandboxReady`). `GH_TOKEN` has push + repo scope.
- **WSL needs `.wslconfig` memory ≈ 24 GB** or Sandcastle SIGSEGV-crashes (host has 32 GB).
- Edit the **WSL** copies of `main.mts` / `prompt.md` (the Windows repo is a separate working
  copy). Editing via `\\wsl.localhost\...` creates root-owned files — fix ownership with the
  root-container `chown` trick (see the `sandcastle-afk-setup` memory) since `dev` has no
  passwordless sudo.

---

## 5. Repo / doc sync caveat

This batch was authored from the **Windows** working copy: the issues live on GitHub (shared,
so the WSL loop sees them), but the doc edits (`CLAUDE.md`, `docs/decisions.md`,
`docs/glossary.md`) and this handoff exist **only on Windows**. The WSL canonical repo does
not have them, and per the setup notes the WSL docs were never synced and predate the
scaffold. The issue bodies are self-contained, so the loop can work without the doc edits —
but if you want the loop to read an accurate `docs/decisions.md`, sync these edits into WSL
first, and watch for Windows↔WSL divergence when you reconcile the two repos later.

---

## 6. Post-run verification

- `npm run typecheck` clean and `npm test` green (note: `test` runs `scripts/run-tests.mjs`,
  which retries the flaky V8/TurboFan crash from #16).
- #21–#26 closed; #27/#28/#29 left open for manual review (per §3.2).
- Smoke the app: board large and centered with no scroll jank, NES next-box top-right,
  z/x + arrows + rebinding, the optimal line falls into place, History view opens and
  re-opens a past puzzle.
- The app is live on GitHub Pages — redeploy after the merged client work (see the
  `live-deploy` memory).

---

## 7. Decisions for the operator (recap)

- **Gate #27 (regen) out of the unattended run?** Strongly recommended yes — run it with
  oversight, not AFK.
- Add explicit `Blocked by #N` lines to the dependent issues? (Recommended — see §3.1.)
- Close the epic #30 so the loop ignores it? (Recommended — see §3.3.)
- Sync the Windows doc edits into the WSL repo before launching? (Optional — see §5.)
