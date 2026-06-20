# Handoff — make Sandcastle run fully autonomous (AFK)

**Goal:** Get to where the user starts Sandcastle, walks away, and it works through *all
actionable* GitHub issues unattended — reliably, without manual babysitting, with the
results landing somewhere reviewable.

**Audience:** the next Claude Code session. This doc is self-contained; read it first, then
drive the plan below *with the user* (several decisions are theirs to make).

---

## 1. Where things stand today (2026-06-19)

**It already works** for a bounded run. A 3-iteration smoke test completed green:
issues **#1 (scaffold), #3 (board model), #5 (checker)** were implemented (RGR, 24 tests
passing) and **closed on GitHub**. **12 issues remain open.**

**Critical environment facts** (also in Claude memory → `sandcastle-runs-in-wsl`):
- Sandcastle runs in **WSL2 Ubuntu**, as user **`dev`** (uid 1000, in the `docker` group),
  repo at **`/home/dev/nes-tetris-trainer`**. It does **NOT** run on native Windows —
  the Docker provider mangles Windows bind-mount paths (`…/.git:c:/…/.git:z`,
  "too many colons"). WSL avoids this.
- The Docker image **must be built as the uid-1000 `dev` user**, not root, or `claude`
  lands in `/root/.local/bin` while the image's `PATH` expects `/home/agent/.local/bin`
  → agent can't find `claude`. Rebuild with:
  `npx sandcastle docker build-image --dockerfile .sandcastle/Dockerfile`
- **The WSL repo is canonical.** Sandcastle commits land on `main` in
  `/home/dev/nes-tetris-trainer` (via `merge-to-head`) and are **UNPUSHED**. The Windows
  working copy (`c:\Users\Jack\nes-tetris-trainer`) is now **stale/diverged** — it does
  not have the scaffold commits.
- `.sandcastle/.env` holds `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN`; it **must be LF**
  line endings (a stray CR corrupts the tokens). It is gitignored (never committed).

**Current config** (`/home/dev/nes-tetris-trainer/.sandcastle/main.mts`):
- `sandbox: docker()`, `agent: claudeCode("claude-opus-4-8")`
- `maxIterations: 3`  ← only a smoke-test size
- `branchStrategy: { type: "merge-to-head" }`  (auto-merges to `main`, no review gate)
- `copyToWorktree: ["node_modules"]`, `onSandboxReady: npm install`
- **Mode: single serial worker, one issue/iteration, no parallel forks, no review stage.**

**Prompt** (`.sandcastle/prompt.md`): RALPH loop. Picks the highest-priority *unblocked*
open issue, does RGR (failing test → implement → `npm run typecheck && npm test` →
commit `RALPH: …` → `gh issue close`). One issue per iteration. If blocked, it comments
and moves on (does **not** close). When only blocked/no issues remain it emits
`<promise>COMPLETE</promise>`, which stops the run early.

---

## 2. Gaps between "today" and "do everything AFK"

1. **Iteration budget.** `maxIterations: 3` stops after 3. For "everything," raise it
   (e.g. 25–30) so one run can cover all actionable issues; the `COMPLETE` signal stops it
   early when nothing actionable is left.
2. **Crash resilience.** A single `npm run sandcastle` that hits a transient API error /
   network blip just dies. AFK needs a thin **restart wrapper**: re-run until the log shows
   `COMPLETE`, with a cap on consecutive failures and a hard total-iteration ceiling.
3. **Two externally-blocked issues need the user's resources** (can't be done AFK without
   them):
   - **#2 Supabase project, schema, data-access layer** — needs a real Supabase project +
     `SUPABASE_URL` / anon / service-role keys passed into the sandbox env.
   - **#4 StackRabbit engine client (offline)** — needs the StackRabbit engine
     (binary/wasm) available offline inside the sandbox.
   Until provided, the agent will (correctly) skip these. "Everything" can only include them
   if the user supplies these inputs.
4. **Result destination.** Right now nothing is pushed; work sits on WSL `main`. Decide one:
   (a) push `main` to GitHub after the run; (b) branch-per-issue + open PRs for review
   (needs a `branchStrategy` change + `gh pr create` in the prompt); (c) leave on WSL `main`
   for manual review when back.
5. **Cost / model.** Opus 4.8 × many unattended iterations is expensive and may hit
   subscription limits. Decide model (consider `claude-sonnet-4-6` for cheaper iterations,
   or opus only for hard issues) and an acceptable spend / run length.
6. **Guardrails.** Already: only closes issues when tests pass. Consider making issue
   blockers explicit in issue bodies so it never burns an iteration on blocked work; keep a
   total-iteration ceiling; decide whether auto-merge-to-main is acceptable with no human
   reviewer (AFK ⇒ either trust it or use PRs).
