/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (public). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/publishable key (public). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /**
   * DEV-ONLY login bypass (#20, TEMPORARY). When `'1'`/`'true'`, the sign-in
   * screen is skipped and visitors play as a throwaway dev user. Leave unset in
   * production to keep login mandatory.
   */
  readonly VITE_AUTH_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
