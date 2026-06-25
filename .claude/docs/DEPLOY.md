# Deploy (v1) — static play app on GitHub Pages

> The play app is **live** at https://jrhsk8.github.io/nes-tetris-trainer/. This
> doc records how the pieces fit together and what still needs manual dashboard
> config (OAuth, below).

## How it's wired

- **Bank:** the offline generator writes the puzzle bank to Supabase — each
  puzzle a distinct board, the optimal two-ply line, the [combo table](../docs/glossary.md#combo-table)
  (top-K ranked combos with scores), [type-tags](../docs/glossary.md#puzzle-type-tag),
  and a [difficulty](../docs/glossary.md#difficulty)-seeded rating. Regenerate/extend with:

  ```sh
  npm run start --workspace @trainer/generator -- --count 300 --max 1500
  ```

  (requires a local StackRabbit engine and `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` in the environment).

- **Static build:** `npm run build --workspace @trainer/play` emits a portable
  static site to `apps/play/dist` (`vite.config.ts` uses a relative `base`, so it
  works under a GitHub Pages project subpath or a custom domain).

- **Pages workflow:** `.github/workflows/deploy-pages.yml` builds and deploys the
  static site. It is **`workflow_dispatch` only** — it never runs on push, so the
  first deploy is a deliberate manual step.

## First-time Pages setup (one-time, already done)

1. In the repo: **Settings → Pages → Source → GitHub Actions**.
2. Add repository **secrets** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (the public anon/publishable key — never the service-role key, which stays
   offline with the generator).
3. Run the **"Deploy play app to Pages"** workflow from the Actions tab. (Redeploy
   anytime via the same `workflow_dispatch` trigger.)

### OAuth providers + account linking (#77, supervised)

Google/Discord sign-in and anon→account **linking** need Supabase **dashboard**
config that cannot be scripted from the sandbox. The app code is ready (the
OAuth `redirectTo` now carries the Pages base path — `origin + BASE_URL`); the
owner must, in the Supabase dashboard:

1. **Authentication → Providers → Google / Discord**: enable each and paste its
   OAuth **client ID + secret** (created in the Google Cloud / Discord developer
   consoles).
2. **Authentication → URL Configuration → Redirect URLs**: allowlist the app's
   return URL(s), including the GitHub Pages base path —
   `https://jrhsk8.github.io/nes-tetris-trainer/` (and `http://localhost:5173/`
   for local dev).
3. **Authentication → Providers → (Manual linking)**: enable **Manual linking**,
   so an anonymous session can be upgraded in place (`linkIdentity` for OAuth,
   `updateUser` + verify for email) **preserving the UID** — rating/attempts/
   prefs/seen-window/misses all carry over and become cross-device.

Until these are set, anonymous play still works; OAuth and the in-place "Sign in"
linking affordance stay inert. This also gates **admin** (#78), which needs a
verified-email login to exercise.

### Dev-only login bypass (#20, temporary)

While the site is in development, set `VITE_AUTH_BYPASS=1` (build env / repo
variable) to make a preview deployment **open** — visitors skip sign-in and play
as a throwaway dev user. **Leave it unset for production** so login stays
mandatory. This is intentionally a single flag + single guard
(`apps/play/src/auth/devBypass.ts`); remove both when the bypass is no longer
wanted (see issue #20).

## Acceptance

Once deployed, the app serves the full bank to authenticated users: a player
signs in (email or Google/Discord), is served random puzzles from the bank, and
keeps a persistent, updating rating with visible history. RLS limits each user
to their own rating and attempts; puzzles are public-read.
