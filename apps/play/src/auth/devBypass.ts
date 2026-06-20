/**
 * DEV-ONLY login bypass (#20) — TEMPORARY, remove on request.
 *
 * While the site is in development, login gets in the way. Setting the build
 * flag `VITE_AUTH_BYPASS` (to `1`/`true`) lets any visitor skip the sign-in
 * screen and use the app as a throwaway, unauthenticated dev user. Production /
 * release builds leave the flag unset, so login stays mandatory.
 *
 * This is deliberately isolated to ONE module + ONE guard (the `?? bypassUser()`
 * in `App.tsx`) so it rips out cleanly. REMOVAL (issue #20, when requested):
 * delete this file and that single guard — no other code references the bypass.
 */

import type { AuthUser } from './auth.js';

/** True when the dev login bypass is enabled via `VITE_AUTH_BYPASS`. */
export const AUTH_BYPASS_ENABLED =
  import.meta.env.VITE_AUTH_BYPASS === '1' || import.meta.env.VITE_AUTH_BYPASS === 'true';

/** The throwaway user a bypassed visitor plays as (a nil UUID, no real account). */
export const DEV_BYPASS_USER: AuthUser = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'dev-bypass@localhost',
};

/**
 * The user to fall back to when nobody is signed in: the dev user when the
 * bypass is enabled, otherwise `null` (mandatory login).
 */
export function bypassUser(enabled: boolean = AUTH_BYPASS_ENABLED): AuthUser | null {
  return enabled ? DEV_BYPASS_USER : null;
}
