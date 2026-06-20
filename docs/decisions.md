# Decisions

Lightweight log of decisions not captured in [PRD-v1.md](PRD-v1.md) (the PRD owns product/architecture decisions; this owns tooling, repo, and doc choices). Newest first.

### 2026-06-19 — Glossary terminology revision

Reviewed [glossary.md](glossary.md) term by term. Key changes: renamed the puzzle unit to **"piece / next-piece puzzle"** and dropped **"two-ply line"** as redundant jargon (the solution is just **Optimal line**); renamed **Ghost → Ghost placement** to avoid colliding with Tetris's standard hard-drop drop-shadow; generalized **Hz-invariance** to "movement/reaction agnostic" across the full speed range; broadened **Stacking** to include line-clear strategy. **Removed "Flat seed"** (the seeding mechanism is expected to change, so it's not documented) and **"totalValue"** (engine-internal; mentioned inline only). CLAUDE.md's orientation line updated to match the puzzle rename.

### 2026-06-19 — CLAUDE.md scope: hybrid

CLAUDE.md is a thin operating layer (commands, guardrails, conventions, reporting style) plus a short orientation summary, and defers to the PRD for all deep spec/architecture detail. Avoids both per-invocation PRD reads and duplication that rots.

### 2026-06-19 — Repo layout: single repo, `src/` split

`src/core` (pure, shared), `src/app` (React SPA), `src/generator` (offline Node). Chosen over npm workspaces to keep a prototype light (one install, one tsconfig). The decoupling of the two halves is enforced by convention, not package boundaries.

### 2026-06-19 — Toolchain: Vitest + TypeScript, npm; no linter/formatter pinned

Test runner Vitest, typecheck via `tsc --noEmit`, package manager npm. Deliberately did **not** pin a linter or formatter — keep the prototype light; add one later if friction appears.

### 2026-06-19 — Guardrails in CLAUDE.md: lean (two only)

CLAUDE.md encodes only two hard "never" rules: engine-offline-only, and off-the-shelf-except-the-puzzle-core. Other PRD constraints (Hz-invariance gate, no-Vercel/no-Next) remain in the PRD but are not repeated as CLAUDE.md guardrails.

### 2026-06-19 — Reporting style scope: conversational only

The concision rule ("be extremely concise and sacrifice grammar") applies to chat/status reports to the owner only. Artifacts (commit messages, PR bodies, code comments, docs) stay clear and grammatical.

### 2026-06-19 — Domain glossary added

Created [glossary.md](glossary.md) for the term-dense domain; CLAUDE.md links to it so every agent shares the vocabulary.