7. **Notification.** How does the user learn it finished / failed? (final summary in log, a
   push, a desktop/email ping, or a scheduled run that reports.)

---

## 3. Recommended plan (next chat: drive WITH the user)

**Step 0 — Decisions (ask the user first; these shape everything):**
   - Supabase: provision now (provide keys) or skip #2 for this AFK run?
   - StackRabbit: provide the offline engine or skip #4?
   - Results: push to `main`, open PRs, or leave for manual review?
   - Model + budget: opus everywhere, sonnet, or mixed? Max acceptable run length/spend?
   - Auto-merge to `main` acceptable, or require PRs?

**Step 1 — Make the issue list autonomy-ready.** Review the 12 open issues; ensure
   blocked ones (#2, #4, and anything depending on them) declare their blocker in the body
   so the agent skips cleanly and reaches `COMPLETE`.

**Step 2 — Update config** (`.sandcastle/main.mts` in WSL — see §4 editing workflow):
   raise `maxIterations` (~25); set chosen model; add any new env/secrets for #2/#4.

**Step 3 — Wire the result flow** (per Step 0): add push or PR creation (prompt step +
   ensure `GH_TOKEN` can push; the token currently has Issues access — pushing code may
   need a token with `contents:write` / repo scope, verify this).

**Step 4 — Add an unattended runner** in WSL: a bash wrapper that loops
   `npm run sandcastle`, stops on `COMPLETE`, restarts on crash up to K times, enforces a
   total-iteration ceiling, and writes a summary. Optionally schedule it.

**Step 5 — Dry run** a few iterations with the new config; confirm stability (no auth/
   quota/path surprises), then let it run AFK.

**Step 6 — Post-run verification:** tests green, intended issues closed, code
   pushed/reviewable, no leftover branches/containers.

---

## 4. How to operate (important workflow detail)

The Claude session opens with cwd = the **Windows** repo, but the **live config is the WSL
copy**. To change what actually runs, edit the WSL file:
`\\wsl.localhost\Ubuntu\home\dev\nes-tetris-trainer\.sandcastle\main.mts`
(or edit on Windows and `rsync` over — but the Windows repo is stale, so prefer editing the
WSL copy directly). Confirm the path you edit is the one under `/home/dev`.

**Key commands** (run from Windows via the `wsl` bridge):
```powershell
# Run sandcastle
wsl -d Ubuntu -u dev -- bash -lc "cd ~/nes-tetris-trainer && npm run sandcastle"

# Watch the live log
wsl -d Ubuntu -u dev -- bash -lc "tail -f ~/nes-tetris-trainer/.sandcastle/logs/*.log"

# Rebuild the sandbox image (only if Dockerfile changes) — as dev, NOT root
wsl -d Ubuntu -u dev -- bash -lc "cd ~/nes-tetris-trainer && npx sandcastle docker build-image --dockerfile .sandcastle/Dockerfile"

# Inspect state
wsl -d Ubuntu -u dev -- git -C /home/dev/nes-tetris-trainer log --oneline -10
wsl -d Ubuntu -u dev -- git -C /home/dev/nes-tetris-trainer branch
```
Note: inside `wsl -d Ubuntu -u dev -- bash -lc "..."`, PowerShell eats `|`, `$()`, and `\"`.
For anything with pipes/substitution, **write a `.sh` to disk and run
`wsl -d Ubuntu -u dev -- bash /mnt/c/.../script.sh`** instead.

---

## 5. Pitfalls already learned (don't rediscover these)

- Native Windows Docker → path bug. Use WSL. (Any worktree strategy hits it; only `head`
  mode dodges it, but we chose WSL to keep isolation.)
- Build the image **as dev (uid 1000)**, never root, or `claude` isn't on PATH.
- `.env` must be **LF**, or tokens get a trailing `\r` and auth fails.
- Editing the **Windows** `.sandcastle/main.mts` does nothing — runs use the **WSL** copy.
- `maxIterations` is a hard cap; the run also stops early on `<promise>COMPLETE</promise>`.
- Pushing code likely needs a GitHub token with repo `contents:write`; the current
  `GH_TOKEN` was set up for Issues — verify before relying on push.
- Windows repo and WSL repo have diverged; treat WSL as source of truth.

---

## 6. Open issues remaining (12)
#2 Supabase (blocked: needs project+keys), #4 StackRabbit engine (blocked: needs offline
engine), #6 Glicko-2 wrapper, #7 quality filters, #8 self-play generator, #9 generation
CLI, #10 board renderer + ghost input, #11 puzzle session E2E loop, #12 feedback UI,
#13 auth + rating persistence, #14 deep E2E tests, #15 full v1 bank + deploy.
(Verify current state with `gh issue list` / the API at run time — this list is a snapshot.)
