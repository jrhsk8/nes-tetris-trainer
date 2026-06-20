/**
 * useAuth (#13) — tracks the current user, seeding from the existing session
 * and updating on auth changes. Returns `undefined` while loading, then the
 * `AuthUser` or `null`.
 */

import { useEffect, useState } from 'react';
import type { AuthApi, AuthUser } from './auth.js';

export function useAuth(auth: AuthApi): AuthUser | null | undefined {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void auth.currentUser().then((u) => {
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
