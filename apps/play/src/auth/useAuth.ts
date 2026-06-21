/**
 * useAuth (#13, #39) — tracks the current user, establishing an anonymous
 * session on load (so every visitor has a real `auth.uid()` and RLS-backed
 * persistence works), then updating on auth changes. Returns `undefined` while
 * loading, then the `AuthUser` or `null` (when no session could be established).
 */

import { useEffect, useState } from 'react';
import type { AuthApi, AuthUser } from './auth.js';

export function useAuth(auth: AuthApi): AuthUser | null | undefined {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void auth.ensureAnonymousSession().then((u) => {
      if (active) setUser(u);
    });
    const unsubscribe = auth.onChange((u) => {
      if (active) setUser(u);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth]);

  return user;
}
